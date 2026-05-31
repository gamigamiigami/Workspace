#!/usr/bin/env python3
"""
BOOTH 商品自動出品スクリプト (Playwright自動ログイン版・完全無料)

GitHub Actions で workflow_dispatch トリガーにより実行。
PIXIV_EMAIL / PIXIV_PASSWORD (GitHub Secret) で毎回自動ログインしてから出品する。
(BOOTHはpixivアカウントでログインするため)

【セットアップ（1回のみ・2分）】
GitHub > Settings > Secrets and variables > Actions に以下を登録：
  - PIXIV_EMAIL: pixivログインメールアドレス
  - PIXIV_PASSWORD: pixivログインパスワード

【無料化の仕組み】
- Playwright: MIT License (追加課金なし)
- GitHub Actions: 無料枠内
- BOOTH/pixiv: メール/パスワード認証 (APIキー不要)
"""

import os
import sys
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


def parse_product_meta(html_path: Path) -> dict:
    text = html_path.read_text(encoding="utf-8")
    meta = {"title": "", "price": 0, "description": "", "tags": []}

    title_m = re.search(r"<!--\s*BOOTH_TITLE:\s*(.+?)\s*-->", text)
    if title_m:
        meta["title"] = title_m.group(1).strip()

    price_m = re.search(r"<!--\s*BOOTH_PRICE:\s*(\d+)\s*-->", text)
    if price_m:
        meta["price"] = int(price_m.group(1))

    desc_m = re.search(r"<!--\s*BOOTH_DESC:\s*(.+?)\s*-->", text, re.DOTALL)
    if desc_m:
        meta["description"] = desc_m.group(1).strip()

    tags_m = re.search(r"<!--\s*BOOTH_TAGS:\s*(.+?)\s*-->", text)
    if tags_m:
        meta["tags"] = [t.strip() for t in tags_m.group(1).split(",")]

    return meta


def login_to_booth(page, email: str, password: str) -> bool:
    """BOOTH (pixiv経由) にメール/パスワードで自動ログイン"""
    print("🔐 BOOTH (pixiv) にログイン中...")
    # BOOTHのログインボタンはpixivの認証ページへリダイレクトする
    page.goto("https://accounts.pixiv.net/login?return_to=https%3A%2F%2Fmanage.booth.pm%2F",
              wait_until="networkidle", timeout=30000)
    page.wait_for_timeout(2000)

    # メールアドレス入力
    email_selectors = [
        'input[autocomplete="username"]',
        'input[type="email"]',
        'input[placeholder*="メール"]',
        'input[placeholder*="ID"]',
    ]
    email_filled = False
    for sel in email_selectors:
        try:
            el = page.locator(sel).first
            el.wait_for(timeout=5000, state="visible")
            el.fill(email)
            email_filled = True
            break
        except Exception:
            continue

    if not email_filled:
        print("ERROR: pixivのメール入力欄が見つかりませんでした", file=sys.stderr)
        return False

    # パスワード入力
    password_selectors = [
        'input[autocomplete="current-password"]',
        'input[type="password"]',
    ]
    password_filled = False
    for sel in password_selectors:
        try:
            el = page.locator(sel).first
            el.wait_for(timeout=5000, state="visible")
            el.fill(password)
            password_filled = True
            break
        except Exception:
            continue

    if not password_filled:
        print("ERROR: pixivのパスワード入力欄が見つかりませんでした", file=sys.stderr)
        return False

    page.wait_for_timeout(800)

    # ログインボタン
    for sel in ['button[type="submit"]', 'button:has-text("ログイン")', 'button:has-text("Login")']:
        try:
            page.locator(sel).first.click(timeout=5000)
            break
        except Exception:
            continue

    page.wait_for_timeout(5000)
    try:
        page.wait_for_load_state("networkidle", timeout=15000)
    except Exception:
        pass

    current_url = page.url
    if "accounts.pixiv.net" in current_url and "login" in current_url:
        print("ERROR: BOOTH/pixivログイン失敗。メール/パスワードを確認してください", file=sys.stderr)
        return False

    # BOOTH管理画面に到達したか確認
    if "manage.booth.pm" not in current_url:
        # 手動でmanage.booth.pmへ
        page.goto("https://manage.booth.pm/", wait_until="networkidle", timeout=20000)
        page.wait_for_timeout(2000)
        if "login" in page.url.lower() or "accounts.pixiv.net" in page.url:
            print("ERROR: BOOTH管理画面に到達できませんでした", file=sys.stderr)
            return False

    print("✅ BOOTHログイン成功")
    return True


