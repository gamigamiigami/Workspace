#!/usr/bin/env python3
"""
X (Twitter) 自動投稿スクリプト (Playwright自動ログイン版・完全無料)

GitHub Actions の cron で 1日2回 (JST 7am / 9pm) に実行され、
sns/weekly/{YYYY-MM-DD}-x-posts.md から該当スロットのツイートを抽出して投稿する。

【セットアップ（1回のみ・2分）】
GitHub > Settings > Secrets and variables > Actions に登録：
  - X_USERNAME: Xのユーザー名 (@は不要、例: rakuda_sensei) またはメールアドレス
  - X_PASSWORD: Xのパスワード

【注意・既知のリスク】
- Xは自動化を検出すると一時的なアカウントロックや確認コード要求を行うことがある
- 初回ログインで「不審なログイン」と判定されると、メール認証が必要になる場合あり
- 万一ロックされた場合は手動でログインして解除する必要あり
- 失敗時は X native scheduler (公式機能・完全無料) にフォールバック可能

【無料化の仕組み】
- Playwright: MIT License (¥0)
- GitHub Actions: 無料枠内 (¥0)
- X: 公式API不使用 (X APIは$100/月の有料サービス、これは使わない)
"""

import datetime
import os
import re
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[3]
WEEKLY_DIR = ROOT / "projects" / "rakuda-sensei" / "sns" / "weekly"
POSTED_LOG = ROOT / "projects" / "rakuda-sensei" / "sns" / ".x-posted.log"

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

JST = ZoneInfo("Asia/Tokyo")
WEEKDAY_JP = ["月", "火", "水", "木", "金", "土", "日"]


def current_slot() -> tuple[datetime.date, str]:
    """
    現在のJST時刻から (対象日付, スロット) を返す。
    2026-06-01 戦略変更: 朝/昼/夜 の3スロット体制 (1日3投稿)
    - 0-10時 → "朝" (7:00 cron でここに来る)
    - 10-17時 → "昼" (12:30 cron でここに来る)
    - 17-24時 → "夜" (21:00 cron でここに来る)
    """
    now = datetime.datetime.now(JST)
    h = now.hour
    if h < 10:
        slot = "朝"
    elif h < 17:
        slot = "昼"
    else:
        slot = "夜"
    return now.date(), slot


def find_weekly_file(target_date: datetime.date) -> Path | None:
    """指定日を含む週のweeklyファイルを探す（月曜起算）"""
    monday = target_date - datetime.timedelta(days=target_date.weekday())
    candidate = WEEKLY_DIR / f"{monday.isoformat()}-x-posts.md"
    if candidate.exists():
        return candidate
    # 直近のweeklyファイルを使う（フォールバック）
    files = sorted(WEEKLY_DIR.glob("*-x-posts.md"), reverse=True)
    return files[0] if files else None


def extract_tweet(weekly_md: str, target_date: datetime.date, slot: str) -> str | None:
    """
    weeklyファイル内から指定日・スロットの本文を抽出。
    ## 5/26(月) のような見出し配下の ### 朝/### 昼/### 夜 セクションの「本文:」を返す。
    """
    month = target_date.month
    day = target_date.day
    weekday = WEEKDAY_JP[target_date.weekday()]

    # 日付ヘッダーを探す: ## 5/26(月)
    day_pattern = rf"##\s*{month}/{day}\([月火水木金土日]\)"
    day_match = re.search(day_pattern, weekly_md)
    if not day_match:
        # 別パターン: ## 5月26日 など
        alt_pattern = rf"##\s*{month}月{day}日"
        day_match = re.search(alt_pattern, weekly_md)
        if not day_match:
            print(f"WARNING: {month}/{day}({weekday}) のセクションが見つかりません", file=sys.stderr)
            return None

    # その日のセクションを抜き出す（次の ## または EOF まで）
    section_start = day_match.end()
    next_day = re.search(r"\n##\s+\d", weekly_md[section_start:])
    section = weekly_md[section_start: section_start + (next_day.start() if next_day else len(weekly_md))]

    # スロット (### 朝 / ### 夜) を探す
    slot_pattern = rf"###\s*{slot}"
    slot_match = re.search(slot_pattern, section)
    if not slot_match:
        print(f"WARNING: {slot}スロットが見つかりません", file=sys.stderr)
        return None

    slot_start = slot_match.end()
    next_slot = re.search(r"\n###\s+", section[slot_start:])
    slot_section = section[slot_start: slot_start + (next_slot.start() if next_slot else len(section))]

    # 本文を抽出: "- 本文:" の次の行から空行 or "- タグ:" まで
    body_match = re.search(r"-\s*本文[：:]\s*\n((?:(?!- タグ|\n##|\n###).*\n?)+)", slot_section)
    if body_match:
        body = body_match.group(1).strip()
        # 末尾の "- タグ:" 行があれば除去
        body = re.split(r"\n-\s*タグ", body)[0].strip()
        return body

    return None


