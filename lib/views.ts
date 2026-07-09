// 카페 조회수 + 이미지호스팅(총) 조회수 수집 헬퍼 (서버 사이드 전용)
// 원칙: 유효한 숫자를 받았을 때만 값을 반환하고, 실패/삭제(404 등)는 null → 호출측에서 기존 값 유지

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'

// 네이버 카페 글 실제 조회수(readCount) 조회
// 1) 카페 껍데기 페이지에서 clubid(=cafeId) 추출 → 2) 비공식 글 API 호출
// 반환: 조회수(number) / 실패·삭제(404 등)면 null
export async function getCafeReadCount(blogUrl: string): Promise<number | null> {
  const norm = blogUrl.replace('m.cafe.naver.com', 'cafe.naver.com')
  const m = norm.match(/cafe\.naver\.com\/([^/?#]+)\/(\d+)/)
  if (!m) return null
  const cafeName = m[1]
  const articleId = m[2]
  try {
    // clubid 추출 (페이지는 EUC-KR이지만 clubid는 ASCII 숫자라 regex 매칭 안전)
    const pageRes = await fetch(`https://cafe.naver.com/${cafeName}/${articleId}`, {
      headers: { 'User-Agent': DESKTOP_UA, Accept: '*/*', Referer: 'https://cafe.naver.com/' },
      cache: 'no-store',
    })
    if (!pageRes.ok) return null
    const html = await pageRes.text()
    const cm = html.match(/clubid=(\d+)/)
    if (!cm) return null
    const clubid = cm[1]

    // 비공식 카페 글 API (인증 불필요). 정상=200+readCount, 삭제/없음=404
    const apiRes = await fetch(
      `https://apis.naver.com/cafe-web/cafe-articleapi/v2.1/cafes/${clubid}/articles/${articleId}?query=&menuId=0&boardType=L`,
      { headers: { 'User-Agent': MOBILE_UA, Accept: 'application/json', Referer: 'https://m.cafe.naver.com/' }, cache: 'no-store' },
    )
    if (!apiRes.ok) return null // 404(삭제) 포함 → null → 기존 값 유지
    const j = await apiRes.json()
    const rc = j?.result?.article?.readCount
    return typeof rc === 'number' ? rc : null
  } catch {
    return null
  }
}

// hwaseon-image.com 총 조회수(views) 조회
// URL(.../image/<id> 또는 .../uploads/<id>.<ext>)에서 id 추출 → /image/<id>/detail
// 반환: views(number) / 실패·없음(404)면 null
export async function getImageHostViews(imageHostUrl: string): Promise<number | null> {
  if (!imageHostUrl) return null
  const m = imageHostUrl.match(/hwaseon-image\.com\/(?:image|uploads)\/([a-zA-Z0-9_-]+)/)
  if (!m) return null
  const id = m[1]
  try {
    const r = await fetch(`https://hwaseon-image.com/image/${id}/detail`, {
      headers: { 'User-Agent': DESKTOP_UA, Accept: 'application/json' },
      cache: 'no-store',
    })
    if (!r.ok) return null // 404(없음) → null → 기존 값 유지
    const j = await r.json()
    return typeof j?.views === 'number' ? j.views : null
  } catch {
    return null
  }
}

// 네이버 지식인 조회수 조회
// 상세 페이지 HTML의 `<span class="infoItem">조회수 240</span>` 에서 숫자 추출
// 반환: 조회수(number) / 실패·삭제면 null
export async function getKinViews(kinUrl: string): Promise<number | null> {
  if (!kinUrl || !kinUrl.includes('kin.naver.com')) return null
  try {
    const r = await fetch(kinUrl, { headers: { 'User-Agent': DESKTOP_UA }, cache: 'no-store' })
    if (!r.ok) return null
    const html = await r.text()
    const m = html.match(/조회수\s*([\d,]+)/)
    if (!m) return null
    const n = Number(m[1].replace(/,/g, ''))
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}
