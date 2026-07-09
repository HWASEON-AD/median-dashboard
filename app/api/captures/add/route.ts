import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// 캡처 수동 추가: 자동 캡처가 없는 날짜에 사용자가 직접 사진을 올려 캡처 레코드를 만든다.
// - 키워드는 median_posts에서 고른다(post_id) → 브랜드/제품/노출탭은 그 행에서 가져오므로 오타가 없다.
// - 캡처가 있다는 건 그 날 노출됐다는 뜻이므로 median_daily_exposure에도 함께 기록한다(중복은 무시).
// - 같은 (post_id, date) 캡처가 이미 있으면 새로 만들지 않고 이미지를 갱신한다(중복 행 방지).
const BUCKET = 'median-captures'
const TABLE = 'median_daily_captures'
const EXPOSURE_TABLE = 'median_daily_exposure'
const POSTS_TABLE = 'median_posts'
const MAX_BYTES = 4 * 1024 * 1024 // Vercel 요청 바디 한도(4.5MB) 아래로 제한
const ALLOWED: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

export async function POST(req: NextRequest) {
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식입니다.' }, { status: 400 })
  }

  const postId = form.get('post_id')
  const date = form.get('date')
  const mode = form.get('mode') === 'full' ? 'full' : 'basic'
  const file = form.get('file')

  if (typeof postId !== 'string' || !postId) {
    return NextResponse.json({ error: '키워드를 선택하세요.' }, { status: 400 })
  }
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: '날짜 형식이 올바르지 않습니다 (YYYY-MM-DD).' }, { status: 400 })
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: '이미지 파일이 없습니다.' }, { status: 400 })
  }
  const ext = ALLOWED[file.type]
  if (!ext) {
    return NextResponse.json({ error: 'PNG, JPG, WEBP 이미지만 업로드할 수 있습니다.' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: '파일이 4MB를 초과합니다. 용량을 줄여 다시 시도하세요.' }, { status: 400 })
  }

  // 선택한 키워드가 실재하는지 확인하고 브랜드/제품을 가져온다 (임의 post_id 주입 방지)
  const { data: post, error: postErr } = await supabaseAdmin
    .from(POSTS_TABLE)
    .select('id, brand, keyword, product')
    .eq('id', postId)
    .single()
  if (postErr || !post) {
    return NextResponse.json({ error: '해당 키워드를 찾을 수 없습니다.' }, { status: 404 })
  }

  const suffix = mode === 'full' ? '_full' : ''
  const path = `captures/${date}/${postId}${suffix}_manual_${Date.now()}.${ext}`
  const buf = Buffer.from(await file.arrayBuffer())

  const { error: upErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, buf, { contentType: file.type, upsert: true })
  if (upErr) {
    console.error('[captures/add] 스토리지 업로드 실패:', upErr.message)
    return NextResponse.json({ error: `업로드 실패: ${upErr.message}` }, { status: 500 })
  }

  const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path)
  const url = pub.publicUrl
  const col = mode === 'full' ? 'full_image_url' : 'image_url'

  // 같은 날짜·키워드 캡처가 이미 있으면 갱신, 없으면 신규 생성
  const { data: existing } = await supabaseAdmin
    .from(TABLE)
    .select('id')
    .eq('post_id', postId)
    .eq('date', date)
    .maybeSingle()

  let captureId: string
  if (existing) {
    const { error } = await supabaseAdmin.from(TABLE).update({ [col]: url }).eq('id', existing.id)
    if (error) return NextResponse.json({ error: `DB 갱신 실패: ${error.message}` }, { status: 500 })
    captureId = existing.id
  } else {
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .insert({
        post_id: postId,
        date,
        brand: post.brand,
        keyword: post.keyword,
        product: post.product,
        [col]: url,
        captured_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (error) return NextResponse.json({ error: `DB 저장 실패: ${error.message}` }, { status: 500 })
    captureId = data.id
  }

  // 노출 기록 연계 (이미 있으면 무시 — 총 노출일이 중복 증가하지 않는다)
  const { error: expErr } = await supabaseAdmin
    .from(EXPOSURE_TABLE)
    .upsert([{ post_id: postId, date }], { onConflict: 'post_id,date', ignoreDuplicates: true })
  if (expErr) {
    console.error('[captures/add] 노출 기록 실패:', expErr.message)
    return NextResponse.json({ ok: true, id: captureId, url, warning: `캡처는 저장됐지만 노출 기록 실패: ${expErr.message}` })
  }

  return NextResponse.json({ ok: true, id: captureId, url, created: !existing, exposureAdded: true })
}
