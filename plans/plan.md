# 메디안 캡처 자동화 — 아모스와 완전 분리 구현 계획

## 목표
메디안 대시보드도 아모스처럼 네이버 노출 자동 체크 + 캡처를 돌린다.
단 **아모스와 완전 별개**: 메디안 자동화는 median_* 테이블/버킷만, 아모스는 amos_* 만 건드린다.

## 확정 결정 (사용자)
1. 캡처 저장: **별도 테이블+버킷 신규** → `median_daily_captures` + `median-captures` 버킷
2. 스케줄: **cron-job.org** (아모스와 동일 방식, workflow_dispatch 호출)
3. 즉시 실행 범위: **수정한 그 키워드 1개만** 즉시 1회

## 인프라 현황 (2026-06-23 확인)
- ✅ `median-captures` 스토리지 버킷 존재 (public)
- ✅ `median_posts`(2건), `median_daily_exposure`(195건) 존재
- ❌ `median_daily_captures` 없음 → `scripts/median_daily_captures.sql` 실행 필요 (사용자, Supabase SQL Editor)
- ✅ GitHub 트리거 토큰: median repo git remote URL에 PAT 내장됨
- Supabase 프로젝트: kepzsboxjulzygehmzpf (amos와 공유, 단 테이블은 분리)

## 구현 항목 — 메디안 repo (median-dashboard)

### 1. scripts/naver_check.py (아모스 것 복제 후 median_* 으로 교체)
- 읽기: `median_posts` (select id,keyword,blog_url,tab_type,brand,product,hwaseon_url)
- 노출기록 쓰기: `median_daily_exposure`
- status 업데이트: `median_posts`
- 캡처 저장: `median_daily_captures` (on_conflict=post_id,date)
- 스토리지 업로드: `median-captures` 버킷
- **단일 키워드 모드 추가**: `python naver_check.py --post-id <uuid>` 또는 `--keyword "<kw>"` 인자 주면 그 1건만 체크.
  인자 없으면 전체 배치(기존 동작).

### 2. scripts/requirements_check.txt — 아모스 것 복사

### 3. .github/workflows/naver_daily_check.yml (신규)
- 아모스 워크플로 복제. `on: workflow_dispatch` + inputs.post_id (선택)
- inputs.post_id 있으면 `python scripts/naver_check.py --post-id ${{ inputs.post_id }}`
- env SUPABASE_URL / SUPABASE_SERVICE_KEY(=secrets)
- **GitHub Secret 필요**: median repo에 `SUPABASE_SERVICE_KEY` 등록

### 4. app/api/captures/route.ts 수정
- `amos_daily_captures` → `median_daily_captures` 로 변경

### 5. app/captures/page.tsx 수정
- 현재 "아윤채 캡처"(ayunche_captures) 복사본 → 메디안 자기 캡처 표시로 변경
- `/api/captures`(median_daily_captures) 읽어서 날짜별 그리드 표시 (아모스 메인페이지 캡처 UI 방식 참고)

### 6. app/api/trigger-check/route.ts (신규) — 즉시 1회 실행
- POST { post_id }. GitHub API로 median repo 워크플로 workflow_dispatch 호출 (inputs.post_id 전달)
- GitHub PAT는 Vercel 환경변수 `GH_DISPATCH_TOKEN` 에서 읽음
- 인증: 기존 admin 패턴 따름

### 7. app/admin/page.tsx 수정
- 키워드 추가/수정 저장 성공 후 → `/api/trigger-check` 호출(해당 post_id). 무조건 1회.

## 구현 항목 — 아모스 repo (amos-dashboard) : 즉시실행만 추가 (아모스만)
- scripts/naver_check.py 에 `--post-id` 단일 모드 추가
- 워크플로에 inputs.post_id 추가
- app/api/trigger-check/route.ts 신규 (amos repo 자기 워크플로 호출)
- app/admin/page.tsx 키워드 추가/수정 후 트리거 호출
- **아모스 트리거는 아모스 워크플로만 호출** (메디안 안 건드림)

## 분리 불변식 (반드시 지킬 것)
- 메디안 코드/스크립트/워크플로는 `amos_*` 테이블·`amos-captures` 버킷 참조 금지
- 아모스 코드/스크립트/워크플로는 `median_*` 참조 금지
- 트리거는 각자 자기 repo 워크플로만 dispatch

## 사용자 작업 (코드 외)
1. `scripts/median_daily_captures.sql` 실행 (Supabase SQL Editor)
2. median repo에 GitHub Secret `SUPABASE_SERVICE_KEY` 등록
3. 두 repo Vercel 프로젝트에 `GH_DISPATCH_TOKEN` 환경변수 추가
4. cron-job.org에 메디안 워크플로 호출 스케줄 신규 등록 (아모스와 동일 시각/방식)
