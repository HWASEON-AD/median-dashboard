# -*- coding: utf-8 -*-
"""
naver_check.py
매일 오후 4시(KST) GitHub Actions에서 자동 실행.
Supabase median_posts에서 '노출중' 키워드를 읽어
네이버 모바일 검색으로 발행URL 노출 여부를 확인하고
median_daily_exposure에 기록한다.
"""

import os
import sys
import time
import re
import math
import base64
import urllib.parse
from datetime import date, datetime

import requests
from selenium import webdriver
from selenium.webdriver.common.by import By
from PIL import Image, ImageDraw, ImageFont
import io
from datetime import timezone, timedelta

# ── 환경 변수 ──────────────────────────────────────────────────
SUPABASE_URL = os.environ.get('SUPABASE_URL', 'https://kepzsboxjulzygehmzpf.supabase.co')
SUPABASE_KEY = os.environ['SUPABASE_SERVICE_KEY']
# GitHub Actions는 UTC 기준 실행 → KST(+9) 날짜로 변환
KST = timezone(timedelta(hours=9))
TODAY = datetime.now(KST).date().isoformat()

SB_HEADERS = {
    'apikey': SUPABASE_KEY,
    'Authorization': f'Bearer {SUPABASE_KEY}',
    'Content-Type': 'application/json',
}

# 모바일 에뮬레이션 (iPhone)
MOBILE_EMULATION = {
    "deviceMetrics": {"width": 390, "height": 844, "pixelRatio": 3.0},
    "userAgent": (
        "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) "
        "AppleWebKit/605.1.15 (KHTML, like Gecko) "
        "Version/16.0 Mobile/15E148 Safari/604.1"
    ),
}


def log(msg: str):
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}", flush=True)


# ── Supabase 연동 ──────────────────────────────────────────────

def get_posts(post_id: str | None = None) -> list[dict]:
    """blog_url 있는 포스트 조회 (상태 무관). post_id 지정 시 그 1건만 (즉시 1회 실행용)"""
    filter_q = f'&id=eq.{post_id}' if post_id else ''
    r = requests.get(
        f'{SUPABASE_URL}/rest/v1/median_posts'
        '?select=id,keyword,blog_url,tab_type,brand,product,hwaseon_url'
        '&blog_url=not.is.null'
        + filter_q,
        headers=SB_HEADERS,
        timeout=10
    )
    if not r.ok:
        log(f"포스트 조회 실패: {r.status_code} {r.text}")
        return []
    return r.json()


def _already_exposed_today(post_id: str) -> bool:
    """당일 기준 이미 노출 기록이 있는지 확인 (오늘 3회 중 한 번이라도 있으면 True)"""
    r = requests.get(
        f'{SUPABASE_URL}/rest/v1/median_daily_exposure'
        f'?post_id=eq.{post_id}&date=eq.{TODAY}&select=post_id',
        headers=SB_HEADERS,
        timeout=10
    )
    return r.ok and len(r.json()) > 0


def save_exposure(post_id: str, is_exposed: bool):
    """노출 기록 저장 및 상태 업데이트.
    당일 기준: 3회 체크 중 한 번이라도 노출되면 오늘 하루는 노출중 유지."""
    if is_exposed:
        r = requests.post(
            f'{SUPABASE_URL}/rest/v1/median_daily_exposure',
            headers={**SB_HEADERS, 'Prefer': 'resolution=ignore-duplicates'},
            json={'post_id': post_id, 'date': TODAY},
            timeout=10
        )
        if not r.ok:
            log(f"  노출기록 저장 실패: {r.status_code}")

    # 현재 미노출이더라도 오늘 이미 노출 기록 있으면 노출중 유지
    if is_exposed or _already_exposed_today(post_id):
        new_status = '노출중'
    else:
        new_status = '미노출'

    requests.patch(
        f'{SUPABASE_URL}/rest/v1/median_posts?id=eq.{post_id}',
        headers=SB_HEADERS,
        json={'status': new_status},
        timeout=10
    )


