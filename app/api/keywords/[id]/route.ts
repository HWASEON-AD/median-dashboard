import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json()

  const updates: Record<string, string | null> = { updated_at: new Date().toISOString() }
  for (const field of ['keyword', 'product', 'blog_url', 'hwaseon_url', 'tab_type', 'status', 'brand']) {
    if (body[field] !== undefined) updates[field] = body[field] || null
  }

  const { data, error } = await supabaseAdmin
    .from('amos_posts')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await supabaseAdmin
    .from('amos_posts')
    .delete()
    .eq('id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
