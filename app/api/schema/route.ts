import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// Supabase 테이블 자동 생성 (최초 1회)
export async function POST() {
  const sql = `
    CREATE TABLE IF NOT EXISTS amos_posts (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      keyword TEXT NOT NULL UNIQUE,
      blog_url TEXT,
      hwaseon_url TEXT,
      tab TEXT,
      status TEXT DEFAULT '미노출',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS amos_daily_exposure (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      post_id UUID REFERENCES amos_posts(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      is_exposed BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(post_id, date)
    );
  `

  const { error } = await supabaseAdmin.rpc('exec_sql', { sql })
  if (error) return NextResponse.json({ error: error.message, note: 'Supabase SQL 에디터에서 직접 실행하세요' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
