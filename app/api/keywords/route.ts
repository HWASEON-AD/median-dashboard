import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET() {
  // 두 테이블 별도 조회 후 코드에서 합치기 (nested select 관계 인식 문제 우회)
  const { data: posts, error: postsErr } = await supabaseAdmin
    .from('amos_posts')
    .select('*')
    .order('keyword')

  if (postsErr) return NextResponse.json({ error: postsErr.message }, { status: 500 })

  const { data: exposures } = await supabaseAdmin
    .from('amos_daily_exposure')
    .select('post_id, date')

  // 포스트별 노출 기록 합치기 (presence = 노출, is_exposed는 항상 true)
  const exposureMap: Record<string, { date: string; is_exposed: boolean }[]> = {}
  for (const e of exposures || []) {
    if (!exposureMap[e.post_id]) exposureMap[e.post_id] = []
    exposureMap[e.post_id].push({ date: e.date, is_exposed: true })
  }

  const result = (posts || []).map(p => ({
    ...p,
    amos_daily_exposure: exposureMap[p.id] || [],
  }))

  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { keyword, product, blog_url, hwaseon_url, tab, tab_type, brand } = body

  if (!keyword) return NextResponse.json({ error: '키워드 필수' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('amos_posts')
    .insert({
      keyword,
      product: product || null,
      blog_url: blog_url || null,
      hwaseon_url: hwaseon_url || null,
      tab_type: tab_type || tab || null,
      brand: brand || '아모스',
      status: '미노출',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
