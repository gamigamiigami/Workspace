#!/usr/bin/env python3
"""
クッキー動作確認スクリプト（投稿せずに認証通るかだけチェック）

【使い方】
GitHub Actions workflow_dispatch から手動実行。
事前に NOTE_SESSION_COOKIE / BOOTH_SESSION_COOKIE をSecret登録しておく。

【出力】
各サイトに対して:
  - クッキー件数
  - 正規化後の件数
  - ページ訪問後のURL
  - ログイン状態の判定（ユーザーアバター/メールがあるか等）
  - スクリーンショット（GitHub Actions Artifactとして保存）
"""

import os
import sys
import json
from pathlib import Path

# 既存モジュールの normalize_cookies を使う
sys.path.insert(0, str(Path(__file__).parent))
from post_to_note import normalize_cookies as nn_note
from post_to_booth import normalize_cookies as nn_booth

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

STEALTH_JS = """
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
Object.defineProperty(navigator, 'languages', { get: () => ['ja-JP', 'ja', 'en-US', 'en'] });
window.chrome = { runtime: {} };
"""


def check_one(site_name: str, secret_env: str, normalizer, urls_to_check: list, login_indicators: list):
    """
    サイト1つを診断する。
    urls_to_check: 訪問するURL候補
    login_indicators: ログイン中なら見えるはずのCSSセレクタ
    """
    print(f"\n{'=' * 60}")
    print(f"🔍 {site_name} 診断開始")
    print(f"{'=' * 60}")

    raw = os.environ.get(secret_env)
    if not raw:
        print(f"❌ {secret_env} 未設定 → setup/cookie-setup.md を参照")
        return False

    try:
        cookies = normalizer(raw)
        print(f"✅ クッキー正規化成功: {len(cookies)}個")
        # 主要クッキーの存在確認
        names = [c['name'] for c in cookies]
        print(f"   クッキー名一覧: {', '.join(names[:10])}{'...' if len(names) > 10 else ''}")
    except Exception as e:
        print(f"❌ クッキー解析/正規化失敗: {e}")
        return False

    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage"],
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
            context.add_cookies(cookies)
            print(f"✅ Playwrightにクッキーセット成功")
        except Exception as e:
            print(f"❌ Playwright add_cookies失敗: {e}")
            browser.close()
            return False

        page = context.new_page()

        all_ok = True
        for url in urls_to_check:
            try:
                print(f"\n  🔗 訪問: {url}")
                page.goto(url, wait_until="domcontentloaded", timeout=30000)
                page.wait_for_timeout(3000)

                final_url = page.url
                title = page.title()
                print(f"     最終URL: {final_url}")
                print(f"     タイトル: {title}")

                # スクリーンショット保存
                shot_name = f"check-{site_name.lower()}-{urls_to_check.index(url)}.png"
                page.screenshot(path=shot_name)
                print(f"     📸 {shot_name}")

                # ログイン判定: ログインページにリダイレクトされていない
                redirect_to_login = any(kw in final_url.lower() for kw in ["/login", "/signin", "sign_in"])
                if redirect_to_login:
                    print(f"     ❌ ログインページへリダイレクト → クッキー無効")
                    all_ok = False
                    continue

                # ログイン中インジケータをチェック
                found_indicator = False
                for sel in login_indicators:
                    try:
                        if page.locator(sel).first.is_visible(timeout=2000):
                            print(f"     ✅ ログイン状態確認: {sel} が表示中")
                            found_indicator = True
                            break
                    except Exception:
                        continue

                if not found_indicator and not redirect_to_login:
                    print(f"     ⚠️ ログインインジケータが見つからず（クッキー有効か不明確）")

            except Exception as e:
                print(f"     ❌ エラー: {e}")
                all_ok = False

        browser.close()
        return all_ok


def main() -> int:
    print("🩺 クッキー認証 事前診断")
    print(f"   Pythonバージョン: {sys.version.split()[0]}")

    results = {}

    # note診断
    results["note"] = check_one(
        "note",
        "NOTE_SESSION_COOKIE",
        nn_note,
        ["https://note.com/", "https://note.com/notes"],
        [
            'img[alt*="アバター"]',
            'button[aria-label*="メニュー"]',
            '[data-testid*="user"]',
            'a[href*="/settings"]',
            'a[href*="/notes/manage"]',
        ],
    )

    # BOOTH診断
    results["booth"] = check_one(
        "BOOTH",
        "BOOTH_SESSION_COOKIE",
        nn_booth,
        ["https://manage.booth.pm/", "https://manage.booth.pm/items"],
        [
            'a[href*="logout"]',
            'a[href*="sign_out"]',
            'img[alt*="プロフィール"]',
            '.user-name',
            '[class*="header-user"]',
        ],
    )

    print("\n" + "=" * 60)
    print("📊 診断結果サマリー")
    print("=" * 60)
    for site, ok in results.items():
        status = "✅ 認証OK" if ok else "❌ 認証NG / 要再取得"
        print(f"  {site}: {status}")

    # 全部OKなら0、1つでもNGなら1
    return 0 if all(results.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
