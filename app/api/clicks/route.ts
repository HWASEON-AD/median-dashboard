import { NextRequest, NextResponse } from 'next/server'

const HWASEON_URL_BASE = 'https://hwaseon-url.com'
const ADMIN_KEY = process.env.HWASEON_URL_ADMIN_KEY!

// shortCode별 클릭수 조회
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  if (!code) return NextResponse.json({ error: 'code 필요' }, { status: 400 })

  try {
    const res = await fetch(`${HWASEON_URL_BASE}/api/stats/${code}`, {
      headers: { 'x-admin-key': ADMIN_KEY },
      cache: 'no-store',
    })
    if (!res.ok) return NextResponse.json({ totalVisits: 0, todayVisits: 0 })
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ totalVisits: 0, todayVisits: 0 })
  }
}
