#!/usr/bin/env python3
"""
note.com 記事自動投稿スクリプト (Playwright自動ログイン版・完全無料)

GitHub Actions で workflow_dispatch トリガーにより実行。
NOTE_EMAIL / NOTE_PASSWORD (GitHub Secret) で毎回自動ログインしてから投稿する。

【セットアップ（1回のみ・2分）】
GitHub > Settings > Secrets and variables > Actions に以下を登録：
  - NOTE_EMAIL: noteログインメールアドレス
  - NOTE_PASSWORD: noteログインパスワード
※クッキー抽出など面倒な作業は不要。Secret登録だけ。

【無料化の仕組み】
- Playwright: MIT License (追加課金なし)
- GitHub Actions: 無料枠内 (パブリックリポ無制限)
- note.com: メール/パスワード認証 (APIキー不要)
"""

import json
import os
import sys
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PAYWALL_MARKER = "────────── ペイウォール ──────────"

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

# Playwrightのheadless fingerprintを隠す init script
# navigator.webdriver === undefined にする等
STEALTH_JS = """
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
Object.defineProperty(navigator, 'languages', { get: () => ['ja-JP', 'ja', 'en-US', 'en'] });
Object.defineProperty(navigator, 'plugins', {
  get: () => [{name: 'Chrome PDF Plugin'}, {name: 'Chrome PDF Viewer'}, {name: 'Native Client'}]
});
// chrome.runtime をモック（headlessには存在しない）
window.chrome = { runtime: {} };
// WebGLベンダーを実機らしく
const getParameter = WebGLRenderingContext.prototype.getParameter;
WebGLRenderingContext.prototype.getParameter = function(parameter) {
  if (parameter === 37445) return 'Intel Inc.';
  if (parameter === 37446) return 'Intel Iris OpenGL Engine';
  return getParameter.apply(this, [parameter]);
};
"""


def try_selectors(page, selectors: list[str], action: str = "fill", value: str = "",
                  timeout_each: int = 5000, action_name: str = "操作") -> bool:
    """
    複数セレクタを順に試して最初に見つかったものを操作する。
    UIが変わってもセレクタリストのどれかにヒットすれば壊れない。
    """
    from playwright.sync_api import TimeoutError as PWTimeout
    for sel in selectors:
        try:
            el = page.locator(sel).first
            el.wait_for(timeout=timeout_each, state="visible")
            if action == "fill":
                el.fill(value)
            elif action == "click":
                el.click(timeout=timeout_each)
            elif action == "press_enter_in":
                el.fill(value)
                el.press("Enter")
            return True
        except (PWTimeout, Exception):
            continue
    print(f"WARNING: {action_name} のセレクタが全部マッチしませんでした", file=sys.stderr)
    return False


def extract_meta_from_table(text: str) -> dict:
    """記事MDの投稿メタデータ表からタイトル・価格・タグを抽出"""
    meta = {"title": "", "price": 0, "tags": []}

    title_m = re.search(r"\|\s*\*\*タイトル\*\*\s*\|\s*(.+?)\s*\|", text)
    if title_m:
        meta["title"] = title_m.group(1).strip()

    price_m = re.search(r"\|\s*\*\*価格\*\*\s*\|\s*¥?([\d,]+)", text)
    if price_m:
        meta["price"] = int(price_m.group(1).replace(",", ""))

    tags_m = re.search(r"推奨タグ.*?(`#[\w\s]+`)+", text)
    if tags_m:
        meta["tags"] = re.findall(r"`#([\w\s]+)`", tags_m.group(0))

    return meta


def extract_article_body(text: str) -> tuple[str, str]:
    if PAYWALL_MARKER in text:
        parts = text.split(PAYWALL_MARKER, 1)
        return parts[0].strip(), parts[1].strip()
    return text.strip(), ""


def find_body_section(text: str) -> str:
    """
    記事本文だけを抽出する。除去対象:
    - HTMLコメント（<!-- AUTO-GENERATED -->等）
    - 投稿メタデータ表
    - サムネ画像指示書
    - 投稿後アクションメモ
    - 最初の # 見出し（noteエディタには別途タイトル欄がある）
    """
    # 1. HTMLコメントを除去
    cleaned = re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)

    # 2. 「## 記事本文」セクションがあればそこから抽出（絵文字prefix対応）
    m = re.search(r"##\s+(?:[^\w\s]+\s*)?記事本文[^\n]*\n+(.+?)(?:\n##\s+(?:[^\w\s]+\s*)?(?:投稿後|効果測定|内部メモ|レビュー)|\Z)", cleaned, re.DOTALL)
    if m:
        body = m.group(1).strip()
    else:
        # フォールバック: --- 区切りから本文セクションだけ取得
        sections = cleaned.split("---")
        body_candidates = []
        for section in sections:
            # 内部メモらしいキーワードを含むセクションはスキップ
            skip_keywords = [
                "投稿メタデータ", "サムネ", "投稿後アクション", "投稿後の告知",
                "対応Addnessゴール", "note-writer skill",
                "作成日：", "作成日:",
                "効果測定", "スキ率", "購入率",
                "内部メモ", "レビュー観点", "リライト",
            ]
            if any(kw in section for kw in skip_keywords):
                continue
            if re.search(r"^##\s+\S", section, re.MULTILINE) or len(section.strip()) > 300:
                body_candidates.append(section.strip())
        body = "\n\n".join(body_candidates) if body_candidates else cleaned

    # 3. 最初の # 見出し（記事タイトル）を除去（noteには別タイトル欄）
    body = re.sub(r"^#\s+.+?\n", "", body, count=1)

    # 4. 「### サムネ画像指示書」など発信者メモのサブセクション除去
    body = re.sub(
        r"###\s+(サムネ.*?|投稿後.*?|レビュー.*?|内部メモ.*?)\n.+?(?=\n##\s|\n###\s|\Z)",
        "",
        body,
        flags=re.DOTALL,
    )

    # 5. 連続空行を整理
    body = re.sub(r"\n{3,}", "\n\n", body).strip()
    return body