def is_already_posted(target_date: datetime.date, slot: str) -> bool:
    if not POSTED_LOG.exists():
        return False
    key = f"{target_date.isoformat()}-{slot}"
    return key in POSTED_LOG.read_text(encoding="utf-8")


def mark_posted(target_date: datetime.date, slot: str, tweet_text: str):
    POSTED_LOG.parent.mkdir(parents=True, exist_ok=True)
    key = f"{target_date.isoformat()}-{slot}"
    timestamp = datetime.datetime.now(JST).isoformat(timespec="seconds")
    with POSTED_LOG.open("a", encoding="utf-8") as f:
        f.write(f"{key}\t{timestamp}\t{tweet_text[:50]}...\n")


def login_to_x(page, username: str, password: str) -> bool:
    """X (Twitter) にユーザー名/パスワードで自動ログイン"""
    print("🔐 X (Twitter) にログイン中...")
    page.goto("https://x.com/i/flow/login", wait_until="networkidle", timeout=30000)
    page.wait_for_timeout(3000)

    # ユーザー名入力
    try:
        username_input = page.locator('input[autocomplete="username"], input[name="text"]').first
        username_input.wait_for(timeout=10000, state="visible")
        username_input.fill(username)
        page.wait_for_timeout(800)
    except Exception as e:
        print(f"ERROR: Xのユーザー名入力欄が見つかりません: {e}", file=sys.stderr)
        return False

    # 「次へ」ボタン
    try:
        next_btn = page.locator('button:has-text("次へ"), button:has-text("Next"), [role="button"]:has-text("次へ")').first
        next_btn.click(timeout=5000)
        page.wait_for_timeout(3000)
    except Exception:
        page.keyboard.press("Enter")
        page.wait_for_timeout(3000)

    # 追加の本人確認が要求される場合（電話番号/ユーザー名再入力）
    try:
        extra_check = page.locator('input[data-testid="ocfEnterTextTextInput"]').first
        if extra_check.is_visible(timeout=3000):
            print("WARNING: Xが追加の本人確認を要求しています", file=sys.stderr)
            # ユーザー名(@なし)を入力
            extra_check.fill(username.lstrip("@"))
            page.wait_for_timeout(500)
            page.keyboard.press("Enter")
            page.wait_for_timeout(3000)
    except Exception:
        pass

    # パスワード入力
    try:
        password_input = page.locator('input[autocomplete="current-password"], input[type="password"]').first
        password_input.wait_for(timeout=10000, state="visible")
        password_input.fill(password)
        page.wait_for_timeout(800)
    except Exception as e:
        print(f"ERROR: Xのパスワード入力欄が見つかりません: {e}", file=sys.stderr)
        return False

    # ログインボタン
    try:
        login_btn = page.locator('button:has-text("ログイン"), button:has-text("Log in"), [data-testid="LoginForm_Login_Button"]').first
        login_btn.click(timeout=5000)
    except Exception:
        page.keyboard.press("Enter")

    page.wait_for_timeout(5000)
    try:
        page.wait_for_load_state("networkidle", timeout=15000)
    except Exception:
        pass

    # ログイン成否
    if "/login" in page.url or "/flow" in page.url:
        # 認証コード要求かチェック
        try:
            challenge = page.locator('input[data-testid="ocfEnterTextTextInput"]').first
            if challenge.is_visible(timeout=2000):
                print("ERROR: Xが認証コードを要求しています。手動ログインで解除してください", file=sys.stderr)
                return False
        except Exception:
            pass
        print(f"ERROR: Xログイン失敗。URL: {page.url}", file=sys.stderr)
        return False

    print("✅ Xログイン成功")
    return True


