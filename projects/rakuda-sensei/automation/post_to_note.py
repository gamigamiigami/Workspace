#!/usr/bin/env python3
"""
note.com 記事自動投稿スクリプト (Playwright版・完全無料)

GitHub Actions で workflow_dispatch トリガーにより実行。
NOTE_SESSION_COOKIE (GitHub Secret) で認証し、指定MarkDown記事を投稿する。

【初回セットアップ（1回のみ・人間作業5分）】
setup/cookie-setup-guide.md を参照。

【無料化の仕組み】
- Playwright: MIT License (追加課金なし)
- GitHub Actions: 無料枠内 (パブリックリポ無制限)
- note.com: セッションクッキー認証 (APIキー不要)
"""

import json
import os
import sys
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PAYWALL_MARKER = "────────── ペイウォール ──────────"


def extract_meta_from_table(text: str) -> dict:
    """記事MDの投稿メタデータ表からタイトル・価格・タグを抽出"""
    meta = {"title": "", "price": 0, "tags": []}

    title_m = re.search(r"\|\s*\*\*タイトル\*\*\s*\|\s*(.+?)\s*\|", text)
    if title_m:
        meta["title"] = title_m.group(1).strip()

    price_m = re.search(r"\|\s*\*\*価格\*\*\s*\|\s*¥?(\d+)", text)
    if price_m:
        meta["price"] = int(price_m.group(1))

    tags_m = re.search(r"推奨タグ.*?(`#[\w\s]+`)+", text)
    if tags_m:
        meta["tags"] = re.findall(r"`#([\w\s]+)`", tags_m.group(0))

    return meta


def extract_article_body(text: str) -> tuple[str, str]:
    """
    ペイウォールマーカーで本文を無料部分と有料部分に分割する。
    returns: (free_part, paid_part)
    """
    if PAYWALL_MARKER in text:
        parts = text.split(PAYWALL_MARKER, 1)
        return parts[0].strip(), parts[1].strip()

    # ペイウォールなしは全文無料
    return text.strip(), ""


def find_body_section(text: str) -> str:
    """投稿メタデータ部分（先頭のヘッダー・表）を除いた本文を返す"""
    # "---" 区切り後の最初のセクションが記事本文
    sections = text.split("---")
    # 最後のメタデータ区切り以降が本文
    # ヘッダー・メタデータ表は最初の数セクション
    body_candidates = []
    for i, section in enumerate(sections):
        # 記事本文の開始を示すH2見出しを探す
        if re.search(r"^##\s+[あ-ん]|^##\s+[ア-ン]|^##\s+\S", section, re.MULTILINE):
            if "投稿メタデータ" not in section and "サムネ" not in section:
                body_candidates.append(section.strip())

    return "\n\n---\n\n".join(body_candidates) if body_candidates else text