def upload_screenshot(post_id: str, img_bytes: bytes, suffix: str = "") -> str | None:
    """Supabase Storage 'median-captures'에 업로드, 성공 시 public URL 반환.
    suffix='_full' 이면 전체페이지 캡처를 별도 파일로 저장한다."""
    path = f'captures/{TODAY}/{post_id}{suffix}.png'
    r = requests.post(
        f'{SUPABASE_URL}/storage/v1/object/median-captures/{path}',
        headers={
            'apikey': SUPABASE_KEY,
            'Authorization': f'Bearer {SUPABASE_KEY}',
            'Content-Type': 'image/png',
            'x-upsert': 'true',
        },
        data=img_bytes,
        timeout=20
    )
    if r.ok:
        return f'{SUPABASE_URL}/storage/v1/object/public/median-captures/{path}'
    return None


def save_capture(post_id: str, brand: str | None, keyword: str, product: str | None,
                 image_url: str, full_image_url: str | None = None):
    """median_daily_captures에 노출 캡처 저장 (upsert — post_id+date 충돌 시 덮어쓰기).

    full_image_url(전체페이지 세로 캡처)은 DB에 full_image_url 컬럼이 있을 때만 저장된다.
    아직 컬럼이 없어 저장이 실패하면 그 필드를 빼고 재시도하여 기본 캡처는 반드시 남긴다."""
    payload = {
        'post_id': post_id,
        'date': TODAY,
        'brand': brand,
        'keyword': keyword,
        'product': product,
        'image_url': image_url,
    }
    if full_image_url:
        payload['full_image_url'] = full_image_url

    def _post(body):
        return requests.post(
            f'{SUPABASE_URL}/rest/v1/median_daily_captures?on_conflict=post_id,date',
            headers={**SB_HEADERS, 'Prefer': 'resolution=merge-duplicates'},
            json=body,
            timeout=10
        )

    r = _post(payload)
    # full_image_url 컬럼이 아직 없어서 실패하면 그 필드 빼고 재시도 (기본 캡처는 보존)
    if not r.ok and 'full_image_url' in payload and 'full_image_url' in (r.text or ''):
        log("  full_image_url 컬럼 없음 → 해당 필드 제외 후 재저장")
        payload.pop('full_image_url', None)
        r = _post(payload)
    if not r.ok:
        log(f"  캡처 DB 저장 실패: {r.status_code} {r.text[:80]}")


# ── Selenium 드라이버 ──────────────────────────────────────────

def create_driver():
    """Headless Chrome 드라이버 생성 (GitHub Actions 호환)"""
    options = webdriver.ChromeOptions()
    options.add_experimental_option("mobileEmulation", MOBILE_EMULATION)
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--window-size=390,844")
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    driver = webdriver.Chrome(options=options)  # selenium-manager가 chromedriver 자동 관리
    driver.set_page_load_timeout(15)
    return driver


# ── URL 파싱 ───────────────────────────────────────────────────

def _split_urls(raw: str) -> list[str]:
    """발행URL 칸을 콤마(,)로 분리해 여러 URL 리스트로 반환.
    - 각 URL의 앞뒤 공백은 자동 제거
    - 빈 값·중복은 제거, 사용자가 적은 순서(앞쪽 우선)는 유지"""
    if not raw:
        return []
    seen = set()
    urls = []
    for part in raw.split(','):
        u = part.strip()
        if u and u not in seen:
            seen.add(u)
            urls.append(u)
    return urls


def parse_url(url: str) -> dict:
    """blog/cafe URL에서 post_no, blog_id 추출"""
    result = {"type": "unknown", "id": "", "post_no": ""}
    if not url:
        return result
    n = url.replace("m.blog.naver.com", "blog.naver.com").replace("m.cafe.naver.com", "cafe.naver.com")
    m = re.search(r"blog\.naver\.com/([^/?#]+)/(\d+)", n)
    if m:
        return {"type": "blog", "id": m.group(1), "post_no": m.group(2)}
    m = re.search(r"cafe\.naver\.com/([^/?#]+)/(\d+)", n)
    if m:
        return {"type": "cafe", "id": m.group(1), "post_no": m.group(2)}
    return result