def post_tweet(page, tweet_text: str) -> bool:
    """ツイートを投稿"""
    print(f"📝 投稿中: {tweet_text[:30]}...")

    # X は SPA で networkidle が永遠に来ないので domcontentloaded を使う
    # 複数のcompose URL候補を試す
    compose_urls = [
        "https://x.com/compose/post",
        "https://x.com/compose/tweet",  # 旧URL
        "https://twitter.com/compose/tweet",  # twitter.comドメイン
    ]
    compose_loaded = False
    for url in compose_urls:
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=20000)
            page.wait_for_timeout(4000)  # SPA レンダリング待ち
            compose_loaded = True
            print(f"   📍 compose 到達: {page.url}")
            break
        except Exception as e:
            print(f"   ⏭ {url} 失敗: {e}", file=sys.stderr)
            continue

    if not compose_loaded:
        # フォールバック: home から compose ボタンをクリック
        try:
            page.goto("https://x.com/home", wait_until="domcontentloaded", timeout=20000)
            page.wait_for_timeout(3000)
            for sel in [
                '[data-testid="SideNav_NewTweet_Button"]',
                'a[href="/compose/post"]',
                'a[href="/compose/tweet"]',
                'button:has-text("ポスト")',
            ]:
                try:
                    page.locator(sel).first.click(timeout=3000)
                    page.wait_for_timeout(3000)
                    compose_loaded = True
                    print(f"   📍 home → compose ボタンで到達")
                    break
                except Exception:
                    continue
        except Exception as e:
            print(f"ERROR: home 経由も失敗: {e}", file=sys.stderr)
            return False

    if not compose_loaded:
        print("ERROR: compose 画面に到達できず", file=sys.stderr)
        try:
            page.screenshot(path="x-compose-failed.png")
        except Exception:
            pass
        return False

    # ツイート入力欄 - セレクタ拡充
    text_selectors = [
        '[data-testid="tweetTextarea_0"]',
        '[contenteditable="true"][role="textbox"]',
        '[contenteditable="true"][data-text="true"]',
        'div[role="textbox"][contenteditable="true"]',
    ]
    text_filled = False
    for sel in text_selectors:
        try:
            tweet_area = page.locator(sel).first
            tweet_area.wait_for(timeout=5000, state="visible")
            tweet_area.click()
            page.keyboard.insert_text(tweet_text)
            page.wait_for_timeout(1500)
            print(f"   ✅ テキスト入力完了 (selector: {sel})")
            text_filled = True
            break
        except Exception:
            continue

    if not text_filled:
        print("ERROR: ツイート入力欄が見つかりません", file=sys.stderr)
        try:
            page.screenshot(path="x-text-not-found.png")
        except Exception:
            pass
        return False

    # 投稿ボタン - セレクタ拡充
    post_btn_selectors = [
        '[data-testid="tweetButton"]',
        '[data-testid="tweetButtonInline"]',
        'button[data-testid*="tweet"]',
        'button:has-text("ポストする")',
        'button:has-text("ポスト")',
        'button[type="submit"]',
    ]
    posted = False
    for sel in post_btn_selectors:
        try:
            post_btn = page.locator(sel).first
            post_btn.wait_for(timeout=3000, state="visible")
            post_btn.click(timeout=5000)
            page.wait_for_timeout(5000)
            posted = True
            print(f"   ✅ 投稿ボタンクリック (selector: {sel})")
            break
        except Exception:
            continue

    if not posted:
        print("ERROR: 投稿ボタンが見つかりません", file=sys.stderr)
        try:
            page.screenshot(path="x-post-button-failed.png")
        except Exception:
            pass
        return False

    print("✅ ツイート投稿完了")
    return True


