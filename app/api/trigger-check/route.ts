import { NextRequest, NextResponse } from 'next/server'

// 키워드 추가/수정 시 즉시 1회 네이버 노출 체크 워크플로를 수동 트리거한다
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const post_id = body?.post_id

  const token = process.env.GH_DISPATCH_TOKEN
  if (!token) {
    return NextResponse.json({ error: 'GH_DISPATCH_TOKEN 미설정' }, { status: 500 })
  }

  // median repo의 naver_daily_check.yml 워크플로를 main 브랜치 기준으로 dispatch
  const url = 'https://api.github.com/repos/HWASEON-AD/median-dashboard/actions/workflows/naver_daily_check.yml/dispatches'

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ ref: 'main', inputs: { post_id: post_id || '' } }),
    })

    // GitHub workflow_dispatch 성공은 204 No Content
    if (!r.ok && r.status !== 204) {
      const text = await r.text().catch(() => '')
      return NextResponse.json(
        { error: `dispatch 실패 (${r.status})`, detail: text.slice(0, 300) },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    // 네트워크 등 예외 처리
    return NextResponse.json(
      { error: `dispatch 호출 오류: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    )
  }
}