# ── ayunche-naver-capture/scraper.py 캡처 로직 그대로 ─────────

DEVICE_WIDTH = 390
MAX_SCROLL = 3
SCROLL_PAUSE_SEC = 1.5
SCROLL_AMOUNT_PX = 1200


def _get_font(size: int = 16):
    candidates = [
        "C:/Windows/Fonts/malgun.ttf",
        "C:/Windows/Fonts/malgunbd.ttf",
        "C:/Windows/Fonts/NanumGothic.ttf",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/noto-cjk/NotoSansCJKkr-Regular.otf",
    ]
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()


def _find_section_for_link(link_element):
    """매칭된 링크로부터 상위 섹션 컨테이너 탐색"""
    xpaths = [
        "ancestor::div[contains(@class,'api_subject_bx')][1]",
        "ancestor::div[contains(@class,'_fe_r')][1]",
        "ancestor::section[1]",
    ]
    for xp in xpaths:
        try:
            section = link_element.find_element(By.XPATH, xp)
            if section is not None:
                return section
        except Exception:
            continue
    return None


def _find_post_element(driver, link_element):
    """
    DOM을 거슬러 올라가 개별 포스팅 카드 요소를 반환한다.
    ayunche-naver-capture/scraper.py _find_post_element() 그대로.
    """
    return driver.execute_script("""
        var start = arguments[0];
        // 헤더/검색창/탭바/광고 컨테이너 여부 — 이런 블럭은 '글 카드'가 아니므로
        // 절대 테두리 대상으로 고르지 않는다. (검색란에 빨간 테두리 쳐지던 버그 방어)
        function headerish(node){
            // 검색창/탭바가 들어있는 블럭 = 글 카드가 아님. 구조로만 판별한다.
            // (클래스명 substring 매칭은 loader⊃ader, *-header 등 정상 카드를 오탐하므로 안 씀.
            //  광고/헤더 링크는 이미 매칭 단계의 path 앵커링으로 후보에서 배제됨.)
            if (!node || !node.querySelector) return false;
            return !!node.querySelector('input, [role=tablist], [role=search], form[role=search]');
        }
        var el = start;
        while (el && el !== document.body) {
            var parent = el.parentElement;
            if (!parent) break;
            var r = el.getBoundingClientRect();
            var pr = parent.getBoundingClientRect();
            if (r.height >= 80 && pr.height > 0 && r.height < pr.height * 0.6 && !headerish(el)) {
                return el;
            }
            el = parent;
        }
        return start;
    """, link_element)


def _post_no_in_path(href_norm: str, post_no: str) -> bool:
    """글번호(post_no)가 URL의 '글번호가 놓이는 위치'에 실제로 있는지 검사한다.

    네이버 모바일 검색의 글 링크는 이제
        m.cafe.naver.com/<카페>/<글번호>?art=<긴 base64 JWT 토큰>
    형태라, href 안에 art= 뒤로 숫자가 잔뜩 든 base64 문자열이 붙는다.
    예전처럼 `post_no in href` (단순 substring)로 매칭하면 그 JWT 토큰이나
    상단 ader.naver.com 광고 링크·쿼리 문자열에 우연히 7자리 숫자열이 섞였을 때
    엉뚱한 링크(특히 검색창/탭이 있는 상단 헤더)가 잡혀서 빨간 테두리가
    엉뚱한 데 그려졌다. 그래서 글번호가
      1) 경로 세그먼트(/12345 뒤에 / ? # 또는 끝), 또는
      2) articleid/articleno 파라미터 값
    으로 나타날 때만 진짜 매칭으로 인정한다. base64/쿼리 값 안의 우연한 숫자열은 배제."""
    pno = re.escape(post_no)

    def _hit(h: str) -> bool:
        # 1) 경로 세그먼트: /<글번호> 뒤에 / ? # 또는 끝
        if re.search(rf'/{pno}(?:[/?#]|$)', h):
            return True
        # 2) 글번호 파라미터: articleid / articleno / logno (블로그 PostView 형태)
        if re.search(rf'(?:articleid|articleno|logno)={pno}(?:[&#]|$)', h, re.IGNORECASE):
            return True
        return False

    if _hit(href_norm):
        return True
    # 퍼센트 인코딩된 클릭트래킹 경유 링크(예: ...u=...%2F<글번호>) 대비: 한 번 디코드 후 재검사
    try:
        decoded = urllib.parse.unquote(href_norm)
        if decoded != href_norm and _hit(decoded):
            return True
    except Exception:
        pass
    return False


