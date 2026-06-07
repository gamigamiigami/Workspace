#!/usr/bin/env python3
"""
既存の公開済み note 記事に対して SNSプロモーション設定だけを更新するスクリプト。

post_to_note.py を再実行すると新規記事になってしまうので、
このスクリプトでは既存記事の編集 URL に直接入って SNSプロモ設定のみ更新する。

使い方:
    python3 update_sns_promo.py <article_md_path> <published_url>

例:
    python3 update_sns_promo.py \
        projects/rakuda-sensei/articles/002-side-fire-sheet.md \
        https://note.com/large_pika8608/n/n3ceca55fdd43

article_md_path から拡散RT文・拡散割引価格を読み取り、
published_url から note ID を抽出して editor.note.com の編集ページへ。
"""

import os
import sys
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from post_to_note import (
    extract_meta_from_table,
    normalize_cookies,
    USER_AGENT,
    STEALTH_JS,
)


def update_sns_promo(article_md_path: str, published_url: str) -> int:
    md_path = ROOT / article_md_path
    if not md_path.exists():
        print(f"ERROR: {md_path} がありません", file=sys.stderr)
        return 1

    text = md_path.read_text(encoding="utf-8")
    meta = extract_meta_from_table(text)
    share_discount = meta.get("share_discount") or 0
    rt_message = meta.get("rt_message") or ""

    if share_discount <= 0 or not rt_message:
        print(f"ERROR: 拡散RT文 / 拡散割引価格 が記事メタに無い (discount={share_discount}, rt={len(rt_message)}字)", file=sys.stderr)
        return 1

    # published_url から note ID を抽出
    m = re.search(r"/n/([a-z0-9]+)", published_url)
    if not m:
        print(f"ERROR: published_url から note ID 抽出失敗: {published_url}", file=sys.stderr)
        return 1
    note_id = m.group(1)
    editor_url = f"https://editor.note.com/notes/{note_id}/edit/"
    publish_url = f"https://editor.note.com/notes/{note_id}/publish/"

    print(f"📝 対象記事: {meta['title']}")
    print(f"🔗 note ID: {note_id}")
    print(f"🔗 editor: {editor_url}")
    print(f"💰 設定値: ¥{share_discount} / RT文 {len(rt_message)}字")

    from playwright.sync_api import sync_playwright

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
        )
        context.add_init_script(STEALTH_JS)

        # クッキー認証
        cookie_json = os.environ.get("NOTE_SESSION_COOKIE")
        if not cookie_json:
            print("ERROR: NOTE_SESSION_COOKIE が未設定", file=sys.stderr)
            browser.close()
            return 1
        try:
            cookies = normalize_cookies(cookie_json)
            context.add_cookies(cookies)
            print(f"🍪 クッキー認証 ({len(cookies)}個)")
        except Exception as e:
            print(f"ERROR: クッキー解析失敗: {e}", file=sys.stderr)
            browser.close()
            return 1

        page = context.new_page()

        def _on_console(msg):
            if msg.type in ("error", "warning"):
                text_ = msg.text[:200] if hasattr(msg, "text") else str(msg)[:200]
                print(f"   🌐 browser-{msg.type}: {text_}", file=sys.stderr)

        page.on("console", _on_console)

        try:
            from playwright_stealth import stealth_sync
            stealth_sync(page)
        except Exception:
            pass

        try:
            # /publish/ に直接 goto
            print(f"🚀 publish パネル直接 goto: {publish_url}")
            page.goto(publish_url, wait_until="domcontentloaded", timeout=30000)
            try:
                page.wait_for_load_state("networkidle", timeout=10000)
            except Exception:
                pass
            page.wait_for_timeout(5000)

            # ハッシュタグ要素が出るか確認
            try:
                page.locator('input[placeholder*="ハッシュタグ"]').first.wait_for(
                    state="visible", timeout=8000
                )
                print(f"✅ publish パネル到達 (現URL: {page.url})")
            except Exception:
                # /edit/ → 「公開に進む」経由
                print(f"⚠️  /publish/ 直接 goto 失敗 → /edit/ 経由でリトライ")
                page.goto(editor_url, wait_until="domcontentloaded", timeout=30000)
                page.wait_for_timeout(5000)
                # AIアシスタント閉じる
                try:
                    page.evaluate("""
                        () => {
                            const buttons = Array.from(document.querySelectorAll('button'));
                            const aiAnchors = buttons.filter(b => /会話をやりなおす|誤字、表記揺れを修正/.test((b.textContent || '').trim()));
                            if (aiAnchors.length === 0) return;
                            let root = aiAnchors[0];
                            for (let i = 0; i < 8 && root; i++) {
                                if (aiAnchors.every(a => root.contains(a))) break;
                                root = root.parentElement;
                            }
                            if (!root) return;
                            const closeBtn = Array.from(root.querySelectorAll('button')).find(
                                b => (b.textContent || '').trim() === '閉じる'
                            );
                            if (closeBtn) closeBtn.click();
                        }
                    """)
                    page.wait_for_timeout(1000)
                except Exception:
                    pass
                # 「公開に進む」クリック
                page.locator('button:has-text("公開に進む")').first.click()
                try:
                    page.wait_for_url(re.compile(r"/publish/"), timeout=10000)
                except Exception:
                    pass
                page.wait_for_timeout(4000)
                print(f"✅ 公開パネル到達 (URL: {page.url})")

            # ページ最下部までスクロール
            page.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
            page.wait_for_timeout(1000)

            # セール section 展開
            try:
                js_open = page.evaluate(
                    """
                    () => {
                        const walker = document.createTreeWalker(
                            document.body, NodeFilter.SHOW_TEXT, null
                        );
                        let node;
                        const candidates = [];
                        while ((node = walker.nextNode())) {
                            const t = (node.textContent || '').trim();
                            if (t === 'セール' || t === 'セール設定') {
                                let el = node.parentElement;
                                for (let i = 0; i < 5 && el; i++) {
                                    if (el.tagName === 'BUTTON' || el.tagName === 'SUMMARY' || el.getAttribute('role') === 'button') {
                                        candidates.push(el);
                                        break;
                                    }
                                    el = el.parentElement;
                                }
                            }
                        }
                        if (candidates.length === 0) return {ok: false, reason: 'no セール clickable'};
                        const target = candidates[0];
                        target.scrollIntoView({block: 'center'});
                        const isExpanded = document.querySelector('input[type="radio"][name="sale_setting"][value="twitter_retweet"]') !== null;
                        if (!isExpanded) target.click();
                        return {ok: true, already: isExpanded, text: (target.textContent || '').trim().slice(0, 30)};
                    }
                    """
                )
                if js_open.get("ok"):
                    print(f"   セール section: {'既展開' if js_open.get('already') else '展開'}")
                    page.wait_for_timeout(1500)
                else:
                    print(f"   ⚠️  セール section 検出失敗: {js_open.get('reason')}")
            except Exception as e:
                print(f"   ⚠️  セール section 例外: {e}")

            # radio が DOM に出るまで wait
            try:
                page.wait_for_selector(
                    'input[type="radio"][name="sale_setting"][value="twitter_retweet"]',
                    state="attached",
                    timeout=8000,
                )
                print("   ✓ sale_setting radio DOM 出現")
            except Exception:
                print("   ⚠️  radio 不出現 → 強制リトライ")
                for sel in ['button:has-text("セール")', '[aria-label*="セール"]']:
                    try:
                        page.locator(sel).first.click(timeout=1500, force=True)
                        page.wait_for_timeout(2000)
                        break
                    except Exception:
                        continue

            # SNSプロモ radio ON
            try:
                js_promo = page.evaluate(
                    """
                    () => {
                        const radio = document.querySelector('input[type="radio"][name="sale_setting"][value="twitter_retweet"]');
                        if (!radio) return {ok: false, reason: 'radio not in DOM'};
                        radio.scrollIntoView({block: 'center'});
                        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked').set;
                        setter.call(radio, true);
                        radio.dispatchEvent(new Event('input', {bubbles: true}));
                        radio.dispatchEvent(new Event('change', {bubbles: true}));
                        const label = document.querySelector('label[for="' + radio.id + '"]');
                        if (label) label.click();
                        else radio.click();
                        return {ok: true, checked: radio.checked};
                    }
                    """
                )
                if js_promo.get("ok"):
                    print(f"   ✅ SNSプロモ radio ON (checked={js_promo.get('checked')})")
                    page.wait_for_timeout(2500)
                else:
                    print(f"   ❌ SNSプロモ radio 失敗: {js_promo.get('reason')}", file=sys.stderr)
                    browser.close()
                    return 1
            except Exception as e:
                print(f"   ❌ SNSプロモ radio 例外: {e}", file=sys.stderr)
                browser.close()
                return 1

            # RT文 textarea
            try:
                js_rt = page.evaluate(
                    """
                    (msg) => {
                        const tas = Array.from(document.querySelectorAll('textarea'));
                        const visible = tas.filter(t => t.offsetParent !== null && !(t.placeholder || '').match(/AI|タイトル/));
                        if (visible.length === 0) return {ok: false};
                        const ta = visible[visible.length - 1];
                        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
                        setter.call(ta, msg);
                        ta.dispatchEvent(new Event('input', {bubbles: true}));
                        ta.dispatchEvent(new Event('change', {bubbles: true}));
                        return {ok: true, len: msg.length};
                    }
                    """,
                    rt_message,
                )
                if js_rt.get("ok"):
                    print(f"   ✅ RT文 入力 ({js_rt.get('len')}字)")
                else:
                    print(f"   ⚠️  RT文 textarea 未発見")
            except Exception as e:
                print(f"   ⚠️  RT文 例外: {e}")

            # 割引価格
            discount_set = False
            for sel in [
                'input#discountedPrice',
                'input[name="discountedPrice"]',
            ]:
                try:
                    page.locator(sel).first.fill(str(share_discount), timeout=2000)
                    discount_set = True
                    print(f"   ✅ 割引価格 ¥{share_discount} 設定 ({sel})")
                    break
                except Exception:
                    continue
            if not discount_set:
                try:
                    js_d = page.evaluate(
                        """
                        (discount) => {
                            const inp = document.querySelector('input#discountedPrice, input[name="discountedPrice"]');
                            if (!inp) return {ok: false};
                            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                            setter.call(inp, String(discount));
                            inp.dispatchEvent(new Event('input', {bubbles: true}));
                            inp.dispatchEvent(new Event('change', {bubbles: true}));
                            inp.dispatchEvent(new Event('blur', {bubbles: true}));
                            return {ok: true, value: inp.value};
                        }
                        """,
                        share_discount,
                    )
                    if js_d.get("ok"):
                        discount_set = True
                        print(f"   ✅ 割引価格 設定 (JS, value={js_d.get('value')})")
                except Exception as e:
                    print(f"   ⚠️  割引価格 JS例外: {e}")

            page.wait_for_timeout(2000)

            # 「更新する」ボタン (公開済み記事の場合は 投稿する ではなく 更新する)
            updated = False
            for sel in [
                'button:has-text("更新する")',
                'button:has-text("投稿する")',
                'button:has-text("公開する")',
            ]:
                try:
                    btn = page.locator(sel).last
                    btn.wait_for(state="visible", timeout=3000)
                    btn.click(timeout=3000, force=True)
                    page.wait_for_timeout(7000)
                    updated = True
                    print(f"✅ 更新ボタンクリック ({sel})")
                    break
                except Exception:
                    continue

            # 確認ダイアログ
            if updated:
                for csel in [
                    'dialog button:has-text("更新する")',
                    'dialog button:has-text("投稿する")',
                    '[role="dialog"] button:has-text("更新する")',
                    'button:has-text("更新する")',
                ]:
                    try:
                        cbtn = page.locator(csel).last
                        cbtn.wait_for(state="visible", timeout=2000)
                        cbtn.click(timeout=2000, force=True)
                        page.wait_for_timeout(5000)
                        print(f"✅ 確認ダイアログ クリック ({csel})")
                        break
                    except Exception:
                        continue

            page.wait_for_timeout(3000)
            print(f"📝 最終URL: {page.url}")
            print(f"🎉 SNSプロモ設定 更新完了")
            browser.close()
            return 0

        except Exception as e:
            print(f"ERROR: 例外: {e}", file=sys.stderr)
            try:
                page.screenshot(path="update-sns-promo-error.png")
            except Exception:
                pass
            browser.close()
            return 1


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: update_sns_promo.py <article_md_path> <published_url>", file=sys.stderr)
        sys.exit(1)
    sys.exit(update_sns_promo(sys.argv[1], sys.argv[2]))