def post_to_booth(
    product_path: str,
    pdf_path: str,
    title: str = "",
    price: int = 0,
    description: str = "",
    dry_run: bool = False,
) -> int:
    email = os.environ.get("PIXIV_EMAIL")
    password = os.environ.get("PIXIV_PASSWORD")
    if not email or not password:
        print("ERROR: PIXIV_EMAIL / PIXIV_PASSWORD が設定されていません", file=sys.stderr)
        print("  → GitHub Settings > Secrets and variables > Actions で登録してください", file=sys.stderr)
        return 1

    product_file = ROOT / product_path
    meta = {"title": title, "price": price, "description": description, "tags": []}

    if product_file.exists() and product_file.suffix == ".html":
        file_meta = parse_product_meta(product_file)
        if not meta["title"]:
            meta["title"] = file_meta["title"]
        if not meta["price"]:
            meta["price"] = file_meta["price"]
        if not meta["description"]:
            meta["description"] = file_meta["description"]
        meta["tags"] = file_meta["tags"]

    if not meta["title"]:
        print("ERROR: 商品タイトルが未設定です", file=sys.stderr)
        return 1
    if not meta["price"]:
        print("ERROR: 価格が未設定です", file=sys.stderr)
        return 1

    pdf_file = ROOT / pdf_path if pdf_path else None
    if pdf_file and not pdf_file.exists():
        print(f"ERROR: PDFファイルが見つかりません: {pdf_file}", file=sys.stderr)
        return 1

    print(f"📦 出品商品: {meta['title']}")
    print(f"💴 価格: ¥{meta['price']}")
    print(f"📎 ファイル: {pdf_path or '（なし）'}")

    if dry_run:
        print("✅ Dry run完了")
        return 0

    from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-blink-features=AutomationControlled"])
        context = browser.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent=USER_AGENT,
            locale="ja-JP",
            timezone_id="Asia/Tokyo",
        )

        # クッキー認証を優先（reCAPTCHA回避）
        cookie_json = os.environ.get("BOOTH_SESSION_COOKIE")
        cookie_auth = False
        if cookie_json:
            try:
                import json as _json
                cookies = _json.loads(cookie_json)
                context.add_cookies(cookies)
                cookie_auth = True
                print(f"🍪 クッキー認証 ({len(cookies)}個のクッキー)")
            except Exception as e:
                print(f"WARNING: クッキー解析失敗: {e}", file=sys.stderr)

        page = context.new_page()

        try:
            if cookie_auth:
                page.goto("https://manage.booth.pm/", wait_until="domcontentloaded", timeout=30000)
                page.wait_for_timeout(2000)
                if "login" in page.url.lower() or "accounts.pixiv.net" in page.url:
                    print("ERROR: クッキーが無効/期限切れ。再取得してください", file=sys.stderr)
                    page.screenshot(path="booth-cookie-invalid.png")
                    browser.close()
                    return 1
                print(f"✅ BOOTHクッキーログインOK ({page.url})")
            else:
                if not login_to_booth(page, email, password):
                    page.screenshot(path="booth-login-failed.png")
                    browser.close()
                    return 1

            # 新規商品作成ページへ
            page.goto("https://manage.booth.pm/items/new", wait_until="networkidle", timeout=30000)
            page.wait_for_timeout(3000)

            # 商品名入力
            try:
                name_input = page.locator('input[name="item[name]"], input[placeholder*="商品名"], input[id*="name"]').first
                name_input.wait_for(timeout=10000)
                name_input.fill(meta["title"])
                page.wait_for_timeout(300)
                print("✅ 商品名入力完了")
            except PWTimeout:
                print("ERROR: 商品名入力欄が見つかりませんでした", file=sys.stderr)
                page.screenshot(path="booth-post-failed.png")
                browser.close()
                return 1

            # 説明文
            if meta["description"]:
                try:
                    desc_area = page.locator('textarea[name="item[description]"], textarea[placeholder*="説明"]').first
                    desc_area.fill(meta["description"], timeout=5000)
                    page.wait_for_timeout(300)
                    print("✅ 説明文入力完了")
                except Exception as e:
                    print(f"WARNING: 説明文入力失敗: {e}", file=sys.stderr)

            # 価格
            try:
                price_input = page.locator('input[name="item[price]"], input[type="number"]').first
                price_input.fill(str(meta["price"]), timeout=5000)
                page.wait_for_timeout(300)
                print(f"✅ 価格入力完了: ¥{meta['price']}")
            except Exception as e:
                print(f"WARNING: 価格入力失敗: {e}", file=sys.stderr)

            # カテゴリ
            try:
                cat_sel = page.locator('select[name*="category"]').first
                cat_sel.select_option(label="ダウンロードコンテンツ", timeout=5000)
                page.wait_for_timeout(300)
            except Exception:
                pass

            # ファイルアップロード
            if pdf_file and pdf_file.exists():
                try:
                    page.locator('input[type="file"]').first.set_input_files(str(pdf_file), timeout=10000)
                    page.wait_for_timeout(3000)
                    print(f"✅ ファイルアップロード完了: {pdf_file.name}")
                except Exception as e:
                    print(f"WARNING: ファイルアップロード失敗: {e}", file=sys.stderr)

            # 在庫: 無制限
            try:
                page.locator('input[value="unlimited"], label:has-text("無制限")').first.click(timeout=5000)
                page.wait_for_timeout(300)
            except Exception:
                pass

            # 出品
            submitted = False
            for sel in ['button[type="submit"]:has-text("出品")', 'button[type="submit"]:has-text("保存")', 'input[type="submit"]']:
                try:
                    page.locator(sel).first.click(timeout=5000)
                    page.wait_for_timeout(5000)
                    submitted = True
                    break
                except Exception:
                    continue

            if submitted and "items" in page.url:
                print(f"✅ BOOTH出品完了！URL: {page.url}")
            else:
                print("WARNING: 出品確認ができませんでした", file=sys.stderr)
                page.screenshot(path="booth-post-result.png")

        except Exception as e:
            print(f"ERROR: 予期しないエラー: {e}", file=sys.stderr)
            try:
                page.screenshot(path="booth-post-error.png")
            except Exception:
                pass
            browser.close()
            return 1

        browser.close()

    return 0


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="BOOTHに商品を自動出品する")
    parser.add_argument("product_path")
    parser.add_argument("--pdf", default="")
    parser.add_argument("--title", default="")
    parser.add_argument("--price", type=int, default=0)
    parser.add_argument("--description", default="")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    sys.exit(post_to_booth(args.product_path, args.pdf, args.title, args.price, args.description, args.dry_run))