def _match_url(driver, url: str):
    """3단계 URL 매칭. 글번호는 '경로 위치'에 있을 때만 인정(가짜 substring 매칭 배제)."""
    parsed = parse_url(url)
    post_no = parsed["post_no"]
    blog_id = parsed["id"]
    url_type = parsed["type"]

    if not post_no:
        return None, None

    try:
        links = driver.find_elements(By.TAG_NAME, "a")
    except Exception:
        return None, None

    stage1 = stage2 = stage3 = None

    for link in links:
        try:
            href = link.get_attribute("href") or ""
        except Exception:
            continue
        if not href:
            continue

        href_norm = href.replace("m.blog.naver.com", "blog.naver.com")
        href_norm = href_norm.replace("m.cafe.naver.com", "cafe.naver.com")

        # 글번호가 '경로/파라미터 위치'에 실제로 있는 링크만 후보로 인정.
        # (art= JWT 토큰·광고 링크에 숫자가 우연히 섞인 가짜 매칭을 원천 차단)
        if not _post_no_in_path(href_norm, post_no):
            continue

        if blog_id and blog_id in href_norm:
            stage1 = stage1 or link           # 카페/블로그 id까지 일치 = 가장 확실
        if url_type == "blog" and "blog.naver.com" in href_norm:
            stage2 = stage2 or link
        elif url_type == "cafe" and "cafe.naver.com" in href_norm:
            stage2 = stage2 or link
        # stage3: 도메인이 달라도 글번호가 경로에 있는 링크(리다이렉트 등) — 이제 path 앵커링돼 안전
        stage3 = stage3 or link

    matched = stage1 or stage2 or stage3
    if matched is None:
        return None, None

    section = _find_section_for_link(matched)
    return matched, section


def _scroll_and_find(driver, url: str):
    """스크롤하며 URL 매칭"""
    link, section = _match_url(driver, url)
    if link is not None and section is not None:
        return link, section

    for _ in range(MAX_SCROLL):
        driver.execute_script(f"window.scrollBy(0, {SCROLL_AMOUNT_PX});")
        time.sleep(SCROLL_PAUSE_SEC)
        link, section = _match_url(driver, url)
        if link is not None and section is not None:
            return link, section

    if link is not None:
        return link, None
    return None, None


# 매칭 카드를 뷰포트 '정중앙'으로 스크롤하는 JS.
#  - scrollIntoView({block:'center'})는 네이버 모바일의 sticky 헤더/스크롤 앵커
#    때문에 실제 중앙정렬이 안 돼 글이 화면 위로 밀려 잘리곤 했다.
#  - 그래서 요소의 '문서 절대 위치'를 직접 계산해 window.scrollTo로 중앙에 맞춘다.
#  - 카드가 뷰포트보다 크면(드묾) 상단을 헤더 아래로 살짝 내려 잘림을 줄인다.
_CENTER_JS = """
    var el = arguments[0];
    var vh = window.innerHeight;
    var r = el.getBoundingClientRect();
    var absTop = r.top + window.pageYOffset;
    var target;
    if (r.height <= vh * 0.85) {
        target = absTop - (vh - r.height) / 2;   // 요소 중심을 뷰포트 중심에
    } else {
        target = absTop - vh * 0.12;             // 큰 요소: 상단을 살짝 내려 헤더 회피
    }
    window.scrollTo(0, Math.max(0, target));
"""


