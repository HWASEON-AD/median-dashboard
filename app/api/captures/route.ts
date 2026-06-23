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

  const { data, error } = await supabaseAdmin
    .from('median_daily_captures')
    .select('id, post_id, date, brand, keyword, product, image_url, captured_at')
    .eq('date', date)
    .order('brand', { ascending: true })
    .order('keyword', { ascending: true })

  if (error) return NextResponse.json({ date, records: [] })

  return NextResponse.json({ date, records: data || [] })
}