def main(force: bool = False, dry_run: bool = False) -> int:
    target_date, slot = current_slot()
    print(f"🕐 現在のスロット: {target_date.isoformat()} {WEEKDAY_JP[target_date.weekday()]}曜 {slot}")

    if not force and is_already_posted(target_date, slot):
        print(f"ℹ️  このスロットは既に投稿済みです (force=Trueで再投稿可)")
        return 0

    weekly_file = find_weekly_file(target_date)
    if not weekly_file:
        # 投稿対象が無いのは「やることなし」→スキップ（赤エラーにしない）
        print(f"ℹ️  weeklyファイルなし ({WEEKLY_DIR}) → 投稿対象なしのためスキップ")
        return 0

    print(f"📂 weekly: {weekly_file.name}")
    tweet_text = extract_tweet(weekly_file.read_text(encoding="utf-8"), target_date, slot)
    if not tweet_text:
        # 該当スロットのツイートが無いのも「やることなし」→スキップ
        print(f"ℹ️  {target_date} {slot} のツイートなし → スキップ")
        return 0

    print(f"📝 投稿予定: {tweet_text}")
    print(f"📏 文字数: {len(tweet_text)}")

    if dry_run:
        print("✅ Dry run完了")
        return 0

    username = os.environ.get("X_USERNAME")
    password = os.environ.get("X_PASSWORD")
    cookie_json = os.environ.get("X_SESSION_COOKIE")

    if not cookie_json and (not username or not password):
        print("ℹ️  X_SESSION_COOKIE もしくは X_USERNAME/X_PASSWORD 未設定のためスキップ")
        print("   → 推奨: Cookie-Editor で取得した X_SESSION_COOKIE を Secret 登録")
        print("   → 詳細: projects/rakuda-sensei/automation/setup/cookie-setup.md")
        return 0

    from playwright.sync_api import sync_playwright

    # 自作ステルス JS (note/booth と同じ)
    STEALTH_JS = """
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['ja-JP', 'ja', 'en-US', 'en'] });
    window.chrome = { runtime: {} };
    """

    def normalize_cookies(raw_json: str) -> list:
        """Cookie-Editor JSON → Playwright SetCookieParam 形式"""
        import json as _json
        raw = _json.loads(raw_json)
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
                m = {"lax": "Lax", "strict": "Strict",
                     "none": "None", "no_restriction": "None", "unspecified": "None"}
                if ss in m:
                    new_c["sameSite"] = m[ss]
            if "httpOnly" in c:
                new_c["httpOnly"] = bool(c["httpOnly"])
            if "secure" in c:
                new_c["secure"] = bool(c["secure"])
            normalized.append(new_c)
        return normalized

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-blink-features=AutomationControlled",
                "--disable-dev-shm-usage",
            ],
        )
        context = browser.new_context(
            viewport={"width": 1366, "height": 768},
            user_agent=USER_AGENT,
            locale="ja-JP",
            timezone_id="Asia/Tokyo",
            extra_http_headers={"Accept-Language": "ja-JP,ja;q=0.9,en;q=0.8"},
        )
        context.add_init_script(STEALTH_JS)

        # クッキー認証を優先（reCAPTCHA回避・推奨）
        cookie_auth = False
        if cookie_json:
            try:
                cookies = normalize_cookies(cookie_json)
                context.add_cookies(cookies)
                cookie_auth = True
                print(f"🍪 X クッキー認証 ({len(cookies)}個・正規化済み)")
            except Exception as e:
                print(f"WARNING: クッキー解析失敗: {e}", file=sys.stderr)
                import traceback
                traceback.print_exc(file=sys.stderr)

        page = context.new_page()

        # playwright-stealth (最初の goto 前)
        try:
            from playwright_stealth import stealth_sync
            stealth_sync(page)
            print("🥷 playwright-stealth 適用")
        except ImportError:
            print("⚠️ playwright-stealth なし（自作STEALTH_JSのみ）")
        except Exception:
            pass

        try:
            if cookie_auth:
                # クッキーで認証済みなのでホームへ
                page.goto("https://x.com/home", wait_until="domcontentloaded", timeout=30000)
                page.wait_for_timeout(3000)
                if "/login" in page.url or "/flow" in page.url:
                    print("ERROR: X クッキーが無効/期限切れ。再取得してください", file=sys.stderr)
                    page.screenshot(path="x-cookie-invalid.png")
                    browser.close()
                    return 1
                print(f"✅ X クッキーログインOK ({page.url})")
            else:
                # フォールバック: メール/パスワード (reCAPTCHA リスクあり)
                if not login_to_x(page, username, password):
                    page.screenshot(path="x-login-failed.png")
                    browser.close()
                    return 1

            if not post_tweet(page, tweet_text):
                page.screenshot(path="x-post-failed.png")
                browser.close()
                return 1

            mark_posted(target_date, slot, tweet_text)

        except Exception as e:
            print(f"ERROR: 予期しないエラー: {e}", file=sys.stderr)
            try:
                page.screenshot(path="x-error.png")
            except Exception:
                pass
            browser.close()
            return 1

        browser.close()

    return 0


if __name__ == "__main__":
    args = sys.argv[1:]
    force = "--force" in args
    dry_run = "--dry-run" in args
    sys.exit(main(force=force, dry_run=dry_run))
