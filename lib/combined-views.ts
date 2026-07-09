// 통합(누적) 조회수 계산 헬퍼 — 서버(GET/export)와 클라이언트(admin 화면)에서 공용으로 사용
//
// 개념 (2026-07-09 변경)
//   한 키워드는 현재 발행URL 1개 + 과거 URL 여러 개(past_urls, 콤마)를 가진다.
//   조회수 = 카페 readCount 합(현재+과거 URL 중 카페)
//          + 이미지호스팅 조회수 합(image_host_url + past_image_host_urls)
//          + views_base
//   앞의 두 합계는 /api/refresh-views가 라이브로 긁어 cafe_views / image_views에 "합계"로 저장한다.
//   views_base는 라이브로 구할 수 없는 값만 담는다 (삭제된 카페글, 이미지호스팅링크 없는 블로그글, 소스 리셋).
//
// ⚠️ 순수 함수만 (fetch·DB·server-only import 금지) — 클라이언트 컴포넌트에서도 import 가능해야 함

// 통합 조회수 계산에 필요한 최소 필드
export type ViewFields = {
  blog_url: string | null
  past_urls?: string | null
  image_host_url?: string | null
  past_image_host_urls?: string | null
  cafe_views: number | null
  image_views: number | null
  views_base: number | null
}

// 콤마로 구분된 문자열을 배열로. 빈 값·중복 제거.
export function splitList(s: string | null | undefined): string[] {
  if (!s) return []
  return Array.from(new Set(s.split(',').map((x) => x.trim()).filter(Boolean)))
}

// 카페 URL 여부
export function isCafe(url: string | null | undefined): boolean {
  return !!url && url.includes('cafe.naver.com')
}

// 현재 + 과거 발행URL 전체 (노출 확인·카페 조회수 합산 대상). 순서: 현재 → 과거
export function allBlogUrls(p: Pick<ViewFields, 'blog_url' | 'past_urls'>): string[] {
  const urls = [p.blog_url?.trim() || '', ...splitList(p.past_urls)].filter(Boolean)
  return Array.from(new Set(urls))
}

// 현재 + 과거 이미지호스팅URL 전체
export function allImageHostUrls(p: Pick<ViewFields, 'image_host_url' | 'past_image_host_urls'>): string[] {
  const urls = [p.image_host_url?.trim() || '', ...splitList(p.past_image_host_urls)].filter(Boolean)
  return Array.from(new Set(urls))
}

// 카페 조회수 합계 (refresh-views가 저장한 값)
export function cafeTotal(p: ViewFields): number {
  return p.cafe_views ?? 0
}

// 이미지호스팅 조회수 합계 (refresh-views가 저장한 값)
export function imageTotal(p: ViewFields): number {
  return p.image_views ?? 0
}

// 통합 조회수 = 카페 합 + 이미지 합 + 라이브로 못 구하는 과거분(base)
export function combinedViews(p: ViewFields): number {
  return cafeTotal(p) + imageTotal(p) + (p.views_base ?? 0)
}
