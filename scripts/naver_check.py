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


def upload_screenshot(post_id: str, img_bytes: bytes) -> str | None:
    """Supabase Storage 'median-captures'에 업로드, 성공 시 public URL 반환"""
    path = f'captures/{TODAY}/{post_id}.png'
    r = requests.post(
        f'{SUPABASE_URL}/storage/v1/object/median-captures/{path}',
        headers={
            'apikey': SUPABASE_KEY,
            'Authorization': f'Bearer {SUPABASE_KEY}',
            'Content-Type': 'image/png',
            'x-upsert': 'true',
        },
        data=img_bytes,
        timeout=15
    )
    if r.ok:
        return f'{SUPABASE_URL}/storage/v1/object/public/median-captures/{path}'
    return None


def save_capture(post_id: str, brand: str | None, keyword: str, product: str | None, image_url: str):
    """median_daily_captures에 노출 캡처 저장 (upsert — post_id+date 충돌 시 image_url 덮어쓰기)"""
    r = requests.post(
        f'{SUPABASE_URL}/rest/v1/median_daily_captures?on_conflict=post_id,date',
        headers={**SB_HEADERS, 'Prefer': 'resolution=merge-duplicates'},
        json={
            'post_id': post_id,
            'date': TODAY,
            'brand': brand,
            'keyword': keyword,
            'product': product,
            'image_url': image_url,
        },
        timeout=10
    )
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
        var el = arguments[0];
        while (el && el !== document.body) {
            var parent = el.parentElement;
            if (!parent) break;
            var r = el.getBoundingClientRect();
            var pr = parent.getBoundingClientRect();
            if (r.height >= 80 && pr.height > 0 && r.height < pr.height * 0.6) {
                return el;
            }
            el = parent;
        }
        return arguments[0];
    """, link_element)


def _match_url(driver, url: str):
    """3단계 URL 매칭"""
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

        if post_no not in href_norm:
            continue

        if blog_id and blog_id in href_norm:
            stage1 = stage1 or link
        if url_type == "blog" and "blog.naver.com" in href_norm:
            stage2 = stage2 or link
        elif url_type == "cafe" and "cafe.naver.com" in href_norm:
            stage2 = stage2 or link
        elif url_type == "cafe" and re.search(r"articleid=" + re.escape(post_no), href_norm, re.IGNORECASE):
            stage2 = stage2 or link
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


def _capture_with_css_border(driver, link_element, keyword: str) -> bytes | None:
    """
    매칭된 포스팅 카드를 화면 '중앙'으로 스크롤해 빨간 테두리를 그린 뒤
    전체 화면(뷰포트)을 캡처한다. 카드가 가운데 오므로 잘리지 않고
    주변 검색결과 맥락까지 함께 보인다.
    """
    # 1. 포스팅 카드 요소 탐색
    try:
        post_el = _find_post_element(driver, link_element)
    except Exception:
        post_el = link_element

    # 2. 카드를 화면 중앙으로 스크롤 (lazy 이미지 로드 유도)
    try:
        driver.execute_script("arguments[0].scrollIntoView({block:'center'})", post_el)
        time.sleep(0.6)
    except Exception:
        pass

    # 3. 빨간 테두리 오버레이 (현재 위치 기준, position:fixed)
    overlay = None
    try:
        overlay = driver.execute_script("""
            var r = arguments[0].getBoundingClientRect();
            var div = document.createElement('div');
            div.style.cssText = [
                'position:fixed','pointer-events:none','z-index:999999',
                'border:3px solid #FF0000','box-sizing:border-box',
                'left:' + r.left + 'px','top:' + r.top + 'px',
                'width:' + r.width + 'px','height:' + r.height + 'px'
            ].join(';');
            document.body.appendChild(div);
            return div;
        """, post_el)
    except Exception:
        pass

    # 4. 전체 화면(뷰포트) 캡처 — 매칭 글이 화면 중앙에 주변 맥락과 함께 보임
    screenshot_bytes = driver.get_screenshot_as_png()
    try:
        if overlay:
            driver.execute_script("arguments[0].remove();", overlay)
    except Exception:
        pass
    return screenshot_bytes


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


def check_exposed(driver, keyword: str, blog_url: str) -> tuple[bool, bytes | None]:
    """네이버 모바일 검색 → URL 매칭 → 노출 여부 + 전체화면+CSS빨간테두리 캡처 반환"""
    try:
        driver.get(f"https://m.search.naver.com/search.naver?query={urllib.parse.quote(keyword)}")
        # 인기글(UGC)이 자바스크립트로 렌더 완료될 때까지 대기 (과거 미노출 오탐 원인)
        _wait_for_ugc(driver)
    except Exception as e:
        log(f"  검색 실패: {e}")
        return False, None

    link, section = _scroll_and_find(driver, blog_url)

    if link is None:
        return False, None

    img_bytes = _capture_with_css_border(driver, link, keyword)
    return True, img_bytes


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
            post_id = post['id']
            log(f"[{i+1}/{len(posts)}] {kw}")

            try:
                is_exposed, img_bytes = check_exposed(driver, kw, url)
            except Exception as e:
                log(f"  오류: {e}")
                is_exposed, img_bytes = False, None

            save_exposure(post_id, is_exposed)

            # hwaseon-image 조회수 트래킹 (제품링크URL이 있으면)
            hwaseon_url = post.get('hwaseon_url')
            if hwaseon_url:
                views = get_views_from_hwaseon_url(hwaseon_url)
                if views is not None:
                    save_view_count(post_id, views)

            # 카페 글이면 조회수 추가 수집 (hwaseon-image 없을 경우 fallback)
            parsed = parse_url(url)
            if parsed['type'] == 'cafe' and not hwaseon_url:
                view_count = get_cafe_view_count(driver, url)
                if view_count is not None:
                    save_view_count(post_id, view_count)
                    log(f"  카페 조회수: {view_count}")

            # 노출된 경우에만 캡처 저장
            if is_exposed and img_bytes:
                image_url = upload_screenshot(post_id, img_bytes)
                if image_url:
                    save_capture(
                        post_id=post_id,
                        brand=post.get('brand'),
                        keyword=kw,
                        product=post.get('product'),
                        image_url=image_url
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
