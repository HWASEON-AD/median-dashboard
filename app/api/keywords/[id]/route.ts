import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getCafeReadCount, getImageHostViews } from '@/lib/views'
import { isCafe, computeSnapshot } from '@/lib/combined-views'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json()

  const updates: Record<string, string | number | null> = { updated_at: new Date().toISOString() }
  for (const field of ['keyword', 'product', 'blog_url', 'hwaseon_url', 'image_host_url', 'tab_type', 'status', 'brand']) {
    if (body[field] !== undefined) updates[field] = body[field] || null
  }

  // 발행URL(blog_url)이 실제로 바뀌는 경우 → 통합 조회수 스냅샷 (옛 구간 누적, 새 구간 오프셋)
  if (body.blog_url !== undefined) {
    const { data: old } = await supabaseAdmin
      .from('median_posts')
      .select('blog_url, image_host_url, cafe_views, image_views, views_base, views_offset')
      .eq('id', params.id)
      .single()

    const newBlogUrl: string | null = body.blog_url || null
    const oldBlogUrl: string | null = old?.blog_url || null

    if (old && newBlogUrl !== oldBlogUrl) {
      // 옛 URL의 조회수를 라이브로 최종 조회 (실패 시 저장값 폴백, 그것도 없으면 0)
      let finalOldViews: number | null = null
      if (isCafe(oldBlogUrl)) {
        finalOldViews = await getCafeReadCount(oldBlogUrl as string)
        if (finalOldViews == null) finalOldViews = old.cafe_views
      } else if (oldBlogUrl) {
        finalOldViews = old.image_host_url ? await getImageHostViews(old.image_host_url) : null
        if (finalOldViews == null) finalOldViews = old.image_views
      }

      // 이번 PATCH에서 image_host_url도 새 값으로 바뀌는지
      const imageChanged =
        body.image_host_url !== undefined && (body.image_host_url || null) !== (old.image_host_url || null)

      const snap = computeSnapshot({
        oldBlogUrl,
        newBlogUrl,
        oldImageViews: old.image_views,
        prevBase: old.views_base ?? 0,
        prevOffset: old.views_offset ?? 0,
        finalOldViews,
        imageChanged,
      })

      updates.views_base = snap.views_base
      updates.views_offset = snap.views_offset
      // 새 구간 소스는 새 글/새 이미지 기준 → 스냅샷 지시대로 리셋(다음 refresh-views에서 새 값 채움, 중복 합산 방지)
      if (snap.reset_cafe_views) updates.cafe_views = null
      if (snap.reset_image_views) updates.image_views = null
    }
  }

  const { data, error } = await supabaseAdmin
    .from('median_posts')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await supabaseAdmin
    .from('median_posts')
    .delete()
    .eq('id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
