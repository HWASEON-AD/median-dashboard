import { createClient } from '@supabase/supabase-js'

// 빌드(page data 수집) 시점에 env가 비어 있어도 createClient가 throw하지 않도록 폴백을 둔다.
// 실제 런타임(Production)에서는 Vercel 환경변수가 주입되어 정상 동작한다.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key'
const service = process.env.SUPABASE_SERVICE_KEY || 'placeholder-service-key'

// ⚠️ Next.js App Router는 서버에서 일어나는 fetch(GET)를 Data Cache에 저장한다.
// supabase-js도 내부적으로 fetch를 쓰므로, 그대로 두면 DB가 바뀌어도 옛 응답이 돌아온다.
// (실제 사고: search_volume_at을 갱신했는데 select가 계속 null을 반환 → 캐시가 매번 미스로 판정)
// 모든 Supabase 요청을 no-store로 강제해 항상 실시간 값을 읽는다.
const noStoreFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, cache: 'no-store' })

export const supabase = createClient(url, anon, { global: { fetch: noStoreFetch } })
export const supabaseAdmin = createClient(url, service, { global: { fetch: noStoreFetch } })
