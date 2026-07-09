# 메디안 대시보드 — "조회수(카페+총+누적통합)" & "검색량" 기능 이식 기획서

> 소스: `amos-dashboard` (구현·배포·검증 완료, 커밋 6d1e27c / a8d50e7 / 92a1654)
> 타겟: `median-dashboard` (Vercel: median-dashboard.vercel.app, Supabase ref `kepzsboxjulzygehmzpf` — amos와 프로젝트 공유, 테이블은 `median_*`로 완전 분리)
> 목표: 아모스 admin 패널의 "조회수" 계열(카페 조회수 / 총 조회수 / 누적통합) + "검색량" 기능을 메디안에 **100% 동일 동작**으로 이식. 구분/구분2/진행 컬럼, 캡처 교체 기능 등은 이식 범위 **제외**.

---

## 0. 사전 실측 결과 (2026-07-08 확인)

### median_posts 현재 컬럼 (Supabase Management API로 직접 조회)
```
id, keyword, product, tab_type, blog_url, hwaseon_url, brand, status, updated_at
```
→ **조회수/검색량 관련 컬럼이 전부 없음** (image_host_url, cafe_views, image_views, views_base, views_offset, search_volume 전무)

### amos_posts 현재 컬럼 (대조군)
```
id, brand, product, keyword, tab_type, blog_url, total_views, search_volume, start_date,
status, created_at, updated_at, hwaseon_url, image_host_url, cafe_views, image_views,
category, progress, category2, views_base(NOT NULL,0), views_offset(NOT NULL,0)
```
→ 이 중 `category`/`category2`/`progress`/`total_views`/`start_date`는 이번 이식 범위 **제외** (구분/구분2/진행 + 아모스 전용 미사용 필드).

### median-dashboard 배포 현황 (Vercel API로 직접 확인)
- git push → main 브랜치 → **자동으로 production READY 배포됨** (최근 8개 커밋 전부 `target: production, state: READY` 확인). amos-dashboard처럼 "git push=Preview만 생성, `vercel --prod` 수동 필요"인 함정은 **median에는 해당 없음** — 단, 배포 후에는 반드시 실측(curl/Playwright)으로 재확인할 것.
- 현재 Vercel 환경변수: `GH_DISPATCH_TOKEN`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `ADMIN_PASSWORD` — **NAVER_API_* 3종 없음** (신규 등록 필요)
- `median_posts` 현재 2건, `median_daily_exposure` 다수 — 소규모라 마이그레이션/새로고침 성능 리스크 없음

### 참고: 기존 median 코드의 열등 구현 (교체 대상)
- `app/api/cafe-views/route.ts` — 카페 글 HTML을 정규식(`조회\s*([\d,]+)`)으로 스크래핑하는 **구버전 방식**. 아모스는 이 방식을 폐기하고 `lib/views.ts`의 `getCafeReadCount()`(clubid 추출 → apis.naver.com 비공식 API)로 교체했음. 이식 후 이 라우트는 admin 페이지에서 더 이상 호출되지 않으므로 **삭제 대상**.
- `app/page.tsx`(메인 대시보드)의 `Post.total_views` 필드 — DB에 해당 컬럼이 없어 항상 `undefined`로 죽어있는 필드(11번째 줄 인터페이스 선언, 378번째 줄 조건부 렌더). 이번 이식은 admin 패널이 우선 범위이므로 **원상 유지**하되, 선택 기능으로 `combined_views` 연결을 제안(6장 참고).
- `app/api/clicks/route.ts`가 참조하는 `HWASEON_URL_ADMIN_KEY`가 Vercel(median)에는 **미등록** → "총 클릭수"는 현재도 조용히 0/–로 표시되는 중(이번 작업 범위 아님, 리스크만 기록).

---

## 1. 기능 목록

### 1-1. 필수 기능 (아모스와 100% 동일 동작)

