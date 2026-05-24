#!/usr/bin/env python3
"""
BOOTH 商品自動出品スクリプト (Playwright版・完全無料)

GitHub Actions で workflow_dispatch トリガーにより実行。
BOOTH_SESSION_COOKIE (GitHub Secret) で認証し、教材PDFをBOOTHに出品する。

【初回セットアップ（1回のみ・人間作業5分）】
setup/cookie-setup-guide.md を参照。

【無料化の仕組み】
- Playwright: MIT License (追加課金なし)
- GitHub Actions: 無料枠内
- BOOTH: セッションクッキー認証 (APIキー不要)
"""

import json
import os
import sys
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def parse_product_meta(html_path: Path) -> dict:
    """HTMLファイルの埋め込みコメントから商品メタ情報を取得"""
    text = html_path.read_text(encoding="utf-8")
    meta = {
        "title": "",
        "price": 0,
        "description": "",
        "tags": [],
    }

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


def post_to_booth(
    product_path: str,
    pdf_path: str,
    title: str = "",
    price: int = 0,
    description: str = "",
    dry_run: bool = False,
) -> int:
    cookie_json = os.environ.get("BOOTH_SESSION_COOKIE")
    if not cookie_json:
        print("ERROR: BOOTH_SESSION_COOKIE が設定されていません", file=sys.stderr)
        print("  → setup/cookie-setup-guide.md を参照してGitHub Secretに登録してください", file=sys.stderr)
        return 1

    try:
        cookies = json.loads(cookie_json)
    except json.JSONDecodeError as e:
        print(f"ERROR: BOOTH_SESSION_COOKIE のJSON解析に失敗: {e}", file=sys.stderr)
        return 1

    # 商品メタ情報取得
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
        print("ERROR: 商品タイトルが未設定です (--title で指定するか HTMLコメントに BOOTH_TITLE を記載)", file=sys.stderr)
        return 1

    if not meta["price"]:
        print("ERROR: 価格が未設定です (--price で指定するか HTMLコメントに BOOTH_PRICE を記載)", file=sys.stderr)
        return 1

    # PDFファイル確認
    pdf_file = ROOT / pdf_path if pdf_path else None
    if pdf_file and not pdf_file.exists():
        print(f"ERROR: PDFファイルが見つかりません: {pdf_file}", file=sys.stderr)
        return 1

    print(f"📦 出品商品: {meta['title']}")
    print(f"💴 価格: ¥{meta['price']}")
    print(f"📎 ファイル: {pdf_path or '（なし）'}")

    if dry_run:
        print("✅ Dry run完了（実際には出品していません）")
        return 0

    from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
        context = browser.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        )
        context.add_cookies(cookies)

        page = context.new_page()

        try:
            page.goto("https://manage.booth.pm/", wait_until="networkidle", timeout=30000)
            page.wait_for_timeout(2000)

            if "login" in page.url.lower() or "accounts.booth.pm" in page.url:
                print("ERROR: セッションクッキーが無効または期限切れです", file=sys.stderr)
                print("  → setup/cookie-setup-guide.md を参照してクッキーを再取得してください", file=sys.stderr)
                browser.close()
                return 1

            print("✅ BOOTH管理ログイン確認OK")

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

            # 説明文入力
            if meta["description"]:
                try:
                    desc_area = page.locator('textarea[name="item[description]"], textarea[placeholder*="説明"], [contenteditable="true"]').first
                    desc_area.fill(meta["description"], timeout=5000)
                    page.wait_for_timeout(300)
                    print("✅ 説明文入力完了")
                except Exception as e:
                    print(f"WARNING: 説明文入力に失敗: {e}", file=sys.stderr)

            # 価格入力
            try:
                price_input = page.locator('input[name="item[price]"], input[type="number"], input[placeholder*="価格"]').first
                price_input.fill(str(meta["price"]), timeout=5000)
                page.wait_for_timeout(300)
                print(f"✅ 価格入力完了: ¥{meta['price']}")
            except Exception as e:
                print(f"WARNING: 価格入力に失敗: {e}", file=sys.stderr)

            # カテゴリー設定（ダウンロードコンテンツ）
            try:
                category_sel = page.locator('select[name*="category"], [class*="category"] select').first
                # BOOTHのカテゴリーIDはサイトにより異なるため、利用可能なオプションから選択
                category_sel.select_option(label="ダウンロードコンテンツ", timeout=5000)
                page.wait_for_timeout(300)
                print("✅ カテゴリー設定完了")
            except Exception:
                pass  # カテゴリーが見つからない場合はスキップ

            # PDFファイルアップロード
            if pdf_file and pdf_file.exists():
                try:
                    file_input = page.locator('input[type="file"]').first
                    file_input.set_input_files(str(pdf_file), timeout=10000)
                    page.wait_for_timeout(3000)  # アップロード完了待ち
                    print(f"✅ ファイルアップロード完了: {pdf_file.name}")
                except Exception as e:
                    print(f"WARNING: ファイルアップロードに失敗: {e}", file=sys.stderr)

            # 在庫設定（デジタルコンテンツは無制限）
            try:
                unlimited_option = page.locator('input[value="unlimited"], label:has-text("無制限")').first
                unlimited_option.click(timeout=5000)
                page.wait_for_timeout(300)
            except Exception:
                pass

            # 保存・出品
            save_btns = [
                'button[type="submit"]:has-text("出品する")',
                'button[type="submit"]:has-text("保存")',
                'input[type="submit"]',
            ]
            submitted = False
            for sel in save_btns:
                try:
                    btn = page.locator(sel).first
                    btn.wait_for(timeout=5000)
                    btn.click()
                    page.wait_for_timeout(5000)
                    submitted = True
                    break
                except Exception:
                    continue

            if submitted and "items" in page.url:
                print(f"✅ BOOTH出品完了！URL: {page.url}")
            else:
                print("WARNING: 出品確認ができませんでした。スクリーンショットを確認してください", file=sys.stderr)
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
    parser.add_argument("product_path", help="商品HTMLファイルのパス（Workspaceルートからの相対パス）")
    parser.add_argument("--pdf", default="", help="添付PDFファイルのパス")
    parser.add_argument("--title", default="", help="商品タイトル（HTMLコメントより優先）")
    parser.add_argument("--price", type=int, default=0, help="価格（HTMLコメントより優先）")
    parser.add_argument("--description", default="", help="説明文（HTMLコメントより優先）")
    parser.add_argument("--dry-run", action="store_true", help="実際には出品しない（テスト用）")
    args = parser.parse_args()

    sys.exit(
        post_to_booth(
            args.product_path,
            args.pdf,
            args.title,
            args.price,
            args.description,
            args.dry_run,
        )
    )
