#!/usr/bin/env python3
"""
note 記事公開時の自動 X/Threads 告知投稿

generate_cross_post.py が生成した sns/cross-posts/{date}-{slug}/ から
最新のクロスポスト案を読み込んで、X と Threads に告知を即時投稿する。

【動作】
1. sns/cross-posts/ の最新ディレクトリを発見
2. x-variants.md から「パターンA (失敗談から)」を抽出
3. threads.md から本文を抽出
4. .promo-posted.log で重複投稿を防止
5. X: クッキー認証で投稿
6. Threads: Meta Graph API で投稿

【使い方】
GitHub Actions から自動呼び出し (weekly-content-pipeline.yml 経由)
ローカル手動: python post_note_promo.py [--dry-run]
"""

from __future__ import annotations

import datetime
import json
import os
import re
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

sys.path.insert(0, str(Path(__file__).parent))

ROOT = Path(__file__).resolve().parents[3]
CROSSPOST_DIR = ROOT / "projects" / "rakuda-sensei" / "sns" / "cross-posts"
POSTED_LOG = ROOT / "projects" / "rakuda-sensei" / "sns" / ".promo-posted.log"

JST = ZoneInfo("Asia/Tokyo")

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
STEALTH_JS = """
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
Object.defineProperty(navigator, 'languages', { get: () => ['ja-JP', 'ja', 'en-US', 'en'] });
window.chrome = { runtime: {} };
"""


def find_latest_crosspost_dir() -> Path | None:
    """最新のクロスポストディレクトリを返す"""
    if not CROSSPOST_DIR.exists():
        return None
    dirs = sorted(
        [d for d in CROSSPOST_DIR.iterdir() if d.is_dir() and not d.name.startswith(".")],
        reverse=True,
    )
    return dirs[0] if dirs else None


def extract_x_variant(x_md_path: Path, variant: str = "A") -> str | None:
    """x-variants.md から指定パターンの本文を抽出。
    対応構造（いずれもマッチ）:
      ## パターンA xxx
      ## A. ストーリー型
      ## A xxx
    code fence ``` で囲まれた本文を優先抽出する。
    """
    if not x_md_path.exists():
        return None
    text = x_md_path.read_text(encoding="utf-8")
    # 「## A」「## パターンA」「## A.」のいずれにもマッチ
    patterns = [
        rf"##\s+パターン{re.escape(variant)}[^\n]*\n+(.+?)(?=\n##\s+パターン|\n##\s+[A-Z]\.|\Z)",
        rf"##\s+{re.escape(variant)}\.\s[^\n]*\n+(.+?)(?=\n##\s+[A-Z]\.|\n##\s+パターン|\Z)",
        rf"##\s+{re.escape(variant)}\s[^\n]*\n+(.+?)(?=\n##\s+[A-Z]|\Z)",
    ]
    body = None
    for pat in patterns:
        m = re.search(pat, text, re.DOTALL)
        if m:
            body = m.group(1).strip()
            break
    if not body:
        return None
    # code fence ``` で囲まれた本文を抽出（あれば優先）
    fence_m = re.search(r"```(?:\w*)?\n(.+?)\n```", body, re.DOTALL)
    if fence_m:
        body = fence_m.group(1).strip()
    # 末尾のセクション区切りを除去
    body = re.sub(r"\n+---\s*$", "", body).strip()
    # 元記事URL plceholder を実URL置換 (https://note.com/... が含まれてれば OK)
    return body if body else None


def get_published_url() -> str | None:
    """直近の公開URL を .last-published-url.txt から取得 (クエリ除去)"""
    url_file = ROOT / "projects" / "rakuda-sensei" / "articles" / ".last-published-url.txt"
    if not url_file.exists():
        return None
    url = url_file.read_text(encoding="utf-8").strip().splitlines()[0].strip()
    # ?app_launch=false や ?flash_message_key=... を除去
    return re.sub(r"\?.*$", "", url) if url else None


def extract_threads_text(threads_md_path: Path) -> str | None:
    """threads.md から本文を抽出 (ヘッダー後の本文)"""
    if not threads_md_path.exists():
        return None
    text = threads_md_path.read_text(encoding="utf-8")
    # 「---」以降を本文として扱う
    parts = re.split(r"\n---\s*\n", text, maxsplit=1)
    if len(parts) >= 2:
        return parts[1].strip()
    # フォールバック: 最初の # 見出しを除いた残り
    lines = text.split("\n")
    body_lines = [l for l in lines if not l.startswith("#") and l.strip()]
    return "\n".join(body_lines).strip() if body_lines else None


