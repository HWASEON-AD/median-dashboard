import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const dateParam = req.nextUrl.searchParams.get('date')

  // 날짜 미지정 시 가장 최근 캡처 날짜 조회
  let date = dateParam
  if (!date) {
    const { data: latest } = await supabaseAdmin
      .from('median_daily_captures')
      .select('date')
      .order('date', { ascending: false })
      .limit(1)
    date = latest?.[0]?.date ?? new Date().toISOString().slice(0, 10)
  }

  // full_image_url 컬럼이 아직 없을 수 있으므로, 있으면 포함해서 조회하고
  // 없어서 에러가 나면 그 컬럼을 뺀 기본 select로 폴백한다 (캡처 화면이 통째로 비지 않게).
  const baseCols = 'id, post_id, date, brand, keyword, product, image_url, captured_at'
  const { data, error } = await supabaseAdmin
    .from('median_daily_captures')
    .select(`${baseCols}, full_image_url`)
    .eq('date', date)
    .order('brand', { ascending: true })
    .order('keyword', { ascending: true })

  if (error) {
    const fb = await supabaseAdmin
      .from('median_daily_captures')
      .select(baseCols)
      .eq('date', date)
      .order('brand', { ascending: true })
      .order('keyword', { ascending: true })
    if (fb.error) return NextResponse.json({ date, records: [] })
    return NextResponse.json({ date, records: fb.data || [] })
  }

  return NextResponse.json({ date, records: data || [] })
}