| 기능 | 설명 |
|---|---|
| **카페 조회수 수집** | `blog_url`이 `cafe.naver.com`이면, 카페 글 페이지에서 `clubid` 추출 → 비공식 `apis.naver.com/cafe-web/cafe-articleapi` 호출로 `readCount` 획득. 실패/삭제(404 등)는 `null` 반환 → 기존 저장값 유지(덮어쓰지 않음). |
| **이미지호스팅 총 조회수 수집** | `image_host_url`(hwaseon-image.com URL)에서 id 추출 → `/image/<id>/detail`로 `views` 조회. 실패 시 기존 값 유지. |
| **조회수 새로고침 버튼** | admin 패널에서 클릭 시 `POST /api/refresh-views` 호출 → 전체 키워드의 카페/이미지 조회수를 일괄 최신화. 갱신 건수(카페 N · 이미지 N · 유지 N)를 토스트로 표시. |
| **통합(누적) 조회수 계산** | `combined = views_base + max(0, 현재소스조회수 - views_offset)`. 발행 URL(blog_url)이 바뀌어도(카페→블로그, 이미지 교체 등) 조회수가 리셋되지 않고 계속 누적됨. |
| **URL 교체 시 스냅샷** | PATCH(`/api/keywords/[id]`)에서 `blog_url`이 실제로 바뀌면: 옛 구간을 라이브로 마지막 조회(실패 시 저장값 폴백) → `views_base`에 누적 → 새 구간의 `views_offset`/소스 리셋 여부를 계산해 저장. Import 일괄 반영(`/api/keywords/import`)도 저장값 기반으로 동일 로직 적용(라이브 fetch는 생략). |
| **검색량 조회(네이버 검색광고 API)** | 전체 키워드를 중복 제거해 `keywordstool` API에 5개씩 배치 호출(HMAC-SHA256 서명, 메시지는 **마침표 구분** `timestamp.METHOD.uri`) → PC+모바일 합산(total)을 `search_volume` 컬럼에 best-effort 저장. 프론트는 마운트 시 `GET /api/search-volume` 1회 호출. |
| **admin 테이블 컬럼 확장** | 키워드 옆에 **검색량**, 발행URL 옆에 **이미지호스팅URL** 입력칸, 총노출일 옆에 **조회수(통합)**·**총조회수(이미지 raw)** 컬럼 추가. |
| **엑셀 export 컬럼 확장** | 현재 median export는 브랜드\|제품\|키워드\|노출탭\|발행URL\|제품링크URL\|날짜... 뿐. 아모스처럼 **총노출일 · 조회수(통합) · 총조회수** 3컬럼을 날짜 컬럼 앞에 추가. |

### 1-2. 선택 기능 (권장하나 필수 아님)

| 기능 | 설명 |
|---|---|
| 메인 대시보드(`app/page.tsx`) 조회수 노출 | 현재 죽어있는 `total_views` 필드를 `combined_views`로 교체해 사이드바/히트맵에 실제 조회수 표시 |
| 총 클릭수 완전 정상화 | `HWASEON_URL_ADMIN_KEY`를 median Vercel 프로젝트에도 등록(아모스와 동일 값) — 이번 작업 범위 밖이지만 검색량/조회수와 나란히 있는 컬럼이라 언급 |
| `app/api/cafe-views/route.ts` 삭제 | 신규 방식으로 완전 대체되므로 죽은 코드 정리 |

---

## 2. 기술 스택 (변경 없음, 기존 스택 그대로 사용)

- **Next.js 14.2.20 (App Router)** — amos와 동일 버전, 코드 이식 시 호환성 문제 없음
- **@supabase/supabase-js 2.108.1** — `supabaseAdmin`(service key) 클라이언트 그대로 재사용
- **네이버 비공식 API 2종** (신규 외부 의존 없음, 순수 `fetch`):
  - 카페: `apis.naver.com/cafe-web/cafe-articleapi` (비공식, 인증 불필요)
  - 이미지호스팅: `hwaseon-image.com/image/<id>/detail` (자체 서비스)
- **네이버 검색광고 API(keywordstool)** — Node 내장 `crypto` HMAC-SHA256만 사용, 추가 패키지 설치 불필요
- 이유: 아모스에서 이미 프로덕션 검증 완료된 라이브러리를 그대로 복사하는 것이 "100% 동일 동작" 목표에 가장 안전. 신규 스택 도입 없음.

---

## 3. 데이터 구조

### 3-1. DDL — `median_posts`에 추가할 컬럼

**실행 방법**: 이 작업은 기획 단계이므로 SQL은 실행하지 않는다. 구현 단계(developer 에이전트)에서 Supabase Management API로 직접 실행 권장:
```
POST https://api.supabase.com/v1/projects/kepzsboxjulzygehmzpf/database/query
Authorization: Bearer {SUPABASE_ACCESS_TOKEN}
```
(사용자가 직접 실행하길 원할 경우를 대비해 SQL Editor 링크도 함께 안내)

**Supabase SQL Editor**: `https://supabase.com/dashboard/project/kepzsboxjulzygehmzpf/sql/new`

