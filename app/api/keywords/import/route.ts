import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { isCafe, computeSnapshot } from '@/lib/combined-views'

// 옛 구간 최종 조회수를 저장값 기반으로만 산출 (bulk라 라이브 fetch 안 함)
function storedFinalViews(o: { blog_url: string | null; cafe_views: number | null; image_views: number | null }): number | null {
  if (isCafe(o.blog_url)) return o.cafe_views
  if (o.blog_url) return o.image_views
  return null
}

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
    .select('id, keyword, product, brand, blog_url, image_host_url, cafe_views, image_views, views_base, views_offset')

  type OldRow = {
    id: string; keyword: string; product: string | null; brand: string | null
    blog_url: string | null; image_host_url: string | null
    cafe_views: number | null; image_views: number | null
    views_base: number | null; views_offset: number | null
  }
  const existingMap = new Map<string, OldRow>()
  for (const e of (existing || []) as OldRow[]) {
    existingMap.set(`${e.keyword}|||${e.product ?? ''}|||${e.brand ?? '메디안'}`, e)
  }

  type UpdateRow = {
    id: string; tab_type: string | null; blog_url: string | null; hwaseon_url: string | null; brand: string
    views_base?: number; views_offset?: number; cafe_views?: null; image_views?: null
  }
  const toUpdate: UpdateRow[] = []
  const toInsert: { keyword: string; product: string | null; tab_type: string | null; blog_url: string | null; hwaseon_url: string | null; brand: string; status: string }[] = []

  for (const r of incoming) {
    const old = existingMap.get(`${r.keyword}|||${r.product ?? ''}|||${r.brand}`)
    if (old) {
      const u: UpdateRow = { id: old.id, tab_type: r.tab_type, blog_url: r.blog_url, hwaseon_url: r.hwaseon_url, brand: r.brand }
      // 발행URL이 실제로 바뀌면 통합 조회수 스냅샷 (라이브 fetch 없이 저장값 기반)
      const oldBlogUrl = old.blog_url || null
      const newBlogUrl = r.blog_url || null
      if (newBlogUrl !== oldBlogUrl) {
        // import는 image_host_url을 건드리지 않음 → imageChanged=false (같은 이미지 재사용)
        const snap = computeSnapshot({
          oldBlogUrl,
          newBlogUrl,
          oldImageViews: old.image_views,
          prevBase: old.views_base ?? 0,
          prevOffset: old.views_offset ?? 0,
          finalOldViews: storedFinalViews(old),
          imageChanged: false,
        })
        u.views_base = snap.views_base
        u.views_offset = snap.views_offset
        if (snap.reset_cafe_views) u.cafe_views = null
        if (snap.reset_image_views) u.image_views = null
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
    if (u.views_base !== undefined) patch.views_base = u.views_base
    if (u.views_offset !== undefined) patch.views_offset = u.views_offset
    if (u.cafe_views !== undefined) patch.cafe_views = u.cafe_views
    if (u.image_views !== undefined) patch.image_views = u.image_views
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
