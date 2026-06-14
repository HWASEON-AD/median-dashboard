import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('ayunche_captures')
    .select('*')
    .order('captured_at', { ascending: false })
    .limit(500)

  if (error) return NextResponse.json([], { status: 200 })
  // brand 필드 추가 (테이블에 없으므로 API에서 주입)
  const records = (data || []).map((r: Record<string, unknown>) => ({ ...r, brand: '아윤채' }))
  return NextResponse.json(records)
}