def is_already_promoted(crosspost_id: str) -> bool:
    if not POSTED_LOG.exists():
        return False
    return crosspost_id in POSTED_LOG.read_text(encoding="utf-8")


def mark_promoted(crosspost_id: str, platforms: list[str]):
    POSTED_LOG.parent.mkdir(parents=True, exist_ok=True)
    ts = datetime.datetime.now(JST).isoformat(timespec="seconds")
    with POSTED_LOG.open("a", encoding="utf-8") as f:
        f.write(f"{crosspost_id}\t{ts}\t{','.join(platforms)}\n")


def normalize_cookies(raw_json: str) -> list:
    """Cookie-Editor JSON → Playwright SetCookieParam形式"""
    raw = json.loads(raw_json)
    normalized = []
    for c in raw:
        new_c = {"name": c["name"], "value": c["value"]}
        if c.get("domain"):
            new_c["domain"] = c["domain"]
        new_c["path"] = c.get("path", "/")
        if "expirationDate" in c and not c.get("session"):
            try:
                new_c["expires"] = float(c["expirationDate"])
            except (TypeError, ValueError):
                pass
        if "sameSite" in c:
            ss = str(c["sameSite"]).lower()
            mapping = {"lax": "Lax", "strict": "Strict", "none": "None",
                       "no_restriction": "None", "unspecified": "None"}
            if ss in mapping:
                new_c["sameSite"] = mapping[ss]
        if "httpOnly" in c:
            new_c["httpOnly"] = bool(c["httpOnly"])
        if "secure" in c:
            new_c["secure"] = bool(c["secure"])
        normalized.append(new_c)
    return normalized


