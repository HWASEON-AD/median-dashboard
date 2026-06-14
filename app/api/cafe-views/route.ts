import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  if (!url) return NextResponse.json({ error: 'url 필요' }, { status: 400 })

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ko-KR,ko;q=0.9',
        'Referer': 'https://cafe.naver.com/',
      },
      next: { revalidate: 300 },
    })
    const html = await res.text()
    // <span class="count">조회 904</span> 패턴
    const match = html.match(/class="count"[^>]*>조회\s*([\d,]+)<\/span>/) ||
                  html.match(/조회\s*([\d,]+)/)
    if (!match) return NextResponse.json({ views: null })
    const views = parseInt(match[1].replace(/,/g, ''), 10)
    return NextResponse.json({ views })
  } catch {
    return NextResponse.json({ views: null })
  }
}
