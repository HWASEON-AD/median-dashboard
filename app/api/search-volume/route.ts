import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getSearchVolumes, type SearchVolumeMap } from '@/lib/naver-searchad'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

// 검색량 기준일 (KST 06:00 갱신).
// 06시 이전이면 아직 어제분이 유효하므로 어제 날짜를 기준일로 삼는다.
// → 06시가 지난 뒤 들어온 첫 요청에서만 네이버를 다시 호출한다.
function volumeDateKST(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  if (kst.getUTCHours() < 6) kst.setUTCDate(kst.getUTCDate() - 1)
  return kst.toISOString().slice(0, 10)
}

// 키워드 검색량 조회 API
// - 기준일에 이미 조회한 키워드는 DB 캐시(search_volume*)를 그대로 반환
// - 신규 키워드(캐시 없음) 또는 기준일이 지난 키워드만 네이버 검색광고 API 호출 후 캐시에 기록
export async function GET() {
  const date = volumeDateKST()

  // env 미설정 시 500 대신 빈 결과 반환 (프론트 안 죽게)
  if (
    !process.env.NAVER_API_KEY ||
    !process.env.NAVER_API_SECRET ||
    !process.env.NAVER_API_CUSTOMER_ID
  ) {
    return NextResponse.json({ date, volumes: {}, error: 'NAVER API env 미설정' })
  }

  try {
    const { data: posts, error: postsErr } = await supabaseAdmin
      .from('median_posts')
      .select('id, keyword, search_volume, search_volume_pc, search_volume_mobile, search_volume_at')

    if (postsErr) {
      return NextResponse.json({ date, volumes: {}, error: postsErr.message })
    }

    // 캐시가 기준일과 같으면 신선, 아니면 재조회 대상
    const volumes: SearchVolumeMap = {}
    const stale = new Set<string>()
    for (const p of posts || []) {
      const kw = (p.keyword || '').trim()
      if (!kw) continue
      if (p.search_volume_at === date && p.search_volume != null) {
        volumes[kw] = {
          pc: p.search_volume_pc ?? 0,
          mobile: p.search_volume_mobile ?? 0,
          total: p.search_volume,
        }
      } else {
        stale.add(kw)
      }
    }

    if (stale.size === 0) {
      return NextResponse.json({ date, volumes, cached: true, fetched: 0 })
    }

    // 재조회가 필요한 키워드만 네이버 호출
    const fresh = await getSearchVolumes(Array.from(stale))
    Object.assign(volumes, fresh)

    // 캐시 기록 (병렬). 실패해도 응답은 정상 — 다음 요청에서 다시 시도된다.
    try {
      await Promise.all(
        (posts || [])
          .filter((p) => stale.has((p.keyword || '').trim()) && fresh[(p.keyword || '').trim()])
          .map((p) => {
            const v = fresh[(p.keyword || '').trim()]
            return supabaseAdmin
              .from('median_posts')
              .update({
                search_volume: v.total,
                search_volume_pc: v.pc,
                search_volume_mobile: v.mobile,
                search_volume_at: date,
              })
              .eq('id', p.id)
          }),
      )
    } catch (updErr) {
      console.error('[search-volume] 캐시 기록 실패:', updErr)
    }

    return NextResponse.json({ date, volumes, cached: false, fetched: stale.size })
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류'
    console.error('[search-volume] 예외 발생:', err)
    return NextResponse.json({ date, volumes: {}, error: message })
  }
}