```sql
ALTER TABLE median_posts
  ADD COLUMN IF NOT EXISTS image_host_url TEXT,
  ADD COLUMN IF NOT EXISTS cafe_views INTEGER,
  ADD COLUMN IF NOT EXISTS image_views INTEGER,
  ADD COLUMN IF NOT EXISTS views_base INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS views_offset INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS search_volume INTEGER;
```

- `views_base`/`views_offset`은 amos와 동일하게 **NOT NULL DEFAULT 0** (스냅샷 계산식이 null 비교 없이 항상 정수 연산되도록 보장하는 amos의 설계를 그대로 따름).
- `median_posts`는 현재 2건뿐이라 컬럼 추가 시 락/성능 이슈 없음.
- `IF NOT EXISTS`로 작성해 재실행해도 안전(멱등).

### 3-2. 데이터 모델 (TypeScript, `lib/combined-views.ts`가 요구하는 최소 필드)

```ts
type ViewFields = {
  blog_url: string | null
  cafe_views: number | null
  image_views: number | null
  views_base: number | null
  views_offset: number | null
}
```
`median_posts` row는 이 필드를 전부 포함하게 되므로 amos의 `combined-views.ts` 순수 함수를 **수정 없이 그대로** import해서 쓸 수 있다.

---

## 4. 이식할 파일 목록 (diff 기반, 파일 통째 복사 금지)

### 4-1. 신규 생성 (amos에서 그대로 복사, 테이블명 의존 없는 순수 유틸 — 수정 불필요)

| 파일 | 소스 | 비고 |
|---|---|---|
| `lib/views.ts` | `amos-dashboard/lib/views.ts` (전체 63줄) | 테이블 무관. `getCafeReadCount`, `getImageHostViews` 그대로 복사 |
| `lib/combined-views.ts` | `amos-dashboard/lib/combined-views.ts` (전체 83줄) | 순수 함수만(fetch/DB 금지 주석 포함), 수정 없이 복사 |
| `lib/naver-searchad.ts` | `amos-dashboard/lib/naver-searchad.ts` (전체 139줄) | env 이름(`NAVER_API_KEY/SECRET/CUSTOMER_ID`) 동일하게 사용, 수정 없이 복사 |

### 4-2. 신규 생성 (테이블명만 `amos_posts` → `median_posts` 치환)

| 파일 | 소스 | 치환 포인트 |
|---|---|---|
| `app/api/refresh-views/route.ts` | `amos-dashboard/app/api/refresh-views/route.ts` | 13번째 줄 `.from('amos_posts')` → `.from('median_posts')`, 40번째 줄 `.from('amos_posts')` → `.from('median_posts')`. 에러 힌트 문구의 `sql/2026-07-03_views.sql` 언급은 median 마이그레이션 파일명으로 교체하거나 제거 |
| `app/api/search-volume/route.ts` | `amos-dashboard/app/api/search-volume/route.ts` | 32번째 줄 `.from('amos_posts')`, 62번째 줄 `.from('amos_posts')` → `.from('median_posts')` (2곳) |

### 4-3. 기존 파일 수정 (merge — 통째 교체 금지, diff만 반영)

**`app/api/keywords/route.ts`**
- GET: import에 `combinedViews` 추가, `result` map에 `combined_views: combinedViews(p)` 필드 추가 (amos 26~29번째 줄과 동일 패턴)
- POST: body destructuring에 `image_host_url` 추가, insert 객체에 `image_host_url: image_host_url || null` 추가 (amos 36~53번째 줄 참고. `category`/`category2`는 이식 제외이므로 넣지 않음)

**`app/api/keywords/[id]/route.ts`**
- PATCH 허용 필드 배열(현재 7번째 줄 `['keyword','product','blog_url','hwaseon_url','tab_type','status','brand']`)에 `image_host_url` 추가
- amos 14~56번째 줄의 스냅샷 블록(`isCafe`, `computeSnapshot` import + `blog_url` 변경 감지 시 라이브 재조회 → `views_base`/`views_offset`/`cafe_views`/`image_views` 갱신) 을 **그대로 삽입**, `amos_posts` → `median_posts` 3곳(select/update) 치환
- `category`/`progress` 관련 필드는 median에 없으므로 그대로 제외

