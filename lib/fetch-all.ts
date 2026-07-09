// PostgREST는 한 번에 최대 1000행만 반환한다 (Supabase 기본 max-rows).
// 노출 기록처럼 행 수가 1000을 넘는 테이블은 반드시 range 페이지네이션으로 전부 읽어야 한다.
// (실사고 2026-07-09: 노출 기록 2,083건 중 1,000건만 조회되어 '총 노출일'이 잘려 보였다)

const PAGE = 1000

// range()를 가진 Supabase 쿼리 빌더면 무엇이든 받는다 (제네릭 시그니처가 버전마다 달라 최소 계약만 요구)
type RangeQuery<T> = {
  range(from: number, to: number): PromiseLike<{ data: T[] | null; error: { message: string } | null }>
}

export async function fetchAllRows<T>(makeQuery: () => RangeQuery<T>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await makeQuery().range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = data || []
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}