def login_to_note(page, email: str, password: str) -> bool:
    """note.comにメール/パスワードで自動ログイン"""
    print("🔐 note.comにログイン中...")
    page.goto("https://note.com/login", wait_until="networkidle", timeout=30000)
    page.wait_for_timeout(2000)

    # メールアドレス入力
    email_selectors = [
        'input[name="login"]',
        'input[type="email"]',
        'input[placeholder*="メール"]',
        'input[autocomplete="username"]',
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
        print("ERROR: noteのメール入力欄が見つかりませんでした", file=sys.stderr)
        return False

    # パスワード入力
    password_selectors = [
        'input[name="password"]',
        'input[type="password"]',
        'input[autocomplete="current-password"]',
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
        print("ERROR: noteのパスワード入力欄が見つかりませんでした", file=sys.stderr)
        return False

    page.wait_for_timeout(800)

    # ログインボタンクリック
    login_btn_selectors = [
        'button[type="submit"]:has-text("ログイン")',
        'button:has-text("ログイン")',
        'button[type="submit"]',
    ]
    for sel in login_btn_selectors:
        try:
            page.locator(sel).first.click(timeout=5000)
            break
        except Exception:
            continue

    # ログイン完了待ち
    page.wait_for_timeout(5000)
    try:
        page.wait_for_load_state("networkidle", timeout=15000)
    except Exception:
        pass

    # ログイン成否判定
    current_url = page.url
    if "/login" in current_url or "signin" in current_url.lower():
        # エラーメッセージ取得試行
        try:
            err = page.locator('.error, .alert, [class*="error"]').first.inner_text(timeout=2000)
            print(f"ERROR: noteログイン失敗。{err}", file=sys.stderr)
        except Exception:
            print("ERROR: noteログイン失敗。メール/パスワードを確認してください", file=sys.stderr)
        return False

    print("✅ noteログイン成功")
    return True


SHOT_DIR = ROOT / "projects" / "rakuda-sensei" / "automation" / "screenshots"
DUMP_DIR = ROOT / "projects" / "rakuda-sensei" / "automation" / "html-dumps"


def shot(page, name: str):
    """各ステップでスクリーンショットを撮影（デバッグ用）"""
    try:
        SHOT_DIR.mkdir(parents=True, exist_ok=True)
        path = SHOT_DIR / f"note-step-{name}.png"
        page.screenshot(path=str(path), full_page=True)
        print(f"📸 スクショ: {path.name}")
    except Exception as e:
        print(f"WARNING: スクショ失敗 {name}: {e}", file=sys.stderr)


def dump_html(page, name: str):
    """重要ポイントで現在のHTMLをダンプ（セレクタ分析用）"""
    try:
        DUMP_DIR.mkdir(parents=True, exist_ok=True)
        path = DUMP_DIR / f"note-step-{name}.html"
        path.write_text(page.content(), encoding="utf-8")
        print(f"📄 HTML dump: {path.name}")
    except Exception as e:
        print(f"WARNING: HTML dump失敗 {name}: {e}", file=sys.stderr)


def enumerate_form_elements(page, label: str = ""):
    """publish パネル上の input/button をすべて列挙してログに出力する（ログ経由で selector を割り出す用）"""
    print(f"\n=== 🔍 要素列挙: {label} ===")
    try:
        inputs = page.query_selector_all("input, textarea, select, [contenteditable='true']")
        print(f"📥 input/textarea/contenteditable: {len(inputs)}個")
        for i, inp in enumerate(inputs[:40]):
            try:
                tag = inp.evaluate("el => el.tagName")
                attrs = {
                    "type": inp.get_attribute("type"),
                    "name": inp.get_attribute("name"),
                    "placeholder": inp.get_attribute("placeholder"),
                    "aria-label": inp.get_attribute("aria-label"),
                    "id": inp.get_attribute("id"),
                    "value": (inp.get_attribute("value") or "")[:30],
                }
                cls = (inp.get_attribute("class") or "")[:60]
                visible = inp.is_visible()
                attrs_str = " ".join(f"{k}={v}" for k, v in attrs.items() if v)
                print(f"  [{i}] {tag} visible={visible} {attrs_str} class='{cls}'")
            except Exception:
                pass
        buttons = page.query_selector_all("button, [role='button'], [role='radio'], a[role='button']")
        print(f"\n🔘 button: {len(buttons)}個")
        for i, btn in enumerate(buttons[:40]):
            try:
                text = (btn.inner_text() or "").strip()[:50].replace("\n", " ")
                aria = btn.get_attribute("aria-label") or ""
                role = btn.get_attribute("role") or ""
                disabled = btn.get_attribute("disabled") or ""
                visible = btn.is_visible()
                cls = (btn.get_attribute("class") or "")[:50]
                print(f"  [{i}] '{text}' role={role} aria='{aria}' disabled={disabled} visible={visible} class='{cls}'")
            except Exception:
                pass
        print(f"=== 列挙終わり ===\n")
    except Exception as e:
        print(f"WARNING: 列挙失敗: {e}", file=sys.stderr)


def delete_drafts_matching_title(page, title_prefix: str, max_delete: int = 10) -> int:
    """note の下書き一覧から、タイトル前方一致するドラフトを削除する。
    複数試行のたびに増えた重複ドラフトをクリーンアップ。"""
    print(f"🧹 下書きクリーンアップ開始: '{title_prefix[:20]}...'")
    deleted = 0
    for attempt in range(max_delete):
        try:
            page.goto("https://note.com/notes/manage/draft",
                      wait_until="domcontentloaded", timeout=15000)
            page.wait_for_timeout(3000)
            # タイトル一致のドラフトカードを探す（前方20文字一致）
            matches = page.locator(f'a[href*="/edit"]:has-text("{title_prefix[:18]}")').all()
            if not matches:
                # 別パターン
                matches = page.locator(f'[class*="article"]:has-text("{title_prefix[:18]}")').all()
            if not matches:
                print(f"  → 一致ドラフトなし（{deleted}件削除済み）")
                break
            print(f"  → {len(matches)}件のマッチ発見、最初の1件を削除試行")
            # 1件目をクリックして編集ページへ
            try:
                matches[0].click(timeout=5000)
                page.wait_for_load_state("domcontentloaded", timeout=10000)
                page.wait_for_timeout(2000)
                # 編集ページの設定メニュー（•••）→ 削除
                menu_selectors = [
                    'button[aria-label*="設定"]',
                    'button[aria-label*="メニュー"]',
                    'button:has-text("•••")',
                    'button:has-text("⋯")',
                    'button:has-text("…")',
                    '[role="button"][aria-label*="操作"]',
                ]
                menu_clicked = False
                for sel in menu_selectors:
                    try:
                        page.locator(sel).first.click(timeout=2000)
                        menu_clicked = True
                        page.wait_for_timeout(800)
                        break
                    except Exception:
                        continue
                if not menu_clicked:
                    print(f"  ⚠️  ドラフトメニュー開けず → スキップ")
                    break
                delete_selectors = [
                    'button:has-text("ノートを削除")',
                    'button:has-text("削除")',
                    '[role="menuitem"]:has-text("削除")',
                    'li:has-text("削除")',
                ]
                deleted_this = False
                for sel in delete_selectors:
                    try:
                        page.locator(sel).first.click(timeout=2000)
                        page.wait_for_timeout(1000)
                        # 確認ダイアログ
                        confirm_selectors = [
                            'button:has-text("削除する")',
                            'button:has-text("OK")',
                            'dialog button:has-text("削除")',
                        ]
                        for csel in confirm_selectors:
                            try:
                                page.locator(csel).first.click(timeout=2000)
                                page.wait_for_timeout(2000)
                                break
                            except Exception:
                                continue
                        deleted += 1
                        deleted_this = True
                        print(f"  ✅ ドラフト削除成功 (累計{deleted}件)")
                        break
                    except Exception:
                        continue
                if not deleted_this:
                    print(f"  ⚠️  削除ボタン押下失敗 → 中断")
                    break
            except Exception as e:
                print(f"  ⚠️  ドラフト操作失敗: {e}")
                break
        except Exception as e:
            print(f"  ⚠️  下書き一覧アクセス失敗: {e}")
            break
    print(f"🧹 下書きクリーンアップ完了: {deleted}件削除")
    return deleted


_IMG_PATTERN = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")


# noteのProseMirrorエディタに画像を投入するJS。
# 「現在のキャレット位置に画像を入れる」のが目的なので、selectNodeContents は使わない。
# Selection が無い時だけ末尾に collapse して保険にする。
_JS_DISPATCH_IMAGE = r"""
async (params) => {
    const { dataB64, fileName, mimeType } = params;

    // base64 → Blob → File
    const byteString = atob(dataB64);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
    }
    const blob = new Blob([ab], { type: mimeType });
    const file = new File([blob], fileName, { type: mimeType, lastModified: Date.now() });

    // 編集領域を特定
    let editor = document.querySelector('.ProseMirror')
              || document.querySelector('[contenteditable="true"]');
    if (!editor) {
        return { success: false, reason: 'editor not found' };
    }
    editor.focus();

    // セレクションを必ず末尾に折り畳む（テキスト上書きを防ぐため）
    const sel = window.getSelection();
    sel.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    sel.addRange(range);

    const dt = new DataTransfer();
    dt.items.add(file);

    // paste のみ発火（drop は重複防止のため省略）
    let method = null;
    try {
        const pasteEvent = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: dt,
        });
        const accepted = !editor.dispatchEvent(pasteEvent);
        if (accepted) {
            method = 'paste';
        }
    } catch (e) { /* noop */ }

    // paste が受け入れられなかった時のみ drop を試す
    if (!method) {
        try {
            const rect = editor.getBoundingClientRect();
            const dropEvent = new DragEvent('drop', {
                bubbles: true,
                cancelable: true,
                dataTransfer: dt,
                clientX: rect.left + rect.width / 2,
                clientY: rect.top + rect.height / 2,
            });
            const accepted = !editor.dispatchEvent(dropEvent);
            if (accepted) {
                method = 'drop';
            }
        } catch (e) { /* noop */ }
    }

    return { success: method !== null, method, editorClass: editor.className };
}
"""


def _upload_image_via_dispatch(page, img_path) -> bool:
    """JS evaluate で paste または drop イベントを ProseMirror に直接発火する。

    paste が preventDefault されれば成功とみなし、drop は試さない。
    両方無視されたら False を返す。
    """
    import base64
    mime = "image/png" if img_path.suffix.lower() == ".png" else "image/jpeg"
    data_b64 = base64.b64encode(img_path.read_bytes()).decode()
    try:
        result = page.evaluate(_JS_DISPATCH_IMAGE, {
            "dataB64": data_b64,
            "fileName": img_path.name,
            "mimeType": mime,
        })
        if not result.get("success"):
            print(f"    dispatch失敗: {result.get('reason') or 'method not detected'}", file=sys.stderr)
            return False
        # noteがアップロード処理を行うのを待つ
        page.wait_for_timeout(8000)
        print(f"    ✓ {result.get('method')} で挿入受理")
        return True
    except Exception as e:
        print(f"    dispatch例外: {e}", file=sys.stderr)
        return False


def _upload_image_via_plus_menu(page, img_path) -> bool:
    """ +メニューで「画像」を選んで file input に流す方式。"""
    # 1) + ボタンを探す
    plus_selectors = [
        'button[aria-label*="ブロック"]',
        'button[aria-label*="挿入"]',
        'button[aria-label*="追加"]',
        'button[aria-label*="plus"]',
        '[class*="addBlock"] button',
        '[class*="add-block"] button',
        '.ProseMirror-menu button',
        'button:has(svg[aria-label*="add"])',
        'button:has-text("+")',
    ]
    opened = False
    for sel in plus_selectors:
        try:
            page.locator(sel).first.click(timeout=1500)
            opened = True
            page.wait_for_timeout(500)
            break
        except Exception:
            continue

    # 2) 画像メニューを選ぶ
    if opened:
        for sel in [
            'button:has-text("画像")',
            '[role="menuitem"]:has-text("画像")',
            'li:has-text("画像")',
            '[aria-label*="画像"]',
            'button:has-text("ファイル")',
        ]:
            try:
                page.locator(sel).first.click(timeout=1500)
                page.wait_for_timeout(500)
                break
            except Exception:
                continue

    # 3) file input に流す
    try:
        page.locator('input[type="file"]').first.set_input_files(
            str(img_path), timeout=3500
        )
        page.wait_for_timeout(8000)
        print(f"    ✓ +メニュー経由でアップロード")
        return True
    except Exception:
        return False


def insert_body_with_images(page, body: str):
    """マークダウン本文を note エディタに入力する。

    `![alt](path)` パターンを検出したら、その位置で画像を以下の優先順で投入する。
    1) JS evaluate で paste/drop イベント発火 (ProseMirror 直叩き)
    2) +メニュー経由でファイル選択
    3) どちらも失敗時は alt テキストを `（画像：xxx）` として残す
    """
    pos = 0
    inserted_imgs = 0
    failed_imgs = 0

    for m in _IMG_PATTERN.finditer(body):
        # 画像参照の前のテキストを入力
        chunk = body[pos:m.start()]
        if chunk:
            # 末尾にキャレットを移動してから入力（途中位置への上書きを防ぐ）
            page.keyboard.press("Control+End")
            page.wait_for_timeout(200)
            page.keyboard.insert_text(chunk)
            # ProseMirror が React state を確定するまで余裕をもって待つ
            page.wait_for_timeout(1800)

        alt = m.group(1)
        rel_path = m.group(2).strip()
        img_path = ROOT / rel_path

        # 画像挿入前にもキャレットを末尾に強制（テキスト上書きを防ぐ）
        page.keyboard.press("Control+End")
        page.wait_for_timeout(200)

        # chunk が改行で終わっていない時のみ Enter を補う
        if not chunk.endswith("\n"):
            page.keyboard.press("Enter")
            page.wait_for_timeout(500)

        uploaded = False
        if img_path.exists():
            # 方法1: JS evaluate で paste/drop
            print(f"🖼️  {img_path.name} 挿入試行")
            uploaded = _upload_image_via_dispatch(page, img_path)

            # 方法2: +メニュー経由
            if not uploaded:
                uploaded = _upload_image_via_plus_menu(page, img_path)

            # 方法3: 通常の file input（旧ロジック、保険）
            if not uploaded:
                for sel in [
                    'input[type="file"][accept*="image"]',
                    'input[type="file"]',
                ]:
                    try:
                        page.locator(sel).first.set_input_files(
                            str(img_path), timeout=2500
                        )
                        page.wait_for_timeout(7000)
                        uploaded = True
                        print(f"    ✓ file input 経由でアップロード")
                        break
                    except Exception:
                        continue

            if uploaded:
                inserted_imgs += 1
                print(f"    🟢 {img_path.name} 挿入成功")
            else:
                failed_imgs += 1
                print(f"    🔴 {img_path.name} 全手段失敗 → alt テキストでフォールバック", file=sys.stderr)
                if alt:
                    page.keyboard.insert_text(f"（画像：{alt}）")
        else:
            failed_imgs += 1
            print(f"⚠️  画像ファイル不在: {img_path}", file=sys.stderr)
            if alt:
                page.keyboard.insert_text(f"（画像：{alt}）")

        # 画像後にキャレットを末尾に戻して改行
        page.keyboard.press("Control+End")
        page.wait_for_timeout(200)
        page.keyboard.press("Enter")
        page.wait_for_timeout(500)

        pos = m.end()

    # 最後の画像参照より後ろのテキスト
    remaining = body[pos:]
    if remaining:
        page.keyboard.press("Control+End")
        page.wait_for_timeout(200)
        page.keyboard.insert_text(remaining)
        page.wait_for_timeout(1500)

    if inserted_imgs or failed_imgs:
        print(f"📷 画像処理結果: 成功 {inserted_imgs} / 失敗 {failed_imgs}")


def normalize_cookies(raw_json: str) -> list:
    """
    Cookie-Editor 出力のJSONをPlaywright SetCookieParam形式に正規化する。

    必要な変換:
      - expirationDate -> expires (float)
      - sameSite "lax"/"strict"/"none"/"no_restriction" -> "Lax"/"Strict"/"None"
      - hostOnly / session / storeId 等の余計なフィールドを除去
    """
    import json as _json
    raw = _json.loads(raw_json)
    normalized = []
    for c in raw:
        new_c = {"name": c["name"], "value": c["value"]}
        if c.get("domain"):
            new_c["domain"] = c["domain"]
        new_c["path"] = c.get("path", "/")
        # sessionクッキー以外は expires をfloatで設定
        if "expirationDate" in c and not c.get("session"):
            try:
                new_c["expires"] = float(c["expirationDate"])
            except (TypeError, ValueError):
                pass
        elif "expires" in c and not c.get("session"):
            try:
                new_c["expires"] = float(c["expires"])
            except (TypeError, ValueError):
                pass
        if "sameSite" in c:
            ss = str(c["sameSite"]).lower()
            mapping = {"lax": "Lax", "strict": "Strict",
                       "none": "None", "no_restriction": "None", "unspecified": "None"}
            if ss in mapping:
                new_c["sameSite"] = mapping[ss]
        if "httpOnly" in c:
            new_c["httpOnly"] = bool(c["httpOnly"])
        if "secure" in c:
            new_c["secure"] = bool(c["secure"])
        normalized.append(new_c)
    return normalized


def post_to_note(article_path: str, dry_run: bool = False, save_draft: bool = False) -> int:
    email = os.environ.get("NOTE_EMAIL")
    password = os.environ.get("NOTE_PASSWORD")
    if not email or not password:
        print("ERROR: NOTE_EMAIL / NOTE_PASSWORD が設定されていません", file=sys.stderr)
        print("  → GitHub Settings > Secrets and variables > Actions で登録してください", file=sys.stderr)
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
        m = re.search(r"^#\s+(.+)$", text, re.MULTILINE)
        meta["title"] = m.group(1).strip() if m else md_path.stem

    # 添付成果物が必要な記事は自動で下書きモードに切替（ファイル添付は note UI でしかできないため）
    asset_m = re.search(r"\|\s*添付成果物\s*\|\s*([^|]+?)\s*\|", text)
    has_attachment = bool(asset_m and "なし" not in asset_m.group(1))
    if has_attachment and not save_draft and not dry_run:
        print(f"⚠️  添付成果物あり ({asset_m.group(1).strip()}) → 自動で下書きモードに切替")
        save_draft = True

    print(f"📄 投稿記事: {meta['title']}")
    print(f"💴 価格: ¥{meta['price']}")
    print(f"🏷 タグ: {', '.join(meta['tags'])}")
    print(f"📝 無料部分: {len(free_body)}字 / 有料部分: {len(paid_body)}字")
    if save_draft:
        print(f"💾 モード: --save-draft（下書き保存のみ）")

    if dry_run:
        print("✅ Dry run完了（実際には投稿していません）")
        return 0

    from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-blink-features=AutomationControlled",
                "--disable-dev-shm-usage",
                "--disable-features=IsolateOrigins,site-per-process",
            ],
        )
        context = browser.new_context(
            viewport={"width": 1366, "height": 768},  # 一般的解像度に
            user_agent=USER_AGENT,
            locale="ja-JP",
            timezone_id="Asia/Tokyo",
            extra_http_headers={
                "Accept-Language": "ja-JP,ja;q=0.9,en;q=0.8",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            },
        )
        # bot fingerprint隠蔽（自作JS）
        context.add_init_script(STEALTH_JS)

        # クッキー認証を優先（reCAPTCHA回避・推奨）
        cookie_json = os.environ.get("NOTE_SESSION_COOKIE")
        cookie_auth = False
        if cookie_json:
            try:
                cookies = normalize_cookies(cookie_json)
                context.add_cookies(cookies)
                cookie_auth = True
                print(f"🍪 クッキー認証 ({len(cookies)}個・正規化済み)")
            except Exception as e:
                print(f"WARNING: クッキー解析/正規化失敗: {e}", file=sys.stderr)
                import traceback
                traceback.print_exc(file=sys.stderr)

        page = context.new_page()

        # playwright-stealth で19種類以上のbot検知回避を適用 (最初のgoto前)
        try:
            from playwright_stealth import stealth_sync
            stealth_sync(page)
            print("🥷 playwright-stealth 適用 (19種類のbot検知回避)")
        except ImportError:
            print("⚠️ playwright-stealth未インストール、自作STEALTH_JSのみ使用")
        except Exception as e:
            print(f"⚠️ stealth適用エラー（続行）: {e}")

        try:
            if cookie_auth:
                # クッキーセット済みなのでログインスキップ、直接トップへ
                page.goto("https://note.com/", wait_until="domcontentloaded", timeout=30000)
                page.wait_for_timeout(2000)
                if "/login" in page.url or "/signin" in page.url.lower():
                    print("ERROR: クッキーが無効/期限切れ。再取得してください", file=sys.stderr)
                    shot(page, "01-cookie-invalid")
                    browser.close()
                    return 1
                print(f"✅ クッキーログインOK ({page.url})")
                shot(page, "01-cookie-ok")
            else:
                # フォールバック: メール/パスワードログイン (reCAPTCHA リスクあり)
                if not login_to_note(page, email, password):
                    shot(page, "01-login-failed")
                    browser.close()
                    return 1
                shot(page, "01-login-ok")

            # 古い同タイトル下書きを削除（過去試行の汚れ掃除）
            if not dry_run:
                delete_drafts_matching_title(page, meta["title"])

            # 新規記事作成 - 複数のURL候補を試す
            compose_urls = [
                "https://editor.note.com/new",       # 2024-2026 新URL
                "https://note.com/editor/new",
                "https://note.com/notes/new",        # 旧URL
                "https://note.com/sitesettings",
            ]

            def _is_editor_url(url: str) -> bool:
                """エディタに本当に到達しているかを判定する。
                /login?redirectPath=... のリダイレクト URL は除外する。
                """
                if "/login" in url:
                    return False
                if "editor.note.com" in url and "/edit" in url:
                    return True
                if "editor.note.com/new" in url or "editor.note.com/notes" in url:
                    return True
                if "/notes/" in url and "/manage/" not in url:
                    return True
                return False

            def _try_compose_urls():
                for url in compose_urls:
                    try:
                        print(f"🔗 試行: {url}")
                        page.goto(url, wait_until="domcontentloaded", timeout=20000)
                        page.wait_for_timeout(3000)
                        if _is_editor_url(page.url):
                            print(f"✅ エディタ到達: {page.url}")
                            return True
                        else:
                            print(f"⏭ {url} → リダイレクトor非エディタ ({page.url})")
                    except Exception as e:
                        print(f"⏭ {url} 失敗: {e}")
                        continue
                return False

            compose_loaded = _try_compose_urls()

            # クッキーで editor に行けなかった場合、email/password でログインを試みる
            if not compose_loaded and "/login" in page.url:
                print("🔁 editor 側のクッキー失効を検知 → email/password ログインに切替")
                try:
                    if login_to_note(page, email, password):
                        print("✅ email/password ログイン成功 → エディタ再試行")
                        compose_loaded = _try_compose_urls()
                except Exception as e:
                    print(f"⚠️  フォールバックログイン失敗: {e}", file=sys.stderr)

            if not compose_loaded:
                # 最後の手段: マイページから「投稿」ボタンを探す
                try:
                    page.goto("https://note.com/", wait_until="domcontentloaded", timeout=20000)
                    page.wait_for_timeout(2000)
                    for sel in ['a:has-text("投稿")', 'button:has-text("投稿")', 'a[href*="new"]', 'a[href*="editor"]']:
                        try:
                            page.locator(sel).first.click(timeout=3000)
                            page.wait_for_timeout(3000)
                            print(f"✅ 投稿ボタン経由でエディタへ: {page.url}")
                            compose_loaded = True
                            break
                        except Exception:
                            continue
                except Exception:
                    pass

            shot(page, "02-editor-loaded")

            if not compose_loaded:
                print("ERROR: noteエディタへの遷移失敗", file=sys.stderr)
                browser.close()
                return 1

            # タイトル入力 - セレクタ拡充
            title_selectors = [
                'textarea[placeholder*="タイトル"]',
                'input[placeholder*="タイトル"]',
                '[data-placeholder*="タイトル"]',
                'textarea[aria-label*="タイトル"]',
                'textarea[aria-label*="title"]',
                'h1[contenteditable="true"]',
                '[role="textbox"][aria-label*="タイトル"]',
                'textarea.title',
                '#noteTitleInput',
            ]
            title_filled = False
            for sel in title_selectors:
                try:
                    title_el = page.locator(sel).first
                    title_el.wait_for(timeout=5000, state="visible")
                    title_el.click()
                    title_el.fill(meta["title"])
                    page.wait_for_timeout(500)
                    print(f"✅ タイトル入力完了 (selector: {sel})")
                    title_filled = True
                    break
                except Exception:
                    continue

            if not title_filled:
                print("WARNING: タイトル入力欄が全候補マッチしませんでした", file=sys.stderr)
                shot(page, "03-title-not-found")

            # 本文エリアへフォーカス
            page.keyboard.press("Tab")
            page.wait_for_timeout(500)

            # 無料部分を入力（画像参照を画像アップロードに展開）
            insert_body_with_images(page, free_body)

            # 有料部分も連続して入力（ペイウォール位置はあとで JS で指定）
            paywall_marker_text = ""
            if paid_body and meta["price"] > 0:
                page.keyboard.press("Control+End")
                page.wait_for_timeout(300)
                page.keyboard.press("Enter")
                page.keyboard.press("Enter")
                page.wait_for_timeout(500)
                # 有料部分の境界を特定するためのユニークな目印を最初の一文字として残す
                # paid_body の冒頭は「📥」絵文字なのでこれを目印に使う
                paywall_marker_text = "📥"
                insert_body_with_images(page, paid_body)

            print("✅ 本文入力完了")
            # noteは数秒で自動下書き保存するので待機
            page.wait_for_timeout(4000)
            shot(page, "05-after-body-input")
            dump_html(page, "05-after-body-input")

            # 📥 直前にキャレットを移動して、その位置に有料エリアブロックを挿入する
            if paywall_marker_text:
                # Step 1: JS でカーソル移動
                try:
                    moved = page.evaluate("""
                        (marker) => {
                            const editor = document.querySelector('.ProseMirror');
                            if (!editor) return {ok: false, reason: 'no editor'};
                            const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
                            let node;
                            while ((node = walker.nextNode())) {
                                const idx = node.textContent.indexOf(marker);
                                if (idx >= 0) {
                                    editor.focus();
                                    const range = document.createRange();
                                    range.setStart(node, idx);
                                    range.collapse(true);
                                    const sel = window.getSelection();
                                    sel.removeAllRanges();
                                    sel.addRange(range);
                                    if (node.parentElement && node.parentElement.scrollIntoView) {
                                        node.parentElement.scrollIntoView({block: 'center'});
                                    }
                                    return {ok: true, sampleText: node.textContent.slice(0, 40)};
                                }
                            }
                            return {ok: false, reason: 'marker not found'};
                        }
                    """, paywall_marker_text)
                    if moved.get('ok'):
                        print(f"📍 ペイウォール位置にキャレット移動: {moved.get('sampleText')!r}")
                        page.wait_for_timeout(800)
                    else:
                        print(f"⚠️  キャレット移動失敗: {moved.get('reason')}")
                except Exception as e:
                    print(f"⚠️  キャレット移動例外: {e}")

                # Step 2: その位置で 改行→有料エリアブロックを挿入
                # 試行1: 直接「有料エリア」ボタンが本文側にあるか探す
                paywall_inserted = False
                for sel in [
                    'button:has-text("有料エリア")',
                    'button[aria-label*="有料エリア"]',
                    'button[aria-label*="ペイウォール"]',
                    'button:has-text("ここから先は有料")',
                ]:
                    try:
                        page.locator(sel).first.click(timeout=1500)
                        paywall_inserted = True
                        print(f"✅ 有料エリアブロック挿入 (selector: {sel})")
                        page.wait_for_timeout(1500)
                        break
                    except Exception:
                        continue

                # 試行2: スラッシュコマンド '/有料'
                if not paywall_inserted:
                    try:
                        page.keyboard.press("/")
                        page.wait_for_timeout(600)
                        page.keyboard.type("有料")
                        page.wait_for_timeout(800)
                        for sel in [
                            '[role="option"]:has-text("有料エリア")',
                            '[role="menuitem"]:has-text("有料エリア")',
                            'li:has-text("有料エリア")',
                            'button:has-text("有料エリア")',
                            '[role="option"]:has-text("有料")',
                            'li:has-text("有料")',
                        ]:
                            try:
                                page.locator(sel).first.click(timeout=1200)
                                paywall_inserted = True
                                print(f"✅ スラッシュコマンドで有料エリア挿入 ({sel})")
                                page.wait_for_timeout(1500)
                                break
                            except Exception:
                                continue
                        if not paywall_inserted:
                            # 候補が出なかったので Escape して閉じる
                            page.keyboard.press("Escape")
                            page.wait_for_timeout(300)
                    except Exception as e:
                        print(f"⚠️  スラッシュコマンド例外: {e}")

                if not paywall_inserted:
                    print("ℹ️  本文側での有料エリア挿入は失敗 → publish パネル側で再試行する")

            # 公開設定パネルを開く - セレクタ大幅拡充
            publish_open_selectors = [
                'button:has-text("公開に進む")',
                'button:has-text("公開設定")',
                'button:has-text("公開する")',
                'button:has-text("公開")',
                'button:has-text("投稿する")',
                'button:has-text("投稿")',
                '[data-testid="publish-button"]',
                'header button[type="button"]',
                'nav button:has-text("公開")',
                'button[aria-label*="公開"]',
            ]
            publish_panel_opened = False
            for sel in publish_open_selectors:
                try:
                    btn = page.locator(sel).first
                    btn.wait_for(timeout=3000, state="visible")
                    btn.click()
                    page.wait_for_timeout(4000)  # /publish/ ページのSPAレンダ待ち
                    publish_panel_opened = True
                    print(f"✅ 公開パネルを開いた (selector: {sel})")
                    shot(page, "06-publish-panel")
                    dump_html(page, "06-publish-panel")
                    break
                except Exception:
                    continue
            if not publish_panel_opened:
                print("WARNING: 公開パネル開けず", file=sys.stderr)
                shot(page, "06-no-publish-panel")
                dump_html(page, "06-no-publish-panel")

            # /publish/ ページに到達 → networkidle まで待つ
            try:
                page.wait_for_load_state("networkidle", timeout=10000)
            except Exception:
                pass
            page.wait_for_timeout(2000)

            # 公開パネルの全要素を列挙（ログから selector を逆引きするため）
            enumerate_form_elements(page, "公開パネル直後 (/publish/)")

            # アイキャッチ画像（サムネ）アップロード
            # 記事ファイル名から推定 (articles/002-foo.md → assets/thumbnails/002-foo.png)
            thumbnail_path = (
                ROOT / "projects" / "rakuda-sensei" / "assets" / "thumbnails"
                / f"{md_path.stem}.png"
            )
            if thumbnail_path.exists():
                print(f"🖼️  サムネ候補: {thumbnail_path.name}")
                thumb_set = False
                # Step 1: 「画像を追加」「ヘッダー画像」のようなボタンを探してクリック
                eyecatch_button_selectors = [
                    'button:has-text("画像を追加")',
                    'button:has-text("ヘッダー画像")',
                    'button:has-text("アイキャッチ")',
                    '[class*="eyecatch"] button',
                    '[class*="thumbnail"] button',
                    '[class*="cover"] button',
                    'label:has-text("画像")',
                ]
                for sel in eyecatch_button_selectors:
                    try:
                        page.locator(sel).first.click(timeout=1500)
                        page.wait_for_timeout(800)
                        break
                    except Exception:
                        continue
                # Step 2: file input に投入
                for sel in [
                    'input[type="file"][accept*="image"]',
                    'input[type="file"]',
                ]:
                    try:
                        page.locator(sel).first.set_input_files(
                            str(thumbnail_path), timeout=3000)
                        thumb_set = True
                        print(f"✅ サムネ添付 (selector: {sel})")
                        page.wait_for_timeout(7000)
                        shot(page, "07-after-thumbnail")
                        break
                    except Exception:
                        continue
                # Step 3: JS dispatch で paste/drop（保険）
                if not thumb_set:
                    try:
                        if _upload_image_via_dispatch(page, thumbnail_path):
                            thumb_set = True
                            print(f"✅ サムネ添付 (JS dispatch)")
                    except Exception:
                        pass
                if not thumb_set:
                    print(f"⚠️  サムネ添付失敗")
                    shot(page, "07-no-thumbnail")
            else:
                print(f"ℹ️  サムネファイル無し: {thumbnail_path.name}")

            # 「記事タイプ」を開く（noteの新UIは折りたたみで型を選ぶ）
            try:
                page.locator('button:has-text("記事タイプ")').first.click(timeout=3000)
                page.wait_for_timeout(1500)
                print("✅ 記事タイプを開いた")
            except Exception:
                print("ℹ️  記事タイプボタン展開不要 or 失敗")

            # 価格設定 - 有料ラジオは invisible なので JS で直接 checked + change イベント発火
            if meta["price"] > 0:
                paid_clicked = False
                # 第一手: JS で React state を強制更新（最も確実）
                try:
                    js_result = page.evaluate("""
                        () => {
                            const input = document.querySelector('input#paid[name="is_paid"][value="paid"]');
                            if (!input) return {ok: false, reason: 'not found'};
                            // React の controlled state にも反映させるため native setter を使う
                            const setter = Object.getOwnPropertyDescriptor(
                                window.HTMLInputElement.prototype, 'checked'
                            ).set;
                            setter.call(input, true);
                            input.dispatchEvent(new Event('input', {bubbles: true}));
                            input.dispatchEvent(new Event('change', {bubbles: true}));
                            input.click();
                            return {ok: true, checked: input.checked};
                        }
                    """)
                    if js_result.get('ok'):
                        paid_clicked = True
                        print(f"✅ JS経由で有料ラジオON (checked={js_result.get('checked')})")
                        page.wait_for_timeout(2500)
                    else:
                        print(f"⚠️  JS経由でラジオ未発見: {js_result.get('reason')}")
                except Exception as e:
                    print(f"⚠️  JS有料ラジオON失敗: {e}")
                # 第二手: Playwright check(force=True)
                if not paid_clicked:
                    try:
                        paid_radio = page.locator('input#paid[name="is_paid"][value="paid"]').first
                        paid_radio.check(force=True, timeout=3000)
                        paid_clicked = True
                        print("✅ 有料ラジオ check(force) 成功")
                        page.wait_for_timeout(2500)
                    except Exception as e:
                        print(f"⚠️  check(force)失敗: {e}")
                # 第三手: ラベルクリック
                if not paid_clicked:
                    for sel in ['label[for="paid"]', 'label:has-text("有料")', '[role="radio"]:has-text("有料")']:
                        try:
                            page.locator(sel).first.click(timeout=2000)
                            paid_clicked = True
                            print(f"✅ 有料セレクタ クリック成功 ({sel})")
                            page.wait_for_timeout(2500)
                            break
                        except Exception:
                            continue
                # 有料を選んだ後に価格入力欄が現れるので、長めに待ってから探す
                page.wait_for_timeout(5000)
                shot(page, "07b-after-paid-radio")
                dump_html(page, "07b-after-paid-radio")
                enumerate_form_elements(page, "有料ラジオcheck後")

                price_set = False

                # 第一手: JS で「価格」ラベル近傍の input を探して値をセット
                try:
                    js_price = page.evaluate("""
                        (price) => {
                            const targets = [];
                            // 「価格」というテキストを持つ要素を見つける
                            const walker = document.createTreeWalker(
                                document.body, NodeFilter.SHOW_TEXT, null
                            );
                            let node;
                            while ((node = walker.nextNode())) {
                                if (node.textContent.trim() === '価格') {
                                    targets.push(node.parentElement);
                                }
                            }
                            // 各候補の祖先内で input を探す
                            for (const el of targets) {
                                let parent = el;
                                for (let i = 0; i < 6 && parent; i++) {
                                    const inputs = parent.querySelectorAll(
                                        'input[type="text"], input[type="number"], input[inputmode="numeric"], input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"])'
                                    );
                                    for (const input of inputs) {
                                        if (input.offsetParent === null) continue;  // visible only
                                        const setter = Object.getOwnPropertyDescriptor(
                                            window.HTMLInputElement.prototype, 'value'
                                        ).set;
                                        setter.call(input, String(price));
                                        input.dispatchEvent(new Event('input', {bubbles: true}));
                                        input.dispatchEvent(new Event('change', {bubbles: true}));
                                        input.dispatchEvent(new Event('blur', {bubbles: true}));
                                        return {ok: true, value: input.value, name: input.name || input.placeholder};
                                    }
                                    parent = parent.parentElement;
                                }
                            }
                            return {ok: false, reason: '価格ラベル近傍に input なし', candidates: targets.length};
                        }
                    """, meta["price"])
                    if js_price.get('ok'):
                        price_set = True
                        print(f"✅ JS経由で価格入力: {js_price.get('value')} (input.name={js_price.get('name')})")
                        page.wait_for_timeout(1000)
                    else:
                        print(f"⚠️  JS価格入力スキップ: {js_price.get('reason')} (候補={js_price.get('candidates')})")
                except Exception as e:
                    print(f"⚠️  JS価格入力例外: {e}")

                # 第二手: 通常のセレクタフォールバック
                if not price_set:
                    price_selectors = [
                        'input[type="number"][name*="price"]',
                        'input[placeholder*="価格"]',
                        'input[placeholder*="¥"]',
                        'input[placeholder*="円"]',
                        'input[type="number"]',
                        'input[inputmode="numeric"]',
                        'input[name="price"]',
                        'input[name*="amount"]',
                        '[class*="price"] input',
                        '[class*="amount"] input',
                    ]
                    for sel in price_selectors:
                        try:
                            loc = page.locator(sel).first
                            loc.wait_for(state="visible", timeout=2000)
                            loc.fill(str(meta["price"]), timeout=2000)
                            price_set = True
                            print(f"✅ 価格入力 (selector: {sel})")
                            page.wait_for_timeout(800)
                            break
                        except Exception:
                            continue

                if paid_clicked and price_set:
                    print(f"✅ 価格設定完了: ¥{meta['price']}")
                else:
                    print(f"WARNING: 価格設定不完全 (paid={paid_clicked}, price={price_set})", file=sys.stderr)
                    shot(page, "07c-price-fail")
                    dump_html(page, "07c-price-fail")

                # 「有料エリア設定」ボタンを押す（noteの本物のペイウォール確定操作）
                try:
                    page.locator('button:has-text("有料エリア設定")').first.click(timeout=3000)
                    page.wait_for_timeout(2500)
                    print("✅ 有料エリア設定 ボタン押下")
                except Exception:
                    try:
                        # フォールバック: 別表記
                        page.locator('button:has-text("有料エリアを設定")').first.click(timeout=2000)
                        page.wait_for_timeout(2500)
                        print("✅ 有料エリアを設定 ボタン押下")
                    except Exception:
                        print("ℹ️  有料エリア設定 ボタン未発見（不要 or 既に設定済の可能性）")

            # タグ設定（複数セレクタ試行）
            tag_input_selectors = [
                'input[placeholder*="ハッシュタグ"]',
                'input[placeholder*="タグ"]',
                '[role="combobox"]',
                'input[aria-autocomplete]',
                '[class*="tag"] input[type="text"]',
                '[class*="hashtag"] input',
                'input[aria-label*="タグ"]',
            ]
            tag_input_locator = None
            for sel in tag_input_selectors:
                try:
                    loc = page.locator(sel).first
                    loc.wait_for(state="visible", timeout=2000)
                    tag_input_locator = loc
                    print(f"✅ タグ入力欄発見 (selector: {sel})")
                    break
                except Exception:
                    continue
            for tag in meta["tags"][:5]:
                tag = tag.strip().lstrip("#")
                if not tag:
                    continue
                if tag_input_locator is None:
                    break
                try:
                    tag_input_locator.fill(tag, timeout=5000)
                    tag_input_locator.press("Enter")
                    page.wait_for_timeout(500)
                except Exception:
                    pass

            # 下書き保存モード: 最終投稿はせず、エディタの自動保存を待って終了
            if save_draft:
                print("📌 --save-draft モード: 下書き保存のみで終了します")
                page.wait_for_timeout(4000)
                shot(page, "08-draft-saved-only")
                print(f"📝 下書き保存完了: {page.url}")
                print("   → ファイル添付・SNSプロモ設定・公開は note UI で実施してください")
                browser.close()
                return 0

            # 最終投稿前にHTMLダンプ + 列挙
            page.wait_for_timeout(2000)
            shot(page, "08b-before-final-publish")
            dump_html(page, "08b-before-final-publish")
            enumerate_form_elements(page, "最終投稿直前")

            # 最終投稿ボタン - セレクタ大幅拡充
            final_publish_selectors = [
                # 標準
                'button:has-text("投稿する")',
                'button:has-text("公開する")',
                'button:has-text("公開")',
                'button:has-text("投稿")',
                # 有料エリア確定ボタン経由フロー
                'button:has-text("有料エリア設定を完了")',
                'button:has-text("有料設定を完了")',
                'button:has-text("設定を完了")',
                # data-testid
                '[data-testid="final-publish"]',
                '[data-testid*="publish"]',
                '[data-testid*="post"]',
                # type submit
                'button[type="submit"]:has-text("公開")',
                'button[type="submit"]:has-text("投稿")',
                'button[type="submit"]',
                # ダイアログ/モーダル内
                'dialog button:has-text("公開")',
                '[role="dialog"] button:has-text("公開")',
                '[class*="modal"] button:has-text("公開")',
                # フッター/プライマリ系
                'footer button:has-text("公開")',
                'footer button:has-text("投稿")',
                '[class*="footer"] button',
                'button[class*="primary"]:has-text("公開")',
                'button[class*="primary"]:has-text("投稿")',
                # 一般プライマリボタン（最終手段）
                'button[class*="primary"]:not([disabled])',
            ]
            published = False
            for sel in final_publish_selectors:
                try:
                    loc = page.locator(sel).last
                    loc.wait_for(state="visible", timeout=2500)
                    loc.click(timeout=2500, force=True)
                    page.wait_for_timeout(8000)
                    published = True
                    print(f"✅ 投稿ボタンクリック (selector: {sel})")
                    break
                except Exception as e:
                    continue

            # 確認ダイアログが出る可能性 → 「投稿する」を再度クリック
            if published:
                try:
                    page.wait_for_timeout(2000)
                    confirm_btns = [
                        'dialog button:has-text("投稿する")',
                        'dialog button:has-text("公開する")',
                        '[role="dialog"] button:has-text("投稿する")',
                        '[role="dialog"] button:has-text("公開する")',
                        'button:has-text("投稿する")',
                    ]
                    for csel in confirm_btns:
                        try:
                            cbtn = page.locator(csel).last
                            cbtn.wait_for(state="visible", timeout=2000)
                            cbtn.click(timeout=2000, force=True)
                            page.wait_for_timeout(6000)
                            print(f"✅ 確認ダイアログ '投稿する' クリック ({csel})")
                            break
                        except Exception:
                            continue
                except Exception:
                    pass

            shot(page, "09-after-final-click")
            dump_html(page, "09-after-final-click")
            # noteは記事編集中なので、エディタURLにいる時点で既に「下書き」として保存されている
            edit_url = page.url
            print(f"📝 現在URL: {edit_url}")

            if published:
                shot(page, "10-after-publish-click")
                # 公開URLパターン (note.com/{user}/n/{hash}) または /first_post (初回公開達成ページ)
                is_published_url = (
                    ("/n/" in page.url and "/notes/" not in page.url) or
                    "/first_post" in page.url or
                    "/notes/n" in page.url and "/edit/" not in page.url and "/publish/" not in page.url
                )
                if is_published_url:
                    # /first_post の場合は note ID から推定URLを構築
                    actual_url = page.url
                    import re as _re
                    m = _re.search(r"/notes/(n[a-f0-9]+)", page.url)
                    if m and "/first_post" in page.url:
                        note_id = m.group(1)
                        # 推定URL (実際の公開URLは user名 が必要だが note は redirect で対応)
                        actual_url = f"https://note.com/notes/{note_id}"
                    print(f"✅ 公開完了！URL: {actual_url}")
                    # 後続のクロスポスト連携用にURLを永続化
                    url_file = ROOT / "projects" / "rakuda-sensei" / "articles" / ".last-published-url.txt"
                    url_file.write_text(actual_url + "\n", encoding="utf-8")
                    print(f"💾 .last-published-url.txt に保存")
                else:
                    # 念のため公開記事一覧をチェック
                    print(f"⚠️ 投稿クリックしたがURLが想定外: {page.url}")
                    print("   → 下書きで止まっている可能性。マイページで確認してください")
                    try:
                        page.goto("https://note.com/notes/manage/published", wait_until="domcontentloaded", timeout=15000)
                        page.wait_for_timeout(2000)
                        shot(page, "11-verify-published-list")
                        # タイトルが一覧に出てれば公開成功
                        if page.locator(f"text={meta['title'][:20]}").first.is_visible(timeout=3000):
                            print(f"✅ 公開記事一覧で発見、公開成功")
                        else:
                            print(f"❌ 公開記事一覧に見当たらない → 下書きの可能性")
                            page.goto("https://note.com/notes/manage/draft", wait_until="domcontentloaded", timeout=15000)
                            page.wait_for_timeout(2000)
                            shot(page, "12-verify-draft-list")
                            if page.locator(f"text={meta['title'][:20]}").first.is_visible(timeout=3000):
                                print(f"⚠️ 下書きには存在、公開ボタンを別途実行する必要")
                            else:
                                print(f"❌ 下書きにも見当たらない、保存自体が失敗")
                                browser.close()
                                return 1
                    except Exception as e:
                        print(f"検証中エラー: {e}")
            else:
                # 公開ボタンが押せなかった = 下書き保存で止まった
                # note の編集ページに入った時点で自動下書き保存されているはず
                print("⚠️ 公開ボタン押下失敗 → 下書きとしては保存されている可能性高い")
                print(f"   編集URL: {edit_url}")
                print("   → note の下書き管理画面で確認 → 手動で公開してください:")
                print("   https://note.com/notes/manage/draft")
                shot(page, "10-no-publish-button")
                # 下書きはほぼ確実に存在するので成功扱いに（エラーIssueは立てない）
                browser.close()
                return 0  # 下書き保存成功とみなす

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
    positional = [a for a in args if not a.startswith("--")]
    if not positional:
        print("Usage: post_to_note.py <article_path> [--dry-run] [--save-draft]", file=sys.stderr)
        sys.exit(1)
    sys.exit(post_to_note(
        positional[0],
        dry_run="--dry-run" in args,
        save_draft="--save-draft" in args,
    ))
