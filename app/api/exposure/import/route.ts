import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { exposures } = body as {
    exposures: { keyword: string; product: string; brand: string; date: string; is_exposed?: boolean }[]
  }

  if (!exposures?.length) return NextResponse.json({ count: 0 })

  const { data: posts } = await supabaseAdmin
    .from('median_posts')
    .select('id, keyword, product, brand')

  const postMap = new Map<string, string>()
  for (const p of posts || []) {
    const key = `${p.keyword}|||${p.product ?? ''}|||${p.brand ?? '메디안'}`
    postMap.set(key, p.id)
  }

  // 노출일만 삽입 (presence = 노출)
  const seen = new Set<string>()
  const records: { post_id: string; date: string }[] = []
  for (const e of exposures) {
    if (e.is_exposed === false) continue // 미노출은 기록 안 함
    const key = `${e.keyword}|||${e.product ?? ''}|||${e.brand ?? '메디안'}`
    const postId = postMap.get(key)
    if (!postId) continue
    const uniq = `${postId}|||${e.date}`
    if (seen.has(uniq)) continue
    seen.add(uniq)
    records.push({ post_id: postId, date: e.date })
  }

  if (!records.length) return NextResponse.json({ count: 0, note: '노출 기록 없음' })

  const { error } = await supabaseAdmin
    .from('median_daily_exposure')
    .upsert(records, { onConflict: 'post_id,date', ignoreDuplicates: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ count: records.length })
}