def _capture_full_page(driver) -> bytes | None:
    """페이지 전체(세로 스크롤 끝까지)를 한 장으로 캡처한다.

    타겟팅(빨간박스)이 혹시 틀리더라도, 전체 검색결과 페이지를 통으로 남겨두면
    노출 여부를 사람이 눈으로 확인할 수 있는 '안전장치' 스냅샷이 된다.
    outline이 아직 입혀진 상태에서 호출하면 전체 페이지 안에도 빨간박스가 함께 남는다."""
    try:
        # lazy-load 이미지들을 강제로 로드시키기 위해 페이지 끝까지 훑고 위로 복귀
        h = driver.execute_script("return document.body.scrollHeight") or 0
        y = 0
        while y < h and y < 30000:
            driver.execute_script(f"window.scrollTo(0,{y});")
            time.sleep(0.2)
            y += 800
            nh = driver.execute_script("return document.body.scrollHeight") or h
            h = max(h, nh)
        driver.execute_script("window.scrollTo(0,0);")
        time.sleep(0.3)

        # 문서 전체 크기를 구해 뷰포트 밖까지 통째로 캡처 (CDP)
        metrics = driver.execute_cdp_cmd("Page.getLayoutMetrics", {})
        size = metrics.get("cssContentSize") or metrics.get("contentSize") or {}
        width = int(math.ceil(size.get("width") or DEVICE_WIDTH)) or DEVICE_WIDTH
        height = int(math.ceil(size.get("height") or 0))
        if height <= 0:
            height = int(driver.execute_script("return document.body.scrollHeight") or 3000)
        height = min(height, 30000)  # 과도하게 긴 페이지 상한 (파일 폭주 방지)
        result = driver.execute_cdp_cmd("Page.captureScreenshot", {
            "format": "png",
            "captureBeyondViewport": True,
            "clip": {"x": 0, "y": 0, "width": width, "height": height, "scale": 1},
        })
        return base64.b64decode(result["data"])
    except Exception as e:
        log(f"  전체페이지 캡처 실패: {str(e)[:60]}")
        return None


def _capture_with_css_border(driver, link_element, keyword: str):
    """
    매칭된 포스팅 카드를 뷰포트 '정중앙'으로 옮기고, 그 카드 자체에 빨간
    테두리(outline)를 직접 입힌 뒤 (1) 전체 화면(뷰포트) 캡처와 (2) 전체
    페이지 세로 캡처를 함께 반환한다.  반환: (뷰포트bytes|None, 전체페이지bytes|None)
    """
    # 1. URL이 들어있는 포스팅 카드 요소 탐색
    try:
        post_el = _find_post_element(driver, link_element)
    except Exception:
        post_el = link_element

    # 2. 카드를 화면 중앙으로 (수동 좌표 계산) — lazy 콘텐츠 로드 시간도 확보
    #    lazy-load로 글이 재정렬돼 밀릴 수 있으므로 대기 후 한 번 더 중앙정렬한다.
    try:
        driver.execute_script(_CENTER_JS, post_el)
        time.sleep(1.2)  # 이미지 섹션 등 lazy 콘텐츠가 펼쳐질 시간 확보
        driver.execute_script(_CENTER_JS, post_el)
        time.sleep(0.4)  # 재정렬 후 안정화
    except Exception:
        pass

    # 3. 테두리를 '그 블럭 자체'에 직접 입힌다 (outline).
    #    - 별도 fixed 오버레이 박스를 좌표로 띄우면, 측정 직후 lazy 콘텐츠가 더
    #      로드되어 글이 밀릴 때 박스만 옛 좌표에 남아 테두리가 어긋났다.
    #    - outline은 요소에 직접 붙으므로 글이 밀려도 항상 블럭에 딱 붙어 있고,
    #      border와 달리 레이아웃(크기)도 밀지 않는다.
    old_outline = None
    try:
        old_outline = driver.execute_script("""
            var el = arguments[0];
            var prev = {
                outline: el.style.outline,
                outlineOffset: el.style.outlineOffset,
                borderRadius: el.style.borderRadius
            };
            el.style.outline = '3px solid #FF0000';
            el.style.outlineOffset = '-3px';   // 안쪽으로 그려 카드 경계에 딱 맞춤
            el.style.borderRadius = '0px';
            return prev;
        """, post_el)
    except Exception:
        pass

    # 4. 테두리 입힌 그 블럭을 다시 화면 중앙으로 (그 사이 밀렸을 수 있으므로)
    try:
        driver.execute_script(_CENTER_JS, post_el)
        time.sleep(0.3)
    except Exception:
        pass

    # 5. 전체 화면(뷰포트) 캡처 — 매칭 글이 중앙에 테두리와 함께 보임
    screenshot_bytes = driver.get_screenshot_as_png()

    # 6. 전체 페이지 세로 캡처 (안전장치) — outline이 아직 입혀진 상태에서 통째로.
    #    이 안에서 페이지를 끝까지 스크롤하므로 반드시 뷰포트 캡처 '이후'에 한다.
    full_bytes = _capture_full_page(driver)

    # 7. 원래 스타일 복구
    try:
        if old_outline is not None:
            driver.execute_script("""
                var el = arguments[0], prev = arguments[1];
                el.style.outline = prev.outline || '';
                el.style.outlineOffset = prev.outlineOffset || '';
                el.style.borderRadius = prev.borderRadius || '';
            """, post_el, old_outline)
    except Exception:
        pass
    return screenshot_bytes, full_bytes