**`app/api/keywords/import/route.ts`**
- 현재 median 버전은 스냅샷 로직이 아예 없음(단순 upsert). amos 버전(1~121줄)의 `storedFinalViews()` 헬퍼 + `existing` select에 `blog_url, image_host_url, cafe_views, image_views, views_base, views_offset` 추가 + `toUpdate` 루프의 스냅샷 계산 블록을 이식
- 단, median은 `replace` 모드에서 **자식 테이블(median_daily_exposure) 먼저 삭제 후 부모 삭제**하는 FK 방지 로직이 이미 있음(amos에는 없음, median이 더 안전한 버전) → **이 부분은 median 쪽을 그대로 유지**하고 스냅샷 로직만 추가로 합친다
- median의 기존 "중복 키워드는 마지막 행 기준 유지"(`dedupeMap`) 로직도 amos에는 없는 median 전용 개선사항 → 유지

**`app/api/export-excel/route.ts`**
- import에 `combinedViews` 추가
- amos 74~81번째 줄의 "총 노출일(전체기간 기준)" 계산 블록(`allExp` 전체 select → `totalExpMap`) 추가
- headers 배열에 `'총노출일', '조회수', '총조회수'` 3컬럼 추가 (amos 93번째 줄 패턴, `'총클릭수'`는 1-2절 사유로 선택사항)
- dataRows에 `totalExpMap[p.id] || 0`, `combinedViews(p)`, `p.image_views ?? ''` 추가
- `ws['!cols']`에 3개 컬럼 너비 추가

**`app/admin/page.tsx`** (가장 큰 변경, merge 필수 — 통째 교체 금지)
- import에 `currentSource, currentContribution` 추가 (amos 4번째 줄)
- `Keyword` interface에 `image_host_url`, `cafe_views`, `image_views`, `views_base`, `views_offset`, `combined_views` 추가 (median 현재 6~11번째 줄 인터페이스 확장)
- `Volume` 타입 추가 (`{ pc, mobile, total }`)
- state 추가: `refreshingViews`, `volumes`, `volLoading` (median의 `cafeViews` state·관련 useEffect·fetch 루프는 **제거** — 서버 refresh-views로 대체)
- `edit`/`newRow` state에 `image_host_url` 필드 추가
- `load()` 함수에서 median 고유의 `/api/cafe-views` 순회 fetch 블록(현재 127~133번째 줄)을 **삭제**
- 검색량 useEffect 추가 (amos 144~158번째 줄, `/api/search-volume` 마운트 시 1회 호출)
- `refreshViews()` 함수 추가 (amos 199~214번째 줄, `POST /api/refresh-views` 호출 + flash)
- 테이블 헤더에 컬럼 추가/교체: 키워드 다음에 **검색량**, 발행URL 다음에 **이미지호스팅URL**, 총노출일 다음에 **조회수**·**총조회수** (median 기존 "카페 조회수" 컬럼은 **삭제**하고 통합 조회수로 교체)
- 편집 모드(`editId === row.id`) 행에도 `image_host_url` input 추가, 검색량/조회수/총조회수는 amos처럼 "-" 플레이스홀더
- 새 행 추가 폼에도 `image_host_url` input 추가
- 상단 툴바에 **"조회수 새로고침"** 버튼 추가 (amos 414~417번째 줄). **"전체 재조회"** 버튼(GitHub Actions 트리거)은 median에 별도 캡처 자동화 파이프라인이 있으므로 이번 이식 범위에서는 추가하지 않음(있어야 하면 별도 확인 필요 — 이번 요청 범위 밖)
- 구분/구분2/진행 관련 코드는 median에 원래 없으므로 **손대지 않음**

### 4-4. 삭제 대상 (교체로 인해 죽는 코드)

| 파일 | 사유 |
|---|---|
| `app/api/cafe-views/route.ts` | admin 페이지가 더 이상 호출하지 않음(4-3에서 제거). 정규식 스크래핑 방식은 `lib/views.ts`의 clubid 기반 공식 비공식 API로 완전 대체. 삭제 전 다른 곳에서 참조 없는지 최종 grep 재확인 필요(현재 확인 결과 admin/page.tsx 1곳만 참조) |

---

## 5. Vercel 환경변수 (median-dashboard, projectId `prj_L05JZCu1L65bxjkMuJFS4oRrxKZV`, team `team_BTEQPXLbm6tlEyQsQsRkyKco`)

키 값 출처: `C:\Users\gtmin\Desktop\local claude\naver-keyword-tool\config.py` (amos-dashboard Vercel에 등록된 것과 동일 키 — 네이버 검색광고 API는 계정 단위이므로 프로젝트 간 공유 가능)

