-- amos_daily_captures 테이블 생성 (날짜별 노출 캡처 기록)
-- 노출된 키워드의 스크린샷만 저장 (미노출은 저장 안 함)

CREATE TABLE IF NOT EXISTS amos_daily_captures (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id     uuid NOT NULL,
  date        date NOT NULL,
  brand       text,
  keyword     text NOT NULL,
  product     text,
  image_url   text NOT NULL,
  captured_at timestamptz DEFAULT now(),
  UNIQUE(post_id, date)
);

-- 날짜 기준 조회 최적화
CREATE INDEX IF NOT EXISTS idx_amos_daily_captures_date ON amos_daily_captures(date DESC);

-- amos-captures Storage 버킷 public으로 설정 (이미 있으면 무시)
-- Supabase Dashboard > Storage > amos-captures > Make Public 에서 직접 설정
