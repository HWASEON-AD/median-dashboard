// 네이버 검색광고 API (keywordstool) 기반 키워드 검색량 조회 라이브러리
// 서버 사이드 전용 — API 키는 환경변수로만 사용한다.
import crypto from 'crypto'

const NAVER_API_BASE = 'https://api.naver.com'

// 반환 타입: 원본 키워드 문자열 → 검색량
export type SearchVolume = { pc: number; mobile: number; total: number }
export type SearchVolumeMap = Record<string, SearchVolume>

// HMAC-SHA256 서명 생성
// 네이버 검색광고 API 공식 서명 포맷: `{timestamp}.{method}.{uri}` (마침표 구분, base64)
function createSignature(
  timestamp: string,
  method: string,
  uri: string,
  secret: string
): string {
  const message = `${timestamp}.${method}.${uri}`
  return crypto.createHmac('sha256', secret).update(message).digest('base64')
}

// 요청 헤더 생성
function buildHeaders(
  method: string,
  uri: string,
  apiKey: string,
  secret: string,
  customerId: string
): Record<string, string> {
  const timestamp = String(Date.now())
  return {
    'Content-Type': 'application/json; charset=UTF-8',
    'X-Timestamp': timestamp,
    'X-API-KEY': apiKey,
    'X-Customer': customerId,
    'X-Signature': createSignature(timestamp, method, uri, secret),
  }
}

// 키워드 정규화: 공백 제거 + 대문자
// 네이버는 hintKeywords의 공백을 제거하고 relKeyword를 공백 없는 대문자로 반환하므로
// 요청/응답 매칭을 위해 동일한 정규화 키를 사용한다.
function normalizeKey(keyword: string): string {
  return keyword.replace(/\s+/g, '').toUpperCase()
}

// 검색량 값 파싱 — '< 10' 같은 저검색량 문자열 처리
// 파이썬 툴 기준: '< 10' 은 실제 10 미만이므로 5로 근사, 숫자 파싱 실패 시 0
function parseCount(val: number | string | undefined | null): number {
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0
  if (typeof val === 'string') {
    const trimmed = val.trim()
    // '< 10' / '<10' 등 저검색량 표기 → 5로 근사
    if (trimmed.startsWith('<')) return 5
    const n = parseInt(trimmed.replace(/,/g, ''), 10)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

type NaverApiKeywordRow = {
  relKeyword?: string
  monthlyPcQcCnt?: number | string
  monthlyMobileQcCnt?: number | string
}

// 배치 사이 딜레이 (레이트리밋 회피)
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 키워드 검색량 조회 — 5개씩 배치로 keywordstool 호출
// 반환 맵의 키는 입력 원본 키워드 문자열을 그대로 유지한다.
export async function getSearchVolumes(keywords: string[]): Promise<SearchVolumeMap> {
  const apiKey = process.env.NAVER_API_KEY
  const apiSecret = process.env.NAVER_API_SECRET
  const customerId = process.env.NAVER_API_CUSTOMER_ID

  // 환경변수 미설정 시 빈 맵 반환 (호출부에서 처리)
  if (!apiKey || !apiSecret || !customerId) {
    console.warn('[naver-searchad] 환경변수 미설정 - 빈 결과 반환')
    return {}
  }

  const uri = '/keywordstool'
  const result: SearchVolumeMap = {}

  // 공백/빈문자 제거한 유효 키워드만 대상으로
  const validKeywords = keywords.filter((k) => k && k.trim().length > 0)

  for (let i = 0; i < validKeywords.length; i += 5) {
    const batch = validKeywords.slice(i, i + 5)

    // 요청 시 공백 제거해서 hintKeywords 전달
    const hint = batch.map((k) => k.replace(/\s+/g, '')).join(',')

    try {
      const headers = buildHeaders('GET', uri, apiKey, apiSecret, customerId)
      const url = `${NAVER_API_BASE}${uri}?hintKeywords=${encodeURIComponent(hint)}&showDetail=1`
      const res = await fetch(url, { method: 'GET', headers, cache: 'no-store' })

      if (!res.ok) {
        const errText = await res.text()
        console.error('[naver-searchad] 배치 응답 오류:', res.status, errText)
        // 에러난 배치는 스킵하고 다음 배치 진행 (부분 성공 허용)
        if (i + 5 < validKeywords.length) await sleep(250)
        continue
      }

      const json = (await res.json()) as { keywordList?: NaverApiKeywordRow[] }
      const rows: NaverApiKeywordRow[] = Array.isArray(json.keywordList) ? json.keywordList : []

      // 응답의 relKeyword(정규화) → 검색량 맵 구성
      const rowByKey: Record<string, NaverApiKeywordRow> = {}
      for (const row of rows) {
        if (!row.relKeyword) continue
        rowByKey[normalizeKey(row.relKeyword)] = row
      }

      // 배치의 각 원본 키워드를 정규화 키로 대조 → 원본 키 그대로 저장
      for (const original of batch) {
        const row = rowByKey[normalizeKey(original)]
        if (!row) continue
        const pc = parseCount(row.monthlyPcQcCnt)
        const mobile = parseCount(row.monthlyMobileQcCnt)
        result[original] = { pc, mobile, total: pc + mobile }
      }
    } catch (err) {
      // 예외난 배치는 스킵하고 나머지 진행
      console.error('[naver-searchad] 배치 예외:', err)
    }

    // 배치 사이 딜레이 (마지막 배치 뒤에는 생략)
    if (i + 5 < validKeywords.length) await sleep(250)
  }

  return result
}