| 변수명 | 값 | 비고 |
|---|---|---|
| `NAVER_API_KEY` | `0100000000d894c52123b5d8c3979a34370b50fae71b0ddc79b5837eaa897a3fad0c01c09e` | 아모스와 동일 키 재사용 |
| `NAVER_API_SECRET` | `AQAAAADYlMUhI7XYw5eaNDcLUPrnJDdmsxDAlT1lbgIDWVyLEQ==` | 아모스와 동일 키 재사용 |
| `NAVER_API_CUSTOMER_ID` | `3908624` | 아모스와 동일 |

현재 median-dashboard Vercel에는 이 3개가 **전무**함(실측 확인). Production/Preview/Development 전체 target에 등록 필요(아모스도 3개 target 전부 등록되어 있음).

---

## 6. 배포 절차

1. 위 DDL을 median_posts에 적용 (Supabase Management API, `SUPABASE_ACCESS_TOKEN` 사용)
2. Vercel에 `NAVER_API_KEY`/`NAVER_API_SECRET`/`NAVER_API_CUSTOMER_ID` 3개 환경변수 등록 (Production/Preview/Development)
3. 4장의 파일 diff를 로컬에 반영 → `git add` → `git commit` → `git push origin main`
4. **median-dashboard는 git push 시 Vercel이 자동으로 production 배포까지 실행하는 것을 API로 실측 확인함**(최근 8개 커밋 전부 `target=production, state=READY`). 따라서 amos처럼 `vercel --prod` 수동 배포가 **필수는 아님**. 다만:
   - 신규 환경변수(2번)를 추가한 뒤에는 **재배포가 필요**할 수 있으므로(Vercel은 env 변경 시 기존 배포에 자동 반영 안 함), env 등록 후 `git push` 또는 수동 재배포(`vercel --prod` 혹은 Vercel API 재배포 트리거) 중 하나를 반드시 실행
   - 배포 후 반드시 실제 URL에 curl/Playwright로 응답 확인(아래 7장)

---

## 7. e2e 검증 시나리오 (배포 후 실측 필수 — "확인했다"는 직접 실행 결과에만 사용)

1. **DDL 반영 확인**: `information_schema.columns`로 6개 컬럼이 median_posts에 실제 생성됐는지 재조회
2. **refresh-views 라이브 호출**: `curl -X POST https://median-dashboard.vercel.app/api/refresh-views` → `{ ok:true, cafeUpdated, imageUpdated, kept }` 형태 응답 확인. median_posts 중 실제 `blog_url`이 있는 row가 있어야 카페/이미지 수치가 갱신되므로, 사전에 카페 URL 1건·이미지호스팅 URL 1건을 admin에서 등록 후 재실행
3. **search-volume 호출**: `curl https://median-dashboard.vercel.app/api/search-volume` → `{ date, volumes: { "키워드": {pc,mobile,total} } }` 형태 확인. env 미설정 시 `{volumes:{}, error:'NAVER API env 미설정'}`이 오는지도 사전에 1회 확인해 폴백 동작 검증
4. **스냅샷 로직 검증**: admin에서 특정 키워드의 `blog_url`을 카페→블로그(또는 그 반대)로 PATCH 변경 → 응답의 `views_base`/`views_offset`이 갱신되고, `cafe_views`/`image_views`가 스냅샷 규칙대로 null 리셋되는지 확인. 이후 `combined_views`가 리셋 없이 이전 값을 유지한 채 새 구간이 더해지는지 재확인
5. **admin UI 확인**: Playwright로 `/admin` 접속 → 검색량/조회수/총조회수 컬럼이 렌더되는지, "조회수 새로고침" 버튼 클릭 시 토스트와 함께 값이 갱신되는지 스크린샷으로 확인
6. **엑셀 export 확인**: `/api/export-excel` 다운로드 → 헤더에 총노출일/조회수/총조회수 컬럼이 포함되고 값이 채워지는지 실제 파일 열어서 확인

---

## 8. 예상 에러 시나리오

