-- 메디안 전용 캡처 테이블 (아모스 amos_daily_captures 구조 복제, 완전 분리)
-- Supabase SQL Editor에서 1회 실행:
-- https://supabase.com/dashboard/project/kepzsboxjulzygehmzpf/sql/new

create table if not exists public.median_daily_captures (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.median_posts(id) on delete cascade,
  date        date not null,
  brand       text,
  keyword     text,
  product     text,
  image_url   text,
  captured_at timestamptz default now(),
  unique (post_id, date)
);

-- 조회 인덱스
create index if not exists idx_median_daily_captures_date on public.median_daily_captures(date);
create index if not exists idx_median_daily_captures_post on public.median_daily_captures(post_id);
