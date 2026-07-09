import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getCafeReadCount, getImageHostViews, getKinViews } from '@/lib/views'
import { allBlogUrls, allImageHostUrls, isCafe, isKin } from '@/lib/combined-views'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 전체 키워드의 조회수를 최신화한다.
//  cafe_views  = 현재 발행URL + 과거 URL 중 "카페글" readCount 합 + "지식인" 조회수 합
//  image_views = 현재 + 과거 이미지호스팅URL들의 조회수 합
// 원칙: 살아있는 소스만 더한다. 전부 실패하면 갱신하지 않아 기존 값이 유지된다.
//       (삭제된 카페글의 마지막 값은 views_base에 보존되어 있으므로 합계에서 빠져도 총합은 줄지 않는다)
export async function POST() {
  const { data: posts, error } = await supabaseAdmin
    .from('median_posts')
    .select('id, blog_url, past_urls, image_host_url, past_image_host_urls')

  if (error) {
    return NextResponse.json({ error: error.message, hint: 'past_* 컬럼 마이그레이션 필요' }, { status: 500 })
  }

  let cafeUpdated = 0
  let imageUpdated = 0
  let kept = 0
  let deadSources = 0

  await Promise.all(
    (posts || []).map(async (p) => {
      const patch: Record<string, number> = {}

      // --- 카페 + 지식인 조회수 합 (둘 다 cafe_views에 저장) ---
      const urls = allBlogUrls(p)
      const cafeUrls = urls.filter(isCafe)
      const kinUrls = urls.filter(isKin)
      if (cafeUrls.length + kinUrls.length > 0) {
        const values = await Promise.all([
          ...cafeUrls.map((u) => getCafeReadCount(u)),
          ...kinUrls.map((u) => getKinViews(u)),
        ])
        const live = values.filter((v): v is number => typeof v === 'number')
        deadSources += values.length - live.length
        if (live.length > 0) {
          patch.cafe_views = live.reduce((a, b) => a + b, 0)
          cafeUpdated++
        } else {
          kept++
        }
      }

      // --- 이미지호스팅 조회수 합 ---
      const imgUrls = allImageHostUrls(p)
      if (imgUrls.length > 0) {
        const values = await Promise.all(imgUrls.map((u) => getImageHostViews(u)))
        const live = values.filter((v): v is number => typeof v === 'number')
        deadSources += values.length - live.length
        if (live.length > 0) {
          patch.image_views = live.reduce((a, b) => a + b, 0)
          imageUpdated++
        } else {
          kept++
        }
      }

      if (Object.keys(patch).length > 0) {
        await supabaseAdmin.from('median_posts').update(patch).eq('id', p.id)
      }
    }),
  )

  return NextResponse.json({ ok: true, cafeUpdated, imageUpdated, kept, deadSources })
}