# ── 노출 확인 ──────────────────────────────────────────────────

def _wait_for_ugc(driver, timeout: float = 12.0):
    """인기글(블로그·카페 UGC) 블록은 client-side JS로 늦게 렌더된다.
    카페/블로그 링크가 충분히 렌더될 때까지 대기 (없으면 timeout까지).
    → 렌더 전에 매칭해서 노출글을 '미노출'로 오탐하던 문제 해결."""
    end = time.time() + timeout
    while time.time() < end:
        try:
            c = driver.execute_script(
                "return document.querySelectorAll(\"a[href*='cafe.naver'], a[href*='blog.naver']\").length"
            )
        except Exception:
            c = 0
        if c and c >= 3:
            time.sleep(1.0)  # 렌더 안정화 여유
            return
        time.sleep(0.5)


def check_exposed(driver, keyword: str, blog_url: str):
    """네이버 모바일 검색 → URL 매칭 → 노출여부 + (빨간박스 뷰포트 캡처, 전체페이지 세로 캡처) 반환.
    반환: (is_exposed: bool, img_bytes|None, full_bytes|None)

    발행URL 칸에 콤마(,)로 여러 URL을 넣으면, 그중 하나라도 검색결과에 노출돼 있으면
    노출로 보고 캡처한다. 여러 개가 동시에 노출된 경우 사용자가 적은 '앞쪽' URL을 우선해
    그것만 캡처한다."""
    urls = _split_urls(blog_url)
    if not urls:
        return False, None, None

    try:
        driver.get(f"https://m.search.naver.com/search.naver?query={urllib.parse.quote(keyword)}")
        # 인기글(UGC)이 자바스크립트로 렌더 완료될 때까지 대기 (과거 미노출 오탐 원인)
        _wait_for_ugc(driver)
    except Exception as e:
        log(f"  검색 실패: {e}")
        return False, None, None

    # 앞쪽 URL부터 순서대로 확인 → 먼저 매칭되는 것을 캡처하고 종료
    for idx, url in enumerate(urls):
        if idx > 0:
            # 다음 URL은 페이지 맨 위에서 다시 탐색 (lazy 로드/스크롤 위치 일관성)
            try:
                driver.execute_script("window.scrollTo(0, 0);")
                time.sleep(0.5)
            except Exception:
                pass

        link, section = _scroll_and_find(driver, url)
        if link is not None:
            if len(urls) > 1:
                log(f"  매칭된 발행URL: {url}")
            img_bytes, full_bytes = _capture_with_css_border(driver, link, keyword)
            return True, img_bytes, full_bytes

    return False, None, None


