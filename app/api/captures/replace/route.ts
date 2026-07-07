import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// 캡처 이미지 수동 교체: 잘못 찍힌 캡처(빨간 테두리 오류 등)를 사용자가 편집한 이미지로 바꾼다.
// - Storage에는 새 경로(_edited_타임스탬프)로 올려 CDN 캐시가 옛 이미지를 물고 있는 문제를 피한다.
// - mode='basic'이면 image_url, 'full'이면 full_image_url 컬럼을 갱신한다.
const BUCKET = 'median-captures'
const TABLE = 'median_daily_captures'
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

  const id = form.get('id')
  const mode = form.get('mode') === 'full' ? 'full' : 'basic'
  const file = form.get('file')

  if (typeof id !== 'string' || !id) {
    return NextResponse.json({ error: '캡처 id가 없습니다.' }, { status: 400 })
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

  // 교체 대상 캡처 레코드 확인 (존재하는 캡처만 교체 가능)
  const { data: rec, error: findErr } = await supabaseAdmin
    .from(TABLE)
    .select('id, post_id, date')
    .eq('id', id)
    .single()
  if (findErr || !rec) {
    return NextResponse.json({ error: '해당 캡처를 찾을 수 없습니다.' }, { status: 404 })
  }

  const suffix = mode === 'full' ? '_full' : ''
  const path = `captures/${rec.date}/${rec.post_id}${suffix}_edited_${Date.now()}.${ext}`
  const buf = Buffer.from(await file.arrayBuffer())

  const { error: upErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, buf, { contentType: file.type, upsert: true })
  if (upErr) {
    console.error('[captures/replace] 스토리지 업로드 실패:', upErr.message)
    return NextResponse.json({ error: `업로드 실패: ${upErr.message}` }, { status: 500 })
  }

  const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path)
  const newUrl = pub.publicUrl

  const col = mode === 'full' ? 'full_image_url' : 'image_url'
  const { error: dbErr } = await supabaseAdmin
    .from(TABLE)
    .update({ [col]: newUrl })
    .eq('id', id)
  if (dbErr) {
    console.error('[captures/replace] DB 갱신 실패:', dbErr.message)
    return NextResponse.json({ error: `DB 갱신 실패: ${dbErr.message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true, mode, url: newUrl })
}
