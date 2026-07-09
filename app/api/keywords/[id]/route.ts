import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// 수정 가능한 필드. past_*는 콤마 구분 문자열.
const EDITABLE = [
  'keyword', 'product', 'blog_url', 'past_urls', 'hwaseon_url', 'past_hwaseon_urls',
  'image_host_url', 'past_image_host_urls', 'tab_type', 'status', 'brand',
] as const

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json()

  const updates: Record<string, string | number | null> = { updated_at: new Date().toISOString() }
  for (const field of EDITABLE) {
    if (body[field] !== undefined) updates[field] = body[field] || null
  }

  // ⚠️ views_base는 여기서 절대 건드리지 않는다.
  // 예전에는 blog_url이 바뀌면 computeSnapshot()으로 views_base를 다시 계산해 덮어썼다.
  // 지금은 과거 URL을 past_urls에 남겨 조회수를 계속 합산하므로 스냅샷이 필요 없고,
  // views_base는 "라이브로 못 구하는 과거분"만 담는 수동 값이라 덮어쓰면 기록이 사라진다.
  // cafe_views / image_views는 /api/refresh-views가 현재+과거 URL 전체를 다시 합산해 채운다.

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
  // 주의: median_daily_exposure가 FK cascade로 함께 삭제된다 (노출 기록 소실)
  const { error } = await supabaseAdmin
    .from('median_posts')
    .delete()
    .eq('id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