| 에러 상황 | 원인 | 처리 방법 |
|---|---|---|
| `refresh-views` 500 + `image_host_url` 컬럼 에러 | DDL 미실행 상태로 배포됨 | 응답 힌트 문구로 안내(amos와 동일 패턴), 3장 DDL 먼저 실행 |
| `search-volume`이 빈 배열만 반환 | Vercel env 3종 미등록 | env 등록 후 **재배포 필요**(5·6장 참고). 등록만 하고 재배포 안 하면 계속 빈 결과 |
| 네이버 API 403 | HMAC 서명 메시지에 개행(`\n`) 섞임 | `lib/naver-searchad.ts`의 `createSignature`가 마침표 구분(`timestamp.METHOD.uri`)을 쓰는지 재확인 — 검증된 amos 코드 그대로 복사했다면 발생하지 않아야 함 |
| 카페 조회수가 계속 null | 카페 글이 비공개/삭제되었거나 `clubid` 정규식 매칭 실패 | 설계상 정상 동작(기존 값 유지). 다만 신규로 처음 등록한 카페 URL이 계속 null이면 카페 URL 형식(`cafe.naver.com/{cafeName}/{articleId}`)이 맞는지 확인 |
| `blog_url` PATCH 후 조회수가 0으로 리셋되어 보임 | 스냅샷 직후 `cafe_views`/`image_views`가 의도적으로 null이 되는 정상 동작인데, `combined_views`가 아닌 raw `image_views`만 보고 오인 | UI에서 "조회수(통합)" 컬럼은 `combined_views`를 봐야 함(raw 값이 아님)을 admin 컬럼 헤더/tooltip에 명시 |
| import(엑셀 업로드) 후 조회수 중복 합산 | `imageChanged` 판별 로직이 median에서 빠짐(현재 import는 `image_host_url`을 아예 건드리지 않으므로 amos와 동일하게 `imageChanged: false` 고정이어야 함) | 4-3절 명시대로 `computeSnapshot` 호출 시 `imageChanged: false` 고정값 사용, 절대 body 값 기반으로 계산하지 말 것 |
| `median_daily_exposure` FK 위반(전체교체 모드) | amos의 delete 순서를 그대로 베끼면 자식 테이블 먼저 안 지워서 FK 에러 발생 가능 | 4-3절 명시대로 **median의 기존 자식→부모 삭제 순서를 그대로 유지**하고 스냅샷 로직만 추가 이식 |
| Vercel 배포는 성공했는데 새 컬럼이 UI에 하나도 안 보임 | 브라우저 캐시 또는 `git push` 후 자동배포가 최신 커밋이 아닌 이전 커밋을 반영 | Vercel 배포 목록 API로 `githubCommitSha`가 실제 최신 커밋과 일치하는지 재확인(6장 절차) |
| `app/api/cafe-views` 삭제 후 다른 곳에서 404 | 삭제 전 grep 재확인 누락 | 삭제 직전 `grep -r "cafe-views"` 전체 재검색해서 admin/page.tsx 외 참조 없는지 재확인 후 삭제 |

---

## 9. 리스크 요약

1. **`app/admin/page.tsx` 통째 교체 금지** — median은 이미 아모스와 갈라져 있음(구분/구분2/진행 없음, `median_daily_exposure` FK 삭제 순서가 더 안전한 버전). diff 기반 병합이 필수이며, 통째로 amos 파일을 덮어쓰면 median 전용 개선사항(FK 안전 삭제, dedupe 로직)이 유실됨.
2. **신규 env 등록 후 재배포 필요** — Vercel은 env 변경을 기존 배포에 자동 반영하지 않으므로, `NAVER_API_*` 등록 직후 반드시 재배포하고 실측할 것.
3. **`total_views`(메인 대시보드) 죽은 필드** — 이번 작업 범위 밖이지만 발견된 기존 버그성 코드. 손대지 않되 문서에는 남겨 다음 작업 시 참고.
4. **`총 클릭수`는 이미 조용히 고장난 상태**(`HWASEON_URL_ADMIN_KEY` Vercel 미등록) — 이번 조회수/검색량 이식과 무관하지만 같은 화면에 있는 컬럼이라 혼동 방지를 위해 문서화.
5. **소규모 데이터(2건)** 이므로 성능/락 리스크는 사실상 없음. 실사용 확대 시 `refresh-views`의 `Promise.all` 병렬 fetch 개수가 늘어나면 `maxDuration=60` 초과 가능성 — 향후 배치 처리 고려(지금은 불필요).

---

## 다음 단계

이 문서를 SSOT로 `developer` 에이전트에게 넘겨 4장의 파일 diff를 실제로 반영하고, 3장 DDL 실행 + 5장 env 등록까지 포함해 구현 진행할 것을 권장. 구현 완료 후에는 `tester` 에이전트로 7장 e2e 시나리오를 실제로 실행해 검증할 것.

**다음 단계: developer 에이전트로 구현 진행**
