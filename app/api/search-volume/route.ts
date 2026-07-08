import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getSearchVolumes, type SearchVolumeMap } from '@/lib/naver-searchad'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

// KST 기준 오늘 날짜 (YYYY-MM-DD)
function todayKST(): string {
  const now = new Date()
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(0, 10)
}

// 키워드 검색량 조회 API
// median_posts의 키워드 전체를 중복 제거해 네이버 검색광고 API로 검색량 조회
export async function GET() {
  const date = todayKST()

  // env 미설정 시 500 대신 빈 결과 반환 (프론트 안 죽게)
  if (
    !process.env.NAVER_API_KEY ||
    !process.env.NAVER_API_SECRET ||
    !process.env.NAVER_API_CUSTOMER_ID
  ) {
    return NextResponse.json({ date, volumes: {}, error: 'NAVER API env 미설정' })
  }

  try {
    // median_posts에서 id, keyword 전체 조회
    const { data: posts, error: postsErr } = await supabaseAdmin
      .from('median_posts')
      .select('id, keyword')

    if (postsErr) {
      return NextResponse.json({ date, volumes: {}, error: postsErr.message })
    }

    // 중복 제거한 키워드 목록
    const keywords = Array.from(
      new Set(
        (posts || [])
          .map((p) => (p.keyword || '').trim())
          .filter((k) => k.length > 0)
      )
    )

    if (keywords.length === 0) {
      return NextResponse.json({ date, volumes: {} })
    }

    // 검색량 조회
    const volumes: SearchVolumeMap = await getSearchVolumes(keywords)

    // best-effort로 median_posts.search_volume(total) 업데이트 (실패해도 응답은 정상)
    try {
      for (const post of posts || []) {
        const kw = (post.keyword || '').trim()
        const vol = volumes[kw]
        if (!vol) continue
        await supabaseAdmin
          .from('median_posts')
          .update({ search_volume: vol.total })
          .eq('id', post.id)
      }
    } catch (updErr) {
      console.error('[search-volume] search_volume 업데이트 실패:', updErr)
    }

    return NextResponse.json({ date, volumes })
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류'
    console.error('[search-volume] 예외 발생:', err)
    return NextResponse.json({ date, volumes: {}, error: message })
  }
}
