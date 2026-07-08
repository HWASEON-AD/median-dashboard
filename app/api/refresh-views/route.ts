import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getCafeReadCount, getImageHostViews } from '@/lib/views'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 전체 키워드의 카페 조회수(cafe_views) + 이미지호스팅 총 조회수(image_views)를 최신화한다.
// 유효한 숫자를 받은 경우에만 갱신하고, 실패/삭제(404 등)는 건드리지 않아 기존 값이 유지된다.
export async function POST() {
  const { data: posts, error } = await supabaseAdmin
    .from('median_posts')
    .select('id, blog_url, image_host_url')

  if (error) {
    // image_host_url 컬럼이 아직 없으면 여기서 에러 → 마이그레이션 안내
    return NextResponse.json({ error: error.message, hint: 'median_posts 조회수 컬럼 마이그레이션(ALTER TABLE) 실행 필요' }, { status: 500 })
  }

  let cafeUpdated = 0
  let imageUpdated = 0
  let kept = 0

  await Promise.all(
    (posts || []).map(async (p: { id: string; blog_url: string | null; image_host_url: string | null }) => {
      const patch: Record<string, number> = {}

      if (p.blog_url && p.blog_url.includes('cafe.naver.com')) {
        const v = await getCafeReadCount(p.blog_url)
        if (typeof v === 'number') { patch.cafe_views = v; cafeUpdated++ }
        else kept++
      }
      if (p.image_host_url) {
        const v = await getImageHostViews(p.image_host_url)
        if (typeof v === 'number') { patch.image_views = v; imageUpdated++ }
        else kept++
      }

      if (Object.keys(patch).length > 0) {
        await supabaseAdmin.from('median_posts').update(patch).eq('id', p.id)
      }
    }),
  )

  return NextResponse.json({ ok: true, cafeUpdated, imageUpdated, kept })
}
