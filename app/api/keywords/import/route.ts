import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { splitList } from '@/lib/combined-views'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { rows, replace } = body as {
    rows: { keyword: string; product?: string; tab?: string; tab_type?: string; blog_url?: string; hwaseon_url?: string; brand?: string }[]
    replace?: boolean
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: '데이터 없음' }, { status: 400 })
  }

  // 전체 교체 모드: 자식 테이블 먼저 삭제 후 부모 테이블 삭제 (FK 제약 방지)
  if (replace) {
    const { error: expErr } = await supabaseAdmin
      .from('median_daily_exposure')
      .delete()
      .not('post_id', 'is', null)
    if (expErr) return NextResponse.json({ error: expErr.message }, { status: 500 })

    const { error: delErr } = await supabaseAdmin
      .from('median_posts')
      .delete()
      .not('id', 'is', null)
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })
  }

  const mapped = rows
    .filter(r => r.keyword?.trim())
    .map(r => ({
      keyword: r.keyword.trim(),
      product: r.product?.trim() || null,
      tab_type: (r.tab_type || r.tab)?.trim() || null,
      blog_url: r.blog_url?.trim() || null,
      hwaseon_url: r.hwaseon_url?.trim() || null,
      brand: r.brand?.trim() || '메디안',
    }))

  // 중복 키워드+제품+브랜드는 마지막 행 기준으로 유지 (엑셀 하단 행이 최신)
  const dedupeMap = new Map<string, (typeof mapped)[number]>()
  for (const r of mapped) {
    dedupeMap.set(`${r.keyword}|||${r.product ?? ''}|||${r.brand}`, r)
  }
  const incoming = Array.from(dedupeMap.values())

  // 기존 데이터 조회 — keyword + product + brand 조합으로 매칭 (통합 조회수 스냅샷용 필드 포함)
  const { data: existing } = await supabaseAdmin
    .from('median_posts')
    .select('id, keyword, product, brand, blog_url, past_urls, hwaseon_url, past_hwaseon_urls')

  type OldRow = {
    id: string; keyword: string; product: string | null; brand: string | null
    blog_url: string | null; past_urls: string | null
    hwaseon_url: string | null; past_hwaseon_urls: string | null
  }
  const existingMap = new Map<string, OldRow>()
  for (const e of (existing || []) as OldRow[]) {
    existingMap.set(`${e.keyword}|||${e.product ?? ''}|||${e.brand ?? '메디안'}`, e)
  }

  type UpdateRow = {
    id: string; tab_type: string | null; blog_url: string | null; hwaseon_url: string | null; brand: string
    past_urls?: string | null; past_hwaseon_urls?: string | null
  }

  // 옛 값을 과거 목록 앞에 밀어넣고 중복 제거 (현재 값과 같으면 넣지 않음)
  const pushPast = (past: string | null, oldVal: string | null, newVal: string | null) => {
    const list = splitList(past)
    if (oldVal && oldVal !== newVal && !list.includes(oldVal)) list.unshift(oldVal)
    return list.filter(u => u !== newVal).join(', ') || null
  }
  const toUpdate: UpdateRow[] = []
  const toInsert: { keyword: string; product: string | null; tab_type: string | null; blog_url: string | null; hwaseon_url: string | null; brand: string; status: string }[] = []

  for (const r of incoming) {
    const old = existingMap.get(`${r.keyword}|||${r.product ?? ''}|||${r.brand}`)
    if (old) {
      const u: UpdateRow = { id: old.id, tab_type: r.tab_type, blog_url: r.blog_url, hwaseon_url: r.hwaseon_url, brand: r.brand }
      // 발행URL/제품링크URL이 바뀌면 옛 값을 past_*로 이관한다.
      // (views_base는 절대 건드리지 않는다 — 조회수는 현재+과거 URL을 refresh-views가 다시 합산한다)
      if ((r.blog_url || null) !== (old.blog_url || null)) {
        u.past_urls = pushPast(old.past_urls, old.blog_url, r.blog_url || null)
      }
      if ((r.hwaseon_url || null) !== (old.hwaseon_url || null)) {
        u.past_hwaseon_urls = pushPast(old.past_hwaseon_urls, old.hwaseon_url, r.hwaseon_url || null)
      }
      toUpdate.push(u)
    } else {
      toInsert.push({ ...r, status: '미노출' })
    }
  }

  for (const u of toUpdate) {
    const patch: Record<string, string | number | null> = {
      tab_type: u.tab_type, blog_url: u.blog_url, hwaseon_url: u.hwaseon_url, brand: u.brand,
    }
    if (u.past_urls !== undefined) patch.past_urls = u.past_urls
    if (u.past_hwaseon_urls !== undefined) patch.past_hwaseon_urls = u.past_hwaseon_urls
    await supabaseAdmin.from('median_posts').update(patch).eq('id', u.id)
  }

  let insertedCount = 0
  if (toInsert.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('median_posts')
      .insert(toInsert)
      .select()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    insertedCount = data?.length ?? 0
  }

  return NextResponse.json({ inserted: insertedCount + toUpdate.length, updated: toUpdate.length, added: insertedCount })
}
