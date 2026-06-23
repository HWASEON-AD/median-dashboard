import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import * as XLSX from 'xlsx'

function dateRange(start: string, end: string): string[] {
  const dates: string[] = []
  const cur = new Date(start)
  const last = new Date(end)
  while (cur <= last) {
    dates.push(cur.toISOString().slice(0, 10))
    cur.setDate(cur.getDate() + 1)
  }
  return dates
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const today = new Date().toISOString().slice(0, 10)
  const defaultStart = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const start = searchParams.get('start') || defaultStart
  const end = searchParams.get('end') || today

  const { data: posts } = await supabaseAdmin
    .from('median_posts')
    .select('*')
    .order('brand')
    .order('product')
    .order('keyword')

  const { data: exposures } = await supabaseAdmin
    .from('median_daily_exposure')
    .select('post_id, date')
    .gte('date', start)
    .lte('date', end)

  // 날짜 컬럼: start~end 전체 + DB에 있는 날짜 합산 (정렬)
  const dbDates = Array.from(new Set((exposures || []).map(e => e.date)))
  const allDates = Array.from(new Set([...dateRange(start, end), ...dbDates])).sort()

  // post_id → Set<date> (노출된 날짜만)
  const expMap: Record<string, Set<string>> = {}
  for (const e of exposures || []) {
    if (!expMap[e.post_id]) expMap[e.post_id] = new Set()
    expMap[e.post_id].add(e.date)
  }

  // 단일 시트: 브랜드|제품|키워드|노출탭|발행URL|제품링크URL|날짜1|날짜2|...
  const headers = ['브랜드', '제품', '키워드', '노출탭', '발행URL', '제품링크URL', ...allDates]
  const dataRows = (posts || []).map(p => {
    const row: (string)[] = [
      p.brand || '메디안',
      p.product || '',
      p.keyword,
      p.tab_type || '',
      p.blog_url || '',
      p.hwaseon_url || '',
    ]
    for (const d of allDates) {
      row.push(expMap[p.id]?.has(d) ? '노출' : '')
    }
    return row
  })

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows])
  ws['!cols'] = [
    { wch: 8 }, { wch: 18 }, { wch: 28 }, { wch: 12 }, { wch: 45 }, { wch: 35 },
    ...allDates.map(() => ({ wch: 11 })),
  ]
  XLSX.utils.book_append_sheet(wb, ws, '노출현황')

  const buf = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }) as string
  const binary = Buffer.from(buf, 'base64')

  return new NextResponse(binary, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="median_data_${end}.xlsx"`,
    },
  })
}