def post_to_note(article_path: str, dry_run: bool = False) -> int:
    cookie_json = os.environ.get("NOTE_SESSION_COOKIE")
    if not cookie_json:
        print("ERROR: NOTE_SESSION_COOKIE が設定されていません", file=sys.stderr)
        print("  → setup/cookie-setup-guide.md を参照してGitHub Secretに登録してください", file=sys.stderr)
        return 1

    try:
        cookies = json.loads(cookie_json)
    except json.JSONDecodeError as e:
        print(f"ERROR: NOTE_SESSION_COOKIE のJSON解析に失敗: {e}", file=sys.stderr)
        return 1

    md_path = ROOT / article_path
    if not md_path.exists():
        print(f"ERROR: {md_path} がありません", file=sys.stderr)
        return 1

    text = md_path.read_text(encoding="utf-8")
    meta = extract_meta_from_table(text)
    body_section = find_body_section(text)
    free_body, paid_body = extract_article_body(body_section)

    if not meta["title"]:
        # フォールバック: 最初の # 見出しをタイトルに
        m = re.search(r"^#\s+(.+)$", text, re.MULTILINE)
        meta["title"] = m.group(1).strip() if m else md_path.stem

    print(f"📄 投稿記事: {meta['title']}")
    print(f"💴 価格: ¥{meta['price']}")
    print(f"🏷 タグ: {', '.join(meta['tags'])}")
    print(f"📝 無料部分: {len(free_body)}字 / 有料部分: {len(paid_body)}字")

    if dry_run:
        print("✅ Dry run完了（実際には投稿していません）")
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
            page.goto("https://note.com/", wait_until="networkidle", timeout=30000)
            page.wait_for_timeout(2000)

            if "/login" in page.url or "login" in page.url.lower():
                print("ERROR: セッションクッキーが無効または期限切れです", file=sys.stderr)
                print("  → setup/cookie-setup-guide.md を参照してクッキーを再取得してください", file=sys.stderr)
                browser.close()
                return 1

            print("✅ ログイン確認OK")

            # 新規記事作成
            page.goto("https://note.com/notes/new", wait_until="networkidle", timeout=30000)
            page.wait_for_timeout(3000)

            # タイトル入力
            title_sel = 'textarea[placeholder], input[placeholder*="タイトル"], [data-placeholder*="タイトル"]'
            try:
                title_el = page.locator(title_sel).first
                title_el.wait_for(timeout=10000)
                title_el.click()
                title_el.fill(meta["title"])
                page.wait_for_timeout(500)
                print("✅ タイトル入力完了")
            except PWTimeout:
                print("WARNING: タイトル入力欄が見つかりませんでした。セレクタを確認してください", file=sys.stderr)

            # 本文入力（Tab で本文エリアへ移動してからペースト）
            page.keyboard.press("Tab")
            page.wait_for_timeout(500)

            # 無料部分を入力
            page.keyboard.insert_text(free_body)
            page.wait_for_timeout(500)

            # ペイウォール挿入（有料部分がある場合）
            if paid_body and meta["price"] > 0:
                page.keyboard.press("Enter")
                page.keyboard.press("Enter")
                # note のペイウォール挿入ボタンを探す
                try:
                    paywall_btn = page.locator('button[aria-label*="有料"], button:has-text("ここから先は")').first
                    paywall_btn.click(timeout=5000)
                    page.wait_for_timeout(500)
                except Exception:
                    # ペイウォールボタンが見つからない場合はプラスボタンメニューから
                    try:
                        plus_btn = page.locator('button[aria-label="ブロックを追加"], button.ProseMirror-menuitem').first
                        plus_btn.click(timeout=5000)
                        page.wait_for_timeout(300)
                        paywall_item = page.locator('button:has-text("有料"), li:has-text("有料")').first
                        paywall_item.click(timeout=5000)
                        page.wait_for_timeout(500)
                    except Exception:
                        print("WARNING: ペイウォール挿入に失敗。手動で設定してください", file=sys.stderr)

                page.keyboard.insert_text(paid_body)
                page.wait_for_timeout(500)

            print("✅ 本文入力完了")

            # 公開設定パネルを開く
            publish_btns = [
                'button:has-text("公開設定")',
                'button:has-text("投稿する")',
                '[data-testid="publish-button"]',
            ]
            for sel in publish_btns:
                try:
                    btn = page.locator(sel).first
                    btn.wait_for(timeout=5000)
                    btn.click()
                    page.wait_for_timeout(2000)
                    break
                except Exception:
                    continue

            # 価格設定（有料記事）
            if meta["price"] > 0:
                try:
                    paid_radio = page.locator('label:has-text("有料"), input[value="paid"]').first
                    paid_radio.click(timeout=5000)
                    page.wait_for_timeout(500)

                    price_input = page.locator('input[type="number"][name*="price"], input[placeholder*="価格"]').first
                    price_input.fill(str(meta["price"]), timeout=5000)
                    page.wait_for_timeout(500)
                    print(f"✅ 価格設定完了: ¥{meta['price']}")
                except Exception as e:
                    print(f"WARNING: 価格設定に失敗: {e}", file=sys.stderr)

            # タグ設定（最大5個）
            for tag in meta["tags"][:5]:
                tag = tag.strip().lstrip("#")
                if not tag:
                    continue
                try:
                    tag_input = page.locator('input[placeholder*="タグ"], [class*="tag"] input').first
                    tag_input.fill(tag, timeout=5000)
                    tag_input.press("Enter")
                    page.wait_for_timeout(300)
                except Exception:
                    pass

            # 最終投稿
            final_btns = [
                'button:has-text("投稿する")',
                'button:has-text("公開する")',
                '[data-testid="final-publish"]',
            ]
            published = False
            for sel in final_btns:
                try:
                    btn = page.locator(sel).last
                    btn.wait_for(timeout=5000)
                    btn.click()
                    page.wait_for_timeout(5000)
                    published = True
                    break
                except Exception:
                    continue

            if published:
                result_url = page.url
                print(f"✅ 投稿完了！URL: {result_url}")
            else:
                print("WARNING: 投稿ボタンが見つかりませんでした。スクリーンショットを確認してください", file=sys.stderr)
                page.screenshot(path="note-post-failed.png")
                browser.close()
                return 1

        except Exception as e:
            print(f"ERROR: 予期しないエラー: {e}", file=sys.stderr)
            try:
                page.screenshot(path="note-post-error.png")
            except Exception:
                pass
            browser.close()
            return 1

        browser.close()

    return 0


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        print("Usage: post_to_note.py <article_path_from_workspace_root> [--dry-run]", file=sys.stderr)
        sys.exit(1)

    article_path = args[0]
    dry = "--dry-run" in args
    sys.exit(post_to_note(article_path, dry))