# ── hwaseon-image 트래킹 ──────────────────────────────────────

HWASEON_IMAGE_BASE = 'https://hwaseon-image.com'

def extract_hwaseon_image_ids(html: str) -> list:
    """HTML에서 hwaseon-image.com 이미지 ID 추출 (3가지 패턴)"""
    found = set()
    # 패턴1: /image/<id>
    for m in re.finditer(r'https?://hwaseon-image\.com/image/([a-zA-Z0-9_\-]+)', html):
        found.add(m.group(1))
    # 패턴2: /uploads/<id>.<ext>
    for m in re.finditer(r'https?://hwaseon-image\.com/uploads/([a-zA-Z0-9_\-]+)\.[a-zA-Z]{2,5}', html):
        found.add(m.group(1))
    # 패턴3: URL 인코딩된 경우 (네이버 이미지 프록시)
    for m in re.finditer(r'hwaseon-image\.com(?:%2F|/)(?:image|uploads)(?:%2F|/)([a-zA-Z0-9_\-]+)', html):
        found.add(m.group(1))
    return list(found)


def get_hwaseon_image_views(image_id: str) -> int | None:
    """hwaseon-image.com /image/:id/detail API로 조회수 가져오기 (인증 불필요)"""
    try:
        r = requests.get(
            f'{HWASEON_IMAGE_BASE}/image/{image_id}/detail',
            timeout=10
        )
        if r.ok:
            return r.json().get('views', 0)
    except Exception as e:
        log(f"  hwaseon-image API 오류: {str(e)[:60]}")
    return None


def get_views_from_hwaseon_url(hwaseon_url: str) -> int | None:
    """제품링크URL 방문 → hwaseon-image ID 추출 → 조회수 반환. 없으면 None."""
    if not hwaseon_url:
        return None
    try:
        headers = {
            'User-Agent': (
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                'AppleWebKit/537.36 (KHTML, like Gecko) '
                'Chrome/120.0.0.0 Safari/537.36'
            )
        }
        # allow_redirects=True 로 단축URL 리다이렉트 자동 처리
        r = requests.get(hwaseon_url, headers=headers, timeout=15, allow_redirects=True)
        if not r.ok:
            log(f"  제품링크 fetch 실패: {r.status_code}")
            return None

        html = r.text
        ids = extract_hwaseon_image_ids(html)
        if not ids:
            log(f"  hwaseon-image 미발견 (URL-encoded 시도)")
            # URL 디코딩 후 재시도
            decoded = urllib.parse.unquote(html)
            ids = extract_hwaseon_image_ids(decoded)

        if not ids:
            log(f"  hwaseon-image 없음 → 조회수 트래킹 불가")
            return None

        image_id = ids[0]
        views = get_hwaseon_image_views(image_id)
        log(f"  hwaseon-image id={image_id} → 조회수 {views}")
        return views
    except Exception as e:
        log(f"  제품링크 접근 오류: {str(e)[:60]}")
        return None


# ── 카페 조회수 스크래핑 ────────────────────────────────────────

def get_cafe_view_count(driver, blog_url: str) -> int | None:
    """카페 포스트 실제 조회수 스크래핑"""
    parsed = parse_url(blog_url)
    if parsed['type'] != 'cafe':
        return None
    try:
        driver.get(blog_url.replace('m.cafe.naver.com', 'cafe.naver.com'))
        time.sleep(2)
        html = driver.page_source
        # 카페 조회수 패턴 (조회 N, 읽음 N 등)
        m = re.search(r'조회\s*[:|]?\s*([\d,]+)', html)
        if m:
            return int(m.group(1).replace(',', ''))
        m = re.search(r'"readCount"\s*:\s*(\d+)', html)
        if m:
            return int(m.group(1))
    except Exception as e:
        log(f"  카페 조회수 오류: {str(e)[:40]}")
    return None


