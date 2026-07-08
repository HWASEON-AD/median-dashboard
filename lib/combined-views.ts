// 통합(누적) 조회수 계산 헬퍼 — 서버(GET/export)와 클라이언트(admin 화면)에서 공용으로 사용
// 개념: 발행URL은 항상 최신 1개만 유지하되, URL이 바뀌어도 조회수는 리셋되지 않고 계속 쌓인다.
//   combined = views_base(지난 구간들 누적) + 현재 구간 기여분
//   현재 구간 소스: blog_url이 카페 → cafe_views / 그 외(블로그 등) → image_views / 없으면 null
// ⚠️ 순수 함수만 (fetch·DB·server-only import 금지) — 클라이언트 컴포넌트에서도 import 가능해야 함

// 통합 조회수 계산에 필요한 최소 필드
export type ViewFields = {
  blog_url: string | null
  cafe_views: number | null
  image_views: number | null
  views_base: number | null
  views_offset: number | null
}

// 카페 URL 여부
export function isCafe(url: string | null | undefined): boolean {
  return !!url && url.includes('cafe.naver.com')
}

// 현재 구간의 소스 조회수 (소스 없으면 null)
export function currentSource(p: ViewFields): number | null {
  if (isCafe(p.blog_url)) return p.cafe_views
  if (p.blog_url) return p.image_views
  return null
}

// 현재 구간 기여분 = max(0, 소스 - offset). 소스 없으면 0
export function currentContribution(p: ViewFields): number {
  const src = currentSource(p)
  if (src == null) return 0
  return Math.max(0, src - (p.views_offset ?? 0))
}

// 통합 조회수 = 지난 구간 누적 + 현재 구간 기여분
export function combinedViews(p: ViewFields): number {
  return (p.views_base ?? 0) + currentContribution(p)
}

// URL 교체 시 스냅샷 계산 (PATCH·import 공용)
// - 옛 구간 최종 조회수(finalOldViews)를 base에 누적하고, 새 구간의 offset/소스 리셋 여부를 계산한다.
// - finalOldViews는 호출측 책임(PATCH=라이브 조회 후 저장값 폴백 / import=저장값). null이면 0으로 취급.
export function computeSnapshot(params: {
  oldBlogUrl: string | null
  newBlogUrl: string | null
  oldImageViews: number | null  // 현재 DB에 저장된 image_views
  prevBase: number
  prevOffset: number
  finalOldViews: number | null  // 옛 구간의 최종 조회수 (null → 0)
  imageChanged: boolean         // 이번 교체에서 image_host_url도 새 값으로 바뀌는지
}): { views_base: number; views_offset: number; reset_cafe_views: boolean; reset_image_views: boolean } {
  const { oldBlogUrl, newBlogUrl, oldImageViews, prevBase, prevOffset, finalOldViews, imageChanged } = params

  // 옛 구간 기여분을 base에 누적 (옛 URL이 없었으면 기여 0)
  const contribution = oldBlogUrl ? Math.max(0, (finalOldViews ?? 0) - prevOffset) : 0
  const views_base = prevBase + contribution

  // 새 구간 오프셋 및 소스 리셋 결정
  let views_offset = 0
  let reset_cafe_views = false
  let reset_image_views = false

  if (isCafe(newBlogUrl)) {
    // 새 카페 구간: readCount는 새 글 기준 → 소스 리셋, offset 0
    views_offset = 0
    reset_cafe_views = true
  } else if (newBlogUrl) {
    // 새 블로그 구간
    if (imageChanged) {
      // 이미지도 새로 바뀜 → 새 이미지 조회수는 새 카운터 → 소스 리셋, offset 0
      views_offset = 0
      reset_image_views = true
    } else {
      // 같은 이미지 재사용 → 이미 base에 반영된 만큼(현재 image_views)을 offset으로 제외해 중복 방지
      views_offset = oldImageViews ?? 0
    }
  } else {
    // 새 blog_url 없음(제거) → 현재 구간 소스 없음
    views_offset = 0
  }

  return { views_base, views_offset, reset_cafe_views, reset_image_views }
}