def post_to_x(text: str, dry_run: bool = False) -> bool:
    """X に直接ツイート (クッキー認証)"""
    cookie_json = os.environ.get("X_SESSION_COOKIE")
    if not cookie_json:
        print("⚠️ X_SESSION_COOKIE 未設定 → X 投稿スキップ")
        return False

    if dry_run:
        print(f"   [dry-run] X 投稿予定: {text[:60]}...")
        return True

    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-blink-features=AutomationControlled",
                  "--disable-dev-shm-usage"],
        )
        context = browser.new_context(
            viewport={"width": 1366, "height": 768},
            user_agent=USER_AGENT,
            locale="ja-JP",
            timezone_id="Asia/Tokyo",
            extra_http_headers={"Accept-Language": "ja-JP,ja;q=0.9,en;q=0.8"},
        )
        context.add_init_script(STEALTH_JS)

        try:
            cookies = normalize_cookies(cookie_json)
            context.add_cookies(cookies)
        except Exception as e:
            print(f"❌ クッキー解析失敗: {e}")
            browser.close()
            return False

        page = context.new_page()
        try:
            from playwright_stealth import stealth_sync
            stealth_sync(page)
        except Exception:
            pass

        try:
            page.goto("https://x.com/home", wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(3000)
            if "/login" in page.url or "/flow" in page.url:
                print("❌ X クッキー認証失敗")
                browser.close()
                return False

            # compose ページへ
            page.goto("https://x.com/compose/post", wait_until="domcontentloaded", timeout=20000)
            page.wait_for_timeout(4000)

            # テキスト入力
            text_filled = False
            for sel in ['[data-testid="tweetTextarea_0"]',
                        '[contenteditable="true"][role="textbox"]',
                        'div[role="textbox"][contenteditable="true"]']:
                try:
                    el = page.locator(sel).first
                    el.wait_for(timeout=5000, state="visible")
                    el.click()
                    page.keyboard.insert_text(text)
                    page.wait_for_timeout(1500)
                    text_filled = True
                    break
                except Exception:
                    continue

            if not text_filled:
                print("❌ X 入力欄が見つからない")
                page.screenshot(path="x-promo-failed.png")
                browser.close()
                return False

            # 投稿ボタン
            posted = False
            for sel in ['[data-testid="tweetButton"]',
                        '[data-testid="tweetButtonInline"]',
                        'button[data-testid*="tweet"]']:
                try:
                    page.locator(sel).first.click(timeout=3000)
                    page.wait_for_timeout(5000)
                    posted = True
                    break
                except Exception:
                    continue

            if not posted:
                print("❌ X 投稿ボタンが見つからない")
                browser.close()
                return False

            print(f"✅ X 投稿完了")
            browser.close()
            return True
        except Exception as e:
            print(f"❌ X 投稿エラー: {e}")
            try:
                page.screenshot(path="x-promo-error.png")
            except Exception:
                pass
            browser.close()
            return False


def post_to_threads(text: str, dry_run: bool = False) -> bool:
    """Threads に Meta Graph API で投稿"""
    token = os.environ.get("THREADS_ACCESS_TOKEN")
    user_id = os.environ.get("THREADS_USER_ID")
    if not token or not user_id:
        print("⚠️ THREADS_ACCESS_TOKEN / THREADS_USER_ID 未設定 → Threads 投稿スキップ")
        return False

    if dry_run:
        print(f"   [dry-run] Threads 投稿予定: {text[:60]}...")
        return True

    # 500字制限
    if len(text) > 500:
        text = text[:497] + "..."

    try:
        # Container 作成
        r1 = requests.post(
            f"https://graph.threads.net/v1.0/{user_id}/threads",
            params={"media_type": "TEXT", "text": text, "access_token": token},
            timeout=30,
        )
        if r1.status_code != 200:
            print(f"❌ Threads container作成失敗 ({r1.status_code}): {r1.text[:200]}")
            return False
        container_id = r1.json().get("id")
        if not container_id:
            print(f"❌ container_id取得失敗")
            return False

        # 公開
        r2 = requests.post(
            f"https://graph.threads.net/v1.0/{user_id}/threads_publish",
            params={"creation_id": container_id, "access_token": token},
            timeout=30,
        )
        if r2.status_code != 200:
            print(f"❌ Threads 公開失敗 ({r2.status_code}): {r2.text[:200]}")
            return False
        print(f"✅ Threads 投稿完了")
        return True
    except Exception as e:
        print(f"❌ Threads 投稿エラー: {e}")
        return False


def main(dry_run: bool = False) -> int:
    latest = find_latest_crosspost_dir()
    if not latest:
        print("ℹ️ cross-posts/ にディレクトリなし。スキップ")
        return 0

    crosspost_id = latest.name
    print(f"📦 最新クロスポスト: {crosspost_id}")

    if not dry_run and is_already_promoted(crosspost_id):
        print(f"ℹ️ {crosspost_id} は既に告知投稿済み。スキップ")
        return 0

    # メタ情報読み込み
    meta = {}
    meta_path = latest / "promo-meta.json"
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            # source_title / article_title いずれにも対応
            title = meta.get("source_title") or meta.get("article_title") or "?"
            print(f"   元記事: {title}")
        except Exception:
            pass

    # 公開URL を取得 (古い placeholder を実URL に置換するため)
    real_url = get_published_url()
    if real_url:
        print(f"   公開URL: {real_url}")

    # X 投稿
    x_text = extract_x_variant(latest / "x-variants.md", "A")
    threads_text = extract_threads_text(latest / "threads.md")

    # URL を実URL で上書き (x_text / threads_text 内の note.com/.../n... を置換)
    if real_url:
        url_pat = re.compile(r"https?://note\.com/[\w\-]+/n/n[a-z0-9]+(?:\?[^\s]*)?")
        if x_text:
            x_text = url_pat.sub(real_url, x_text)
        if threads_text:
            threads_text = url_pat.sub(real_url, threads_text)

    posted_platforms = []

    if x_text:
        print(f"\n🐦 X 投稿: {x_text[:80]}...")
        if post_to_x(x_text, dry_run=dry_run):
            posted_platforms.append("X")
    else:
        print("⚠️ X-A 本文が抽出できず")

    if threads_text:
        print(f"\n🧵 Threads 投稿: {threads_text[:80]}...")
        if post_to_threads(threads_text, dry_run=dry_run):
            posted_platforms.append("Threads")
    else:
        print("⚠️ Threads 本文が抽出できず")

    if posted_platforms and not dry_run:
        mark_promoted(crosspost_id, posted_platforms)

    print(f"\n📊 投稿成功: {posted_platforms or 'なし'}")
    return 0 if posted_platforms or dry_run else 1


if __name__ == "__main__":
    dry = "--dry-run" in sys.argv
    sys.exit(main(dry_run=dry))
