import { NextRequest, NextResponse } from 'next/server'

const HWASEON_URL_BASE = 'https://hwaseon-url.com'
const ADMIN_KEY = process.env.HWASEON_URL_ADMIN_KEY!

// 단축코드 1개의 누적 클릭수. 실패하면 null (합산에서 제외)
async function fetchVisits(code: string): Promise<number | null> {
  try {
    const res = await fetch(`${HWASEON_URL_BASE}/api/stats/${code}`, {
      headers: { 'x-admin-key': ADMIN_KEY },
      cache: 'no-store',
    })
    if (!res.ok) return null
    const data = await res.json()
    return typeof data?.totalVisits === 'number' ? data.totalVisits : null
  } catch {
    return null
  }
}

// 클릭수 조회.
//  ?code=abc            → 단일 코드
//  ?code=abc,def,ghi    → 현재 + 과거 제품링크URL의 코드들. 살아있는 값만 합산한다.
// hwaseon-url의 totalVisits는 코드별 전체 누적이라 과거분이 이미 포함되어 있다.
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('code')
  if (!raw) return NextResponse.json({ error: 'code 필요' }, { status: 400 })

  const codes = Array.from(new Set(raw.split(',').map((c) => c.trim()).filter(Boolean)))
  if (codes.length === 0) return NextResponse.json({ error: 'code 필요' }, { status: 400 })

  const results = await Promise.all(codes.map(fetchVisits))
  const live = results.filter((v): v is number => typeof v === 'number')

  return NextResponse.json({
    totalVisits: live.reduce((a, b) => a + b, 0),
    codes: codes.length,
    resolved: live.length,
  })
}
