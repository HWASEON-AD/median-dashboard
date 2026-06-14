import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { rows, replace } = body as {
    rows: { keyword: string; product?: string; tab?: string; tab_type?: string; blog_url?: string; hwaseon_url?: string; brand?: string }[]
    replace?: boolean
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: '데이터 없음' }, { status: 400 })
  }

  // 전체 교체 모드: 기존 데이터 전부 삭제
  if (replace) {
    const { error: delErr } = await supabaseAdmin
      .from('amos_posts')
      .delete()
      .not('id', 'is', null)
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })
  }

  const incoming = rows
    .filter(r => r.keyword?.trim())
    .map(r => ({
      keyword: r.keyword.trim(),
      product: r.product?.trim() || null,
      tab_type: (r.tab_type || r.tab)?.trim() || null,
      blog_url: r.blog_url?.trim() || null,
      hwaseon_url: r.hwaseon_url?.trim() || null,
      brand: r.brand?.trim() || '아모스',
    }))

  // 기존 데이터 조회 — keyword + product + brand 조합으로 매칭
  const { data: existing } = await supabaseAdmin
    .from('amos_posts')
    .select('id, keyword, product, brand')

  const existingMap = new Map<string, string>()
  for (const e of existing || []) {
    const key = `${e.keyword}|||${e.product ?? ''}|||${e.brand ?? '아모스'}`
    existingMap.set(key, e.id)
  }

  const toUpdate: { id: string; tab_type: string | null; blog_url: string | null; hwaseon_url: string | null; brand: string }[] = []
  const toInsert: { keyword: string; product: string | null; tab_type: string | null; blog_url: string | null; hwaseon_url: string | null; brand: string; status: string }[] = []

  for (const r of incoming) {
    const key = `${r.keyword}|||${r.product ?? ''}|||${r.brand}`
    const id = existingMap.get(key)
    if (id) {
      toUpdate.push({ id, tab_type: r.tab_type, blog_url: r.blog_url, hwaseon_url: r.hwaseon_url, brand: r.brand })
    } else {
      toInsert.push({ ...r, status: '미노출' })
    }
  }

  // 업데이트
  for (const u of toUpdate) {
    await supabaseAdmin
      .from('amos_posts')
      .update({ tab_type: u.tab_type, blog_url: u.blog_url, hwaseon_url: u.hwaseon_url, brand: u.brand })
      .eq('id', u.id)
  }

  // 신규 삽입
  let insertedCount = 0
  if (toInsert.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('amos_posts')
      .insert(toInsert)
      .select()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    insertedCount = data?.length ?? 0
  }

  return NextResponse.json({ inserted: insertedCount + toUpdate.length, updated: toUpdate.length, added: insertedCount })
}