def save_view_count(post_id: str, count: int):
    """median_posts.total_views 업데이트"""
    requests.patch(
        f'{SUPABASE_URL}/rest/v1/median_posts?id=eq.{post_id}',
        headers=SB_HEADERS,
        json={'total_views': count},
        timeout=10
    )


# ── 메인 ───────────────────────────────────────────────────────

def main(post_id: str | None = None):
    posts = get_posts(post_id)
    mode = f"단일({post_id})" if post_id else "전체"
    log(f"체크 시작: {TODAY} / 모드 {mode} / 총 {len(posts)}개")

    if not posts:
        log("체크할 포스트 없음 (노출중 + blog_url 있는 항목 0개)")
        return

    os.makedirs("captures", exist_ok=True)
    driver = create_driver()
    results = []

    try:
        for i, post in enumerate(posts):
            kw = post['keyword']
            url = post['blog_url']
            # 발행URL이 콤마로 여러 개면 보조 로직(카페 조회수 등)은 앞쪽 URL 기준
            url_list = _split_urls(url)
            primary_url = url_list[0] if url_list else url
            post_id = post['id']
            log(f"[{i+1}/{len(posts)}] {kw}")

            try:
                is_exposed, img_bytes, full_bytes = check_exposed(driver, kw, url)
            except Exception as e:
                log(f"  오류: {e}")
                is_exposed, img_bytes, full_bytes = False, None, None

            save_exposure(post_id, is_exposed)

            # hwaseon-image 조회수 트래킹 (제품링크URL이 있으면)
            hwaseon_url = post.get('hwaseon_url')
            if hwaseon_url:
                views = get_views_from_hwaseon_url(hwaseon_url)
                if views is not None:
                    save_view_count(post_id, views)

            # 카페 글이면 조회수 추가 수집 (hwaseon-image 없을 경우 fallback)
            parsed = parse_url(primary_url)
            if parsed['type'] == 'cafe' and not hwaseon_url:
                view_count = get_cafe_view_count(driver, primary_url)
                if view_count is not None:
                    save_view_count(post_id, view_count)
                    log(f"  카페 조회수: {view_count}")

            # 노출된 경우에만 캡처 저장
            if is_exposed and img_bytes:
                image_url = upload_screenshot(post_id, img_bytes)
                # 전체페이지 세로 캡처(안전장치)도 별도 파일로 업로드
                full_image_url = upload_screenshot(post_id, full_bytes, suffix='_full') if full_bytes else None
                if image_url:
                    save_capture(
                        post_id=post_id,
                        brand=post.get('brand'),
                        keyword=kw,
                        product=post.get('product'),
                        image_url=image_url,
                        full_image_url=full_image_url,
                    )
                else:
                    fname = re.sub(r'[\\/:*?"<>|]', '_', kw)
                    with open(f'captures/{fname}.png', 'wb') as f:
                        f.write(img_bytes)

            results.append({'keyword': kw, 'exposed': is_exposed})
            log(f"  -> {'O 노출중' if is_exposed else 'X 미노출'}")
            time.sleep(1)
    finally:
        driver.quit()

    exposed = sum(1 for r in results if r['exposed'])
    log(f"\n완료: {exposed}/{len(results)} 노출 확인")
    print("\n=== 체크 결과 ===")
    for r in results:
        mark = 'O' if r['exposed'] else 'X'
        kw = r['keyword'].encode('utf-8', errors='replace').decode('utf-8')
        print(f"{mark} {kw}")


if __name__ == '__main__':
    # --post-id <uuid> 또는 --post-id=<uuid> 지정 시 그 키워드 1건만 즉시 체크
    arg_post_id = None
    for idx, a in enumerate(sys.argv):
        if a == '--post-id' and idx + 1 < len(sys.argv):
            arg_post_id = sys.argv[idx + 1]
        elif a.startswith('--post-id='):
            arg_post_id = a.split('=', 1)[1]
    main(arg_post_id)
