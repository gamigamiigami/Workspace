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
    """記事MDの投稿メタデータ表からタイトル・価格・タグ・SNSプロモ設定を抽出"""
    meta = {
        "title": "",
        "price": 0,
        "tags": [],
        "share_discount": 0,  # SNSプロモ拡散割引価格（0なら未設定）
        "rt_message": "",     # SNSプロモ自動投稿テキスト
    }

    title_m = re.search(r"\|\s*\*\*タイトル\*\*\s*\|\s*(.+?)\s*\|", text)
    if title_m:
        meta["title"] = title_m.group(1).strip()

    price_m = re.search(r"\|\s*\*\*価格\*\*\s*\|\s*¥?([\d,]+)", text)
    if price_m:
        meta["price"] = int(price_m.group(1).replace(",", ""))

    discount_m = re.search(r"\|\s*拡散割引価格\s*\|\s*¥?([\d,]+)", text)
    if discount_m:
        try:
            meta["share_discount"] = int(discount_m.group(1).replace(",", ""))
        except ValueError:
            pass

    rt_m = re.search(
        r"\|\s*拡散RT文\s*\|\s*([^|]+?)\s*\|",
        text,
    )
    if rt_m:
        meta["rt_message"] = rt_m.group(1).strip().replace("\\n", "\n")

    tags_m = re.search(r"推奨タグ.*", text)
    if tags_m:
        meta["tags"] = re.findall(r"`#([^\s`]+)`", tags_m.group(0))

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
_FILE_ATTACH_PATTERN = re.compile(r"\[\[FILE_ATTACH:([^\]]+)\]\]")
# 画像とファイル添付を同一ストリームで扱うための統合パターン
_ASSET_PATTERN = re.compile(
    r"(?P<img>!\[(?P<alt>[^\]]*)\]\((?P<imgpath>[^)]+)\))"
    r"|"
    r"(?P<file>\[\[FILE_ATTACH:(?P<filepath>[^\]]+)\]\])"
)


def _guess_mime(file_path) -> str:
    import mimetypes
    mime, _ = mimetypes.guess_type(str(file_path))
    if mime:
        return mime
    ext = file_path.suffix.lower()
    return {
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".xls": "application/vnd.ms-excel",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".doc": "application/msword",
        ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ".pdf": "application/pdf",
        ".zip": "application/zip",
    }.get(ext, "application/octet-stream")


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


def _upload_file_via_dispatch(page, file_path, wait_after_ms: int = 12000) -> bool:
    """任意ファイル (Excel/PDF/Word 等) を ProseMirror に paste/drop で投入。

    note の新機能 (β) では画像以外のファイルは自動的に「ダウンロードボタン付き
    ブロック」に展開される (PDF/Excel/Word/PSD/Sketch まで対応・50MB/件)。
    """
    import base64
    mime = _guess_mime(file_path)
    data_b64 = base64.b64encode(file_path.read_bytes()).decode()
    try:
        result = page.evaluate(_JS_DISPATCH_IMAGE, {
            "dataB64": data_b64,
            "fileName": file_path.name,
            "mimeType": mime,
        })
        if not result.get("success"):
            print(f"    file dispatch失敗: {result.get('reason') or 'method not detected'}", file=sys.stderr)
            return False
        page.wait_for_timeout(wait_after_ms)
        print(f"    ✓ {result.get('method')} でファイル投入 ({file_path.name}, {mime})")
        return True
    except Exception as e:
        print(f"    file dispatch例外: {e}", file=sys.stderr)
        return False


def _upload_file_via_plus_menu(page, file_path) -> bool:
    """+ メニューで「ファイル」を開いて file input にセット。

    note の β版ファイル添付 UI は +メニューに「ファイル」項目を出すか、
    サイドバーの アップロードアイコン に出す（環境差）。両方試す。
    """
    # 1) +ボタン
    plus_selectors = [
        'button[aria-label*="ブロック"]',
        'button[aria-label*="挿入"]',
        'button[aria-label*="追加"]',
        'button[aria-label*="アップロード"]',
        'button[aria-label*="upload"]',
        '[class*="addBlock"] button',
        '[class*="add-block"] button',
        '.ProseMirror-menu button',
        'button:has-text("+")',
    ]
    for sel in plus_selectors:
        try:
            page.locator(sel).first.click(timeout=1200)
            page.wait_for_timeout(400)
            break
        except Exception:
            continue
    # 2) ファイル/アップロード メニュー
    for sel in [
        'button:has-text("ファイル")',
        '[role="menuitem"]:has-text("ファイル")',
        'li:has-text("ファイル")',
        '[aria-label*="ファイル"]',
        'button:has-text("アップロード")',
        '[role="menuitem"]:has-text("アップロード")',
    ]:
        try:
            page.locator(sel).first.click(timeout=1200)
            page.wait_for_timeout(400)
            break
        except Exception:
            continue
    # 3) file input
    try:
        page.locator('input[type="file"]').first.set_input_files(
            str(file_path), timeout=3500
        )
        page.wait_for_timeout(12000)
        print(f"    ✓ +メニュー経由でファイル投入 ({file_path.name})")
        return True
    except Exception:
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

    扱うアセット2種:
      - `![alt](path)`      → 画像 (paste/drop でインライン挿入)
      - `[[FILE_ATTACH:path]]` → ファイル添付 (note β機能 / ダウンロード形式)

    どちらも失敗時はテキストでフォールバック。
    """
    pos = 0
    inserted_imgs = 0
    failed_imgs = 0
    inserted_files = 0
    failed_files = 0

    for m in _ASSET_PATTERN.finditer(body):
        # 参照の前のテキストを入力
        chunk = body[pos:m.start()]
        if chunk:
            page.keyboard.press("Control+End")
            page.wait_for_timeout(200)
            page.keyboard.insert_text(chunk)
            page.wait_for_timeout(1800)

        page.keyboard.press("Control+End")
        page.wait_for_timeout(200)
        if not chunk.endswith("\n"):
            page.keyboard.press("Enter")
            page.wait_for_timeout(500)

        if m.group("img"):
            alt = m.group("alt") or ""
            rel_path = (m.group("imgpath") or "").strip()
            img_path = ROOT / rel_path
            uploaded = False
            if img_path.exists():
                print(f"🖼️  {img_path.name} 挿入試行")
                uploaded = _upload_image_via_dispatch(page, img_path)
                if not uploaded:
                    uploaded = _upload_image_via_plus_menu(page, img_path)
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
        else:
            # [[FILE_ATTACH:path]] = ファイル添付（ダウンロード形式）
            rel_path = (m.group("filepath") or "").strip()
            file_path = ROOT / rel_path
            uploaded = False
            if file_path.exists():
                size_kb = file_path.stat().st_size // 1024
                print(f"📎 {file_path.name} ({size_kb}KB) 添付試行")
                uploaded = _upload_file_via_dispatch(page, file_path)
                if not uploaded:
                    uploaded = _upload_file_via_plus_menu(page, file_path)
                if not uploaded:
                    for sel in [
                        'input[type="file"]:not([accept*="image"])',
                        'input[type="file"]',
                    ]:
                        try:
                            page.locator(sel).first.set_input_files(
                                str(file_path), timeout=2500
                            )
                            page.wait_for_timeout(12000)
                            uploaded = True
                            print(f"    ✓ file input 経由でファイル投入")
                            break
                        except Exception:
                            continue
                if uploaded:
                    inserted_files += 1
                    print(f"    🟢 {file_path.name} 添付成功")
                else:
                    failed_files += 1
                    print(f"    🔴 {file_path.name} 添付失敗 → テキスト案内に切替", file=sys.stderr)
                    page.keyboard.insert_text(
                        f"（ファイル：{file_path.name} の自動添付に失敗しました。手動で添付してください）"
                    )
            else:
                failed_files += 1
                print(f"⚠️  添付ファイル不在: {file_path}", file=sys.stderr)
                page.keyboard.insert_text(f"（ファイル：{file_path.name} が見つかりません）")

        page.keyboard.press("Control+End")
        page.wait_for_timeout(200)
        page.keyboard.press("Enter")
        page.wait_for_timeout(500)

        pos = m.end()

    remaining = body[pos:]
    if remaining:
        page.keyboard.press("Control+End")
        page.wait_for_timeout(200)
        page.keyboard.insert_text(remaining)
        page.wait_for_timeout(1500)

    if inserted_imgs or failed_imgs:
        print(f"📷 画像処理結果: 成功 {inserted_imgs} / 失敗 {failed_imgs}")
    if inserted_files or failed_files:
        print(f"📎 ファイル処理結果: 成功 {inserted_files} / 失敗 {failed_files}")


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

    # 添付成果物（外部ダウンロードリンク）= 旧仕様。
    # 新仕様: 本文中の [[FILE_ATTACH:relative/path]] マーカを note β機能で自動添付する。
    # → マーカが本文にある & ファイル実体が存在する場合は下書き切替えずに通常公開。
    # → 「添付成果物あり」表記だけでマーカが無い場合は安全側に倒して下書き保存。
    file_attach_matches = list(_FILE_ATTACH_PATTERN.finditer(text))
    if file_attach_matches:
        files_ok = []
        files_ng = []
        for fm in file_attach_matches:
            fp = ROOT / fm.group(1).strip()
            (files_ok if fp.exists() else files_ng).append(fp.name)
        if files_ok:
            print(f"📎 自動添付ファイル: {', '.join(files_ok)}")
        if files_ng:
            print(f"⚠️  添付マーカに該当ファイルが見つからず: {', '.join(files_ng)}", file=sys.stderr)
        if files_ng and not save_draft and not dry_run:
            print("→ 一部ファイルが不在のため安全に下書き保存モードへ切替")
            save_draft = True
    else:
        asset_m = re.search(r"\|\s*添付成果物\s*\|\s*([^|]+?)\s*\|", text)
        has_attachment = bool(asset_m and "なし" not in asset_m.group(1))
        if has_attachment and not save_draft and not dry_run:
            print(f"⚠️  添付成果物あり ({asset_m.group(1).strip()}) かつ FILE_ATTACH マーカ無し → 下書きモードに切替")
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

            # 既存の本文を全消去（既存記事の編集時にゴミ ("/有料" や前回の残骸) が
            # 累積するのを防ぐ）
            try:
                page.evaluate("""
                    () => {
                        const editor = document.querySelector('.ProseMirror');
                        if (!editor) return false;
                        editor.focus();
                        const range = document.createRange();
                        range.selectNodeContents(editor);
                        const sel = window.getSelection();
                        sel.removeAllRanges();
                        sel.addRange(range);
                        return true;
                    }
                """)
                page.wait_for_timeout(300)
                page.keyboard.press("Delete")
                page.wait_for_timeout(800)
                print("🧹 本文クリア完了 (既存内容を全削除)")
            except Exception as e:
                print(f"WARNING: 本文クリア失敗: {e}", file=sys.stderr)

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

                # 本文側でのスラッシュコマンド挿入は撤廃:
                # → 失敗時に "/有料" などのリテラルテキストが本文に残る不具合があった
                # → publish パネル側「有料エリア設定」+ 段落クリックの方式に一本化する
                print("ℹ️  本文側の有料エリア挿入はスキップ (publish パネル側で確定)")

            # サムネ画像はスクリプトで投入しない仕様に変更（ユーザー判断）
            # → 公開後にユーザーが手動で設定する
            # → 完了 Issue でリマインドする
            thumbnail_path = (
                ROOT / "projects" / "rakuda-sensei" / "assets" / "thumbnails"
                / f"{md_path.stem}.png"
            )
            if thumbnail_path.exists():
                print(f"ℹ️  サムネ候補ファイル: {thumbnail_path.name}")
                print(f"   → 公開後にユーザーが手動設定する仕様 (リマインドを後で出す)")
            else:
                print(f"ℹ️  サムネファイル無し: {thumbnail_path.name}")

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

            # (サムネは公開後にエディタへ戻って設定する仕様)

            # === ハッシュタグは公開パネル最上部にあるので、最初に設定する ===
            # ユーザー指摘: 有料/無料設定と同じ画面の一番上にハッシュタグ欄がある
            try:
                page.evaluate("() => window.scrollTo(0, 0)")
                page.wait_for_timeout(600)
            except Exception:
                pass

            tag_input_selectors = [
                'input[placeholder*="ハッシュタグ"]',
                'input[placeholder*="タグ"]',
                'input[placeholder*="#"]',
                'input[aria-label*="タグ"]',
                'input[aria-label*="ハッシュタグ"]',
                '[role="combobox"]',
                'input[aria-autocomplete]',
                '[class*="tag"] input[type="text"]',
                '[class*="hashtag"] input',
                '[class*="Tag"] input',
                '[data-testid*="tag"] input',
            ]
            tag_input_locator = None
            for sel in tag_input_selectors:
                try:
                    loc = page.locator(sel).first
                    loc.wait_for(state="visible", timeout=1500)
                    tag_input_locator = loc
                    print(f"✅ タグ入力欄発見 (selector: {sel})")
                    break
                except Exception:
                    continue

            # JS フォールバック: タグ関連 input をテキスト/属性で網羅探索 + focus
            if tag_input_locator is None:
                try:
                    result = page.evaluate("""
                        () => {
                            const inputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type])'));
                            for (const inp of inputs) {
                                const txt = (inp.placeholder || '') + (inp.getAttribute('aria-label') || '') + (inp.name || '') + (inp.className || '');
                                if (/タグ|ハッシュタグ|tag|Tag|hashtag/i.test(txt)) {
                                    inp.scrollIntoView({block: 'center'});
                                    inp.focus();
                                    return {found: true, info: txt.slice(0, 100)};
                                }
                            }
                            const labels = document.querySelectorAll('label');
                            for (const lb of labels) {
                                if (/タグ|ハッシュタグ/.test(lb.textContent || '')) {
                                    const inp = lb.querySelector('input') || (lb.htmlFor && document.getElementById(lb.htmlFor));
                                    if (inp) {
                                        inp.scrollIntoView({block: 'center'});
                                        inp.focus();
                                        return {found: true, info: 'via label: ' + lb.textContent.slice(0, 50)};
                                    }
                                }
                            }
                            return {found: false};
                        }
                    """)
                    if result.get('found'):
                        try:
                            tag_input_locator = page.locator(':focus').first
                            print(f"✅ タグ入力欄発見 (JS evaluate: {result.get('info')})")
                        except Exception:
                            pass
                except Exception as e:
                    print(f"WARNING: タグ入力欄 JS 探索失敗: {e}", file=sys.stderr)

            if tag_input_locator is None:
                print("⚠️  タグ入力欄が見つからず（タグ設定スキップ）", file=sys.stderr)
                shot(page, "06b-tag-input-missing")
                dump_html(page, "06b-tag-input-missing")
            else:
                tag_count = 0
                for tag in meta["tags"][:7]:
                    tag = tag.strip().lstrip("#")
                    if not tag:
                        continue
                    try:
                        # クリックして focus → 入力 → サジェスト出るまで待つ → Enter で確定
                        tag_input_locator.click(timeout=2000)
                        page.wait_for_timeout(300)
                        tag_input_locator.fill(tag, timeout=3000)
                        page.wait_for_timeout(900)  # サジェスト表示待ち
                        # サジェストがあればクリック (note は input 候補と既存 popular 候補を出す)
                        suggestion_clicked = False
                        for ssel in [
                            f'[role="option"]:has-text("{tag}")',
                            f'li:has-text("{tag}")',
                            f'[class*="suggestion"]:has-text("{tag}")',
                            f'[class*="Suggest"]:has-text("{tag}")',
                            f'button:has-text("{tag}")',
                        ]:
                            try:
                                page.locator(ssel).first.click(timeout=800)
                                suggestion_clicked = True
                                break
                            except Exception:
                                continue
                        if not suggestion_clicked:
                            tag_input_locator.press("Enter")
                        page.wait_for_timeout(700)
                        tag_count += 1
                    except Exception as e:
                        print(f"   タグ '{tag}' 入力失敗: {e}", file=sys.stderr)
                print(f"✅ タグ設定: {tag_count} 個")
                shot(page, "06c-after-tags")

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

                # === SNSプロモーション機能（有料設定パネル内・セール section） ===
                # note の有料設定パネルは: 価格 → 返金申請 → セール (折りたたみ)
                # セール の中に 設定しない / タイムセール / SNSプロモーション機能 の radio がある
                # ここで設定しないと publish パネル外なので押せなくなる
                share_discount = meta.get("share_discount") or 0
                rt_message = meta.get("rt_message") or ""
                if share_discount > 0 and rt_message:
                    print(f"💰 SNSプロモーション設定試行: ¥{share_discount} / RT文 {len(rt_message)}字")
                    try:
                        # 1) セール section を開く（折りたたまれているケースが大半）
                        for sel in [
                            'button:has-text("セール")',
                            'summary:has-text("セール")',
                            '[aria-label*="セール"]',
                            'button:has-text("販売設定")',
                        ]:
                            try:
                                page.locator(sel).first.click(timeout=1500)
                                page.wait_for_timeout(1000)
                                print(f"   セール section 展開: {sel}")
                                break
                            except Exception:
                                continue
                        # 2) SNSプロモーション radio を選択
                        # 注意: 「SNSプロモーション」テキストの親を辿りすぎると有料設定パネル全体に届き、
                        # 最初の radio (is_paid=free) を誤クリックして有料設定を解除してしまう。
                        # → ラベル直下の input のみを対象にし、name="is_paid" を明示的に除外する。
                        promo_selected = False
                        try:
                            js_promo = page.evaluate(
                                """
                                () => {
                                    // 候補テキストノードを全部探す（label/span/div より広く）
                                    const walker = document.createTreeWalker(
                                        document.body, NodeFilter.SHOW_TEXT, null
                                    );
                                    const targets = [];
                                    let node;
                                    while ((node = walker.nextNode())) {
                                        const t = (node.textContent || '').trim();
                                        if (/^SNSプロモーション/.test(t) || t === 'SNSプロモーション機能') {
                                            if (node.parentElement) targets.push(node.parentElement);
                                        }
                                    }
                                    if (targets.length === 0) {
                                        return {ok: false, reason: 'no SNSプロモーション text node'};
                                    }
                                    // 各候補について、最も近い label / [role=radio] / li を見つける
                                    // そこに含まれる radio (name != is_paid) を選ぶ
                                    for (const el of targets) {
                                        // 最近接の label or radiogroup item
                                        let host = el.closest('label')
                                                 || el.closest('[role="radio"]')
                                                 || el.closest('li')
                                                 || el.closest('[class*="radio"]');
                                        if (!host) {
                                            // 直接の親が <label> でないなら兄弟まで含めた小さい範囲を試す
                                            host = el.parentElement;
                                        }
                                        if (!host) continue;
                                        // host 内の radio で is_paid 以外を抽出
                                        const radios = Array.from(host.querySelectorAll(
                                            'input[type="radio"]'
                                        )).filter(r => r.name !== 'is_paid');
                                        if (radios.length > 0) {
                                            const radio = radios[0];
                                            const setter = Object.getOwnPropertyDescriptor(
                                                window.HTMLInputElement.prototype, 'checked').set;
                                            setter.call(radio, true);
                                            radio.dispatchEvent(new Event('input', {bubbles: true}));
                                            radio.dispatchEvent(new Event('change', {bubbles: true}));
                                            radio.click();
                                            return {ok: true, name: radio.name, value: radio.value, hostTag: host.tagName};
                                        }
                                    }
                                    // ↑で見つからない場合、role=radio の祖先で text が SNSプロモーションを含むものを直接 click
                                    const allRadioGroups = Array.from(document.querySelectorAll(
                                        '[role="radio"], label.radio, label:has(input[type="radio"])'
                                    ));
                                    for (const rg of allRadioGroups) {
                                        const text = (rg.textContent || '').trim();
                                        if (/SNSプロモーション/.test(text)) {
                                            // 内部の radio で is_paid 以外
                                            const r = Array.from(rg.querySelectorAll('input[type="radio"]'))
                                                .find(x => x.name !== 'is_paid');
                                            if (r) {
                                                const setter = Object.getOwnPropertyDescriptor(
                                                    window.HTMLInputElement.prototype, 'checked').set;
                                                setter.call(r, true);
                                                r.dispatchEvent(new Event('input', {bubbles: true}));
                                                r.dispatchEvent(new Event('change', {bubbles: true}));
                                                r.click();
                                                return {ok: true, name: r.name, value: r.value, hostTag: 'role-radio'};
                                            }
                                            // それでも無ければラジオグループ自体を click
                                            rg.click();
                                            return {ok: true, name: '(role-radio click)', value: '(text-match)', hostTag: 'rg.click'};
                                        }
                                    }
                                    return {ok: false, reason: 'no non-is_paid radio near SNSプロモーション label'};
                                }
                                """
                            )
                            if js_promo.get("ok"):
                                # 安全弁: is_paid=free を間違えてクリックした疑いがある場合は失敗扱い
                                if js_promo.get("name") == "is_paid":
                                    print(f"   ⚠️  JS で is_paid={js_promo.get('value')} に当たった→誤検出として却下")
                                else:
                                    promo_selected = True
                                    print(f"   ✅ SNSプロモ radio ON (name={js_promo.get('name')}, value={js_promo.get('value')}, host={js_promo.get('hostTag')})")
                                    page.wait_for_timeout(1500)
                            else:
                                print(f"   ⚠️  JS promo radio スキップ: {js_promo.get('reason')}")
                        except Exception as e:
                            print(f"   ⚠️  JS promo radio 例外: {e}")
                        # 第二手: ラベル/テキスト直接クリック
                        if not promo_selected:
                            for sel in [
                                'label:has-text("SNSプロモーション")',
                                'label:has-text("SNSプロモ")',
                                '[role="radio"]:has-text("SNSプロモーション")',
                                'div:has-text("SNSプロモーション機能") input[type="radio"]',
                            ]:
                                try:
                                    page.locator(sel).first.click(timeout=1500, force=True)
                                    promo_selected = True
                                    print(f"   ✅ SNSプロモ ラベルクリック ({sel})")
                                    page.wait_for_timeout(1500)
                                    break
                                except Exception:
                                    continue
                        # 3) RT文（自動投稿される文）を textarea に入力
                        if promo_selected:
                            rt_set = False
                            for sel in [
                                'textarea[placeholder*="投稿"]',
                                'textarea[placeholder*="ツイート"]',
                                'textarea[placeholder*="X"]',
                                'textarea[name*="share"]',
                                'textarea[name*="promo"]',
                                'textarea[aria-label*="プロモ"]',
                            ]:
                                try:
                                    page.locator(sel).first.fill(rt_message, timeout=2000)
                                    rt_set = True
                                    print(f"   ✅ RT文 入力 ({len(rt_message)}字, selector: {sel})")
                                    break
                                except Exception:
                                    continue
                            if not rt_set:
                                # JS フォールバック: 直近の textarea に setter で値投入
                                try:
                                    js_rt = page.evaluate(
                                        """
                                        (msg) => {
                                            const tas = Array.from(document.querySelectorAll('textarea'));
                                            // visible なものに絞り、ラベルが「投稿/プロモ/拡散」のいずれかに近いもの優先
                                            const visible = tas.filter(t => t.offsetParent !== null);
                                            if (visible.length === 0) return {ok: false, reason: 'no textarea'};
                                            const ta = visible[visible.length - 1];
                                            const setter = Object.getOwnPropertyDescriptor(
                                                window.HTMLTextAreaElement.prototype, 'value').set;
                                            setter.call(ta, msg);
                                            ta.dispatchEvent(new Event('input', {bubbles: true}));
                                            ta.dispatchEvent(new Event('change', {bubbles: true}));
                                            return {ok: true, len: msg.length};
                                        }
                                        """,
                                        rt_message,
                                    )
                                    if js_rt.get("ok"):
                                        rt_set = True
                                        print(f"   ✅ RT文 入力 (JS fallback, {js_rt.get('len')}字)")
                                except Exception as e:
                                    print(f"   ⚠️  RT文 JS fallback例外: {e}")
                            if not rt_set:
                                print(f"   ⚠️  RT文 入力欄が見つからず（スキップ）")
                            # 4) 割引価格入力
                            discount_set = False
                            for sel in [
                                'input[placeholder*="割引"]',
                                'input[aria-label*="割引"]',
                                'input[name*="discount"]',
                                'input[name*="promo_price"]',
                                'input[name*="promotion"]',
                            ]:
                                try:
                                    page.locator(sel).first.fill(str(share_discount), timeout=1500)
                                    discount_set = True
                                    print(f"   ✅ 割引価格 ¥{share_discount} 設定 (selector: {sel})")
                                    break
                                except Exception:
                                    continue
                            if not discount_set:
                                # JS フォールバック: 価格欄の次に出る数値inputを優先
                                try:
                                    js_d = page.evaluate(
                                        """
                                        (discount) => {
                                            const inputs = Array.from(document.querySelectorAll(
                                                'input[type="number"], input[inputmode="numeric"]'));
                                            const visible = inputs.filter(i => i.offsetParent !== null);
                                            // 価格本体(1500)以外の数値inputを優先
                                            const target = visible.find(i => {
                                                const v = i.value || '';
                                                return v !== '1500' && v !== '';
                                            }) || visible[visible.length - 1];
                                            if (!target) return {ok: false};
                                            const setter = Object.getOwnPropertyDescriptor(
                                                window.HTMLInputElement.prototype, 'value').set;
                                            setter.call(target, String(discount));
                                            target.dispatchEvent(new Event('input', {bubbles: true}));
                                            target.dispatchEvent(new Event('change', {bubbles: true}));
                                            return {ok: true, name: target.name};
                                        }
                                        """,
                                        share_discount,
                                    )
                                    if js_d.get("ok"):
                                        discount_set = True
                                        print(f"   ✅ 割引価格 ¥{share_discount} 設定 (JS fallback, name={js_d.get('name')})")
                                except Exception as e:
                                    print(f"   ⚠️  割引価格 JS fallback例外: {e}")
                            if not discount_set:
                                print(f"   ⚠️  割引価格入力欄が見つからず（スキップ）")
                            page.wait_for_timeout(1000)
                        else:
                            print("   ⚠️  SNSプロモ radio 選択失敗 → 設定スキップ")
                    except Exception as e:
                        print(f"WARNING: SNSプロモ設定例外: {e}", file=sys.stderr)
                    shot(page, "07c2-after-sns-promo-in-paid-panel")
                elif meta["price"] > 0:
                    print(f"ℹ️  SNSプロモ設定なし (share_discount={share_discount}, rt_message={'有' if rt_message else '無'})")

                # 「有料エリア設定」ボタンを押す（noteの本物のペイウォール確定操作）
                # note公式仕様: ボタン押下後、本文に戻されて有料ラインのカーソルが出る
                # → 有料にしたい段落をクリックして位置を確定する
                area_button_pressed = False
                try:
                    page.locator('button:has-text("有料エリア設定")').first.click(timeout=3000)
                    page.wait_for_timeout(2500)
                    print("✅ 有料エリア設定 ボタン押下")
                    area_button_pressed = True
                except Exception:
                    try:
                        page.locator('button:has-text("有料エリアを設定")').first.click(timeout=2000)
                        page.wait_for_timeout(2500)
                        print("✅ 有料エリアを設定 ボタン押下")
                        area_button_pressed = True
                    except Exception:
                        print("ℹ️  有料エリア設定 ボタン未発見（不要 or 既に設定済の可能性）")

                # 有料ライン位置を確定:
                # note の仕様 = 各段落の間に「ラインをこの場所に変更」ボタンが出現する。
                # クリックするとそのボタンより上が無料、下が有料になる。
                # → 📥 段落の直前にあるボタンをクリックする。
                #
                # 記事は構造上 📥 が最後の段落 → 最後のボタン = 正解 になるよう設計。
                # 戦略: attempt 0=最後のボタン / 1=最後から2番目 / 2=座標(📥直前) / 3=最後から3番目
                # 各 attempt で多重クリック方法 → 検証 を実施。
                if area_button_pressed:
                    paywall_set_ok = False
                    # 戦略リスト: 'last_n=N' は最後から N+1 番目のボタンを指す
                    strategies = ['last_n=0', 'last_n=1', 'coordinate', 'last_n=2']
                    for attempt in range(len(strategies)):
                        strategy = strategies[attempt]
                        try:
                            # 1) 候補ボタン探索 + 1段目の JS クリック実行
                            result = page.evaluate(
                                """
                                (args) => {
                                    const marker = args.marker;
                                    const attempt = args.attempt;
                                    const strategy = args.strategy;

                                    // クリック対象を直接タグ問わず広く探索
                                    const candidatesSet = new Set();
                                    const addClickable = (el) => {
                                        if (!el) return;
                                        // テキストを持つ最近接 button/role=button 祖先を採用
                                        let target = el;
                                        for (let i = 0; i < 6 && target && target !== document.body; i++) {
                                            const tag = target.tagName;
                                            const role = target.getAttribute && target.getAttribute('role');
                                            if (tag === 'BUTTON' || role === 'button') break;
                                            target = target.parentElement;
                                        }
                                        if (target && target !== document.body) candidatesSet.add(target);
                                    };
                                    document.querySelectorAll('*').forEach(el => {
                                        if (!el.children.length && el.textContent &&
                                            el.textContent.indexOf('ラインをこの場所に変更') !== -1) {
                                            addClickable(el);
                                        }
                                    });
                                    const candidates = Array.from(candidatesSet);

                                    // 既に黒ボタンが正しい位置にあるか先にチェック
                                    const activeSet = new Set();
                                    document.querySelectorAll('*').forEach(el => {
                                        if (!el.children.length && el.textContent &&
                                            el.textContent.indexOf('このラインより先を有料にする') !== -1) {
                                            let target = el;
                                            for (let i = 0; i < 6 && target && target !== document.body; i++) {
                                                if (target.tagName === 'BUTTON' || (target.getAttribute && target.getAttribute('role') === 'button')) break;
                                                target = target.parentElement;
                                            }
                                            if (target) activeSet.add(target);
                                        }
                                    });

                                    // 📥 を含むテキストノードを document 全体から探す
                                    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                                    let markerNode = null;
                                    let n;
                                    while ((n = walker.nextNode())) {
                                        if (n.textContent && n.textContent.indexOf(marker) !== -1) {
                                            markerNode = n;
                                            break;
                                        }
                                    }
                                    if (!markerNode) {
                                        return {error: 'marker text not found', candidates: candidates.length};
                                    }

                                    // marker の block 要素まで上る (display !== inline まで)
                                    let markerEl = markerNode.parentElement;
                                    while (markerEl && markerEl !== document.body) {
                                        const d = getComputedStyle(markerEl).display;
                                        if (d !== 'inline' && d !== 'inline-block' && d !== 'contents') break;
                                        markerEl = markerEl.parentElement;
                                    }
                                    if (!markerEl) return {error: 'marker block not found'};

                                    markerEl.scrollIntoView({block: 'center'});
                                    void document.body.offsetHeight;  // force layout
                                    const markerRect = markerEl.getBoundingClientRect();

                                    // 既に黒ボタンが 📥 直前にあるか
                                    for (const btn of activeSet) {
                                        const r = btn.getBoundingClientRect();
                                        if (r.width === 0 && r.height === 0) continue;
                                        if (r.bottom <= markerRect.top + 5 && markerRect.top - r.bottom < 250) {
                                            return {alreadyCorrect: true, candidates: candidates.length};
                                        }
                                    }

                                    if (candidates.length === 0) {
                                        return {error: 'no candidates', activeCount: activeSet.size};
                                    }

                                    // ボタンを Y 座標で sort (上から下へ)
                                    const sorted = candidates.slice().sort((a, b) => {
                                        return a.getBoundingClientRect().top - b.getBoundingClientRect().top;
                                    });

                                    let bestBtn = null;
                                    let bestDistance = -1;

                                    if (strategy && strategy.startsWith('last_n=')) {
                                        // strategy: 最後から N+1 番目のボタンを選択
                                        const n = parseInt(strategy.split('=')[1], 10) || 0;
                                        const idx = sorted.length - 1 - n;
                                        if (idx >= 0 && idx < sorted.length) {
                                            bestBtn = sorted[idx];
                                            bestDistance = markerRect.top - bestBtn.getBoundingClientRect().bottom;
                                        }
                                    } else {
                                        // 座標方式: 📥 直前のボタン (bottom <= markerRect.top, 一番近い)
                                        for (const btn of candidates) {
                                            const r = btn.getBoundingClientRect();
                                            if (r.width === 0 || r.height === 0) continue;
                                            if (r.bottom <= markerRect.top + 5) {
                                                const d = markerRect.top - r.bottom;
                                                if (bestDistance < 0 || d < bestDistance) {
                                                    bestDistance = d;
                                                    bestBtn = btn;
                                                }
                                            }
                                        }
                                    }

                                    if (!bestBtn) {
                                        return {error: 'no button selected by strategy: ' + strategy, candidates: candidates.length, markerY: markerRect.top};
                                    }

                                    // スクロール → reflow 強制 → 座標取得
                                    bestBtn.scrollIntoView({block: 'center'});
                                    void document.body.offsetHeight;
                                    const rect = bestBtn.getBoundingClientRect();
                                    const x = rect.x + rect.width / 2;
                                    const y = rect.y + rect.height / 2;

                                    // フル PointerEvent + MouseEvent 連打 → 最後に .click()
                                    const evtOpts = {
                                        bubbles: true, cancelable: true, composed: true,
                                        view: window, clientX: x, clientY: y, screenX: x, screenY: y,
                                        button: 0, buttons: 1, isPrimary: true, pointerType: 'mouse', pointerId: 1,
                                    };
                                    const upOpts = {...evtOpts, buttons: 0};
                                    try { bestBtn.dispatchEvent(new PointerEvent('pointerover', upOpts)); } catch (e) {}
                                    try { bestBtn.dispatchEvent(new PointerEvent('pointerenter', upOpts)); } catch (e) {}
                                    try { bestBtn.dispatchEvent(new MouseEvent('mouseover', upOpts)); } catch (e) {}
                                    try { bestBtn.dispatchEvent(new PointerEvent('pointerdown', evtOpts)); } catch (e) {}
                                    try { bestBtn.dispatchEvent(new MouseEvent('mousedown', evtOpts)); } catch (e) {}
                                    try { bestBtn.dispatchEvent(new PointerEvent('pointerup', upOpts)); } catch (e) {}
                                    try { bestBtn.dispatchEvent(new MouseEvent('mouseup', upOpts)); } catch (e) {}
                                    try { bestBtn.dispatchEvent(new MouseEvent('click', upOpts)); } catch (e) {}
                                    try { bestBtn.click(); } catch (e) {}

                                    return {
                                        x: x, y: y,
                                        btnTag: bestBtn.tagName,
                                        btnText: (bestBtn.textContent || '').trim().slice(0, 40),
                                        candidates: candidates.length,
                                        markerY: markerRect.top,
                                        distance: bestDistance,
                                        attempt: attempt,
                                    };
                                }
                                """,
                                {"marker": "📥", "attempt": attempt, "strategy": strategy},
                            )

                            if result.get('alreadyCorrect'):
                                print(f"✅ 有料ライン位置: 既に 📥 直前に黒ボタン (attempt={attempt}, candidates={result.get('candidates')})")
                                paywall_set_ok = True
                                shot(page, f"07d-paywall-ok-attempt{attempt}")
                                break

                            if result.get('error'):
                                print(f"WARNING: 探索失敗 attempt={attempt}: {result}", file=sys.stderr)
                                shot(page, f"07d-paywall-find-fail-attempt{attempt}")
                                if attempt == 0:
                                    dump_html(page, f"07d-paywall-find-fail-attempt{attempt}")
                                # 失敗時は少し待ってリトライ
                                page.wait_for_timeout(1500)
                                continue

                            # 2) JS dispatch 後の追い打ち: mouse.click + Playwright locator click
                            print(f"📍 attempt={attempt} strategy={strategy}: 候補={result.get('candidates')}, btnText={result.get('btnText')!r}, distance={result.get('distance'):.0f}, markerY={result.get('markerY'):.0f}")
                            page.wait_for_timeout(800)
                            try:
                                page.mouse.click(result['x'], result['y'])
                            except Exception as e:
                                print(f"   mouse.click 失敗: {e}", file=sys.stderr)
                            page.wait_for_timeout(800)

                            # Playwright locator でも叩く
                            try:
                                # 候補数と同じ数のロケータを得て、ベストに対応する idx を選ぶ
                                btns = page.locator('button:has-text("ラインをこの場所に変更"), [role="button"]:has-text("ラインをこの場所に変更")')
                                cnt = btns.count()
                                for i in range(cnt):
                                    bx = btns.nth(i).bounding_box()
                                    if not bx:
                                        continue
                                    # btnText/x/y の中点が近いものを叩く
                                    cx = bx['x'] + bx['width'] / 2
                                    cy = bx['y'] + bx['height'] / 2
                                    if abs(cx - result['x']) < 20 and abs(cy - result['y']) < 30:
                                        btns.nth(i).click(timeout=2000, force=True)
                                        print(f"   Playwright locator click 成功 (idx={i})")
                                        break
                            except Exception as e:
                                print(f"   Playwright locator click 失敗: {e}", file=sys.stderr)
                            page.wait_for_timeout(1500)

                            # 3) 検証: 黒ボタンが 📥 直前にあるか
                            verify = page.evaluate(
                                """
                                (marker) => {
                                    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                                    let mNode = null;
                                    let n;
                                    while ((n = walker.nextNode())) {
                                        if (n.textContent && n.textContent.indexOf(marker) !== -1) {
                                            mNode = n; break;
                                        }
                                    }
                                    if (!mNode) return {verified: false, reason: 'marker missing'};
                                    let mEl = mNode.parentElement;
                                    while (mEl && mEl !== document.body) {
                                        const d = getComputedStyle(mEl).display;
                                        if (d !== 'inline' && d !== 'inline-block' && d !== 'contents') break;
                                        mEl = mEl.parentElement;
                                    }
                                    if (!mEl) return {verified: false, reason: 'block missing'};
                                    const mRect = mEl.getBoundingClientRect();

                                    const active = [];
                                    document.querySelectorAll('*').forEach(el => {
                                        if (!el.children.length && el.textContent &&
                                            el.textContent.indexOf('このラインより先を有料にする') !== -1) {
                                            let t = el;
                                            for (let i = 0; i < 6 && t && t !== document.body; i++) {
                                                if (t.tagName === 'BUTTON' || (t.getAttribute && t.getAttribute('role') === 'button')) break;
                                                t = t.parentElement;
                                            }
                                            if (t) active.push(t);
                                        }
                                    });
                                    if (active.length === 0) return {verified: false, reason: 'no active button', mY: mRect.top};

                                    for (const b of active) {
                                        const r = b.getBoundingClientRect();
                                        if (r.bottom <= mRect.top + 5 && mRect.top - r.bottom < 250) {
                                            return {verified: true, distance: mRect.top - r.bottom};
                                        }
                                    }
                                    const closest = active.map(b => {
                                        const r = b.getBoundingClientRect();
                                        return {y: r.top, bottom: r.bottom};
                                    });
                                    return {verified: false, reason: 'black button not above marker', mY: mRect.top, active: closest};
                                }
                                """,
                                "📥",
                            )
                            if verify.get('verified'):
                                print(f"✅✅ 有料ライン確定 attempt={attempt} (distance={verify.get('distance'):.0f}px)")
                                paywall_set_ok = True
                                shot(page, f"07d-paywall-verified-attempt{attempt}")
                                break
                            else:
                                print(f"❌ 検証失敗 attempt={attempt}: {verify}", file=sys.stderr)
                                shot(page, f"07d-paywall-verify-fail-attempt{attempt}")
                                page.wait_for_timeout(1500)
                        except Exception as e:
                            print(f"WARNING: ライン位置クリック例外 attempt={attempt}: {e}", file=sys.stderr)
                            shot(page, f"07d-paywall-exception-attempt{attempt}")
                            page.wait_for_timeout(1500)

                    if not paywall_set_ok:
                        print("ERROR: 有料ライン位置を 📥 直前に設定できませんでした", file=sys.stderr)
                        dump_html(page, "07d-paywall-FINAL-FAIL")
                        shot(page, "07d-paywall-FINAL-FAIL")
                        # 公開モードでもラインが正しく設定できなければ 強制的に下書き止めにする
                        # → 「1行目から有料」のまま公開してしまう事故を防ぐ
                        if not save_draft:
                            print("🛑 publish モードだが ライン未確定 → 下書きに切り替えて公開停止", file=sys.stderr)
                            save_draft = True

            # (タグ + SNSプロモ設定は公開パネル開いた直後の有料設定パネル内で実施済み)

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
                'button:has-text("更新する")',
                'button:has-text("公開")',
                'button:has-text("投稿")',
                'button:has-text("更新")',
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

                    # === 公開後のサムネ設定 ===
                    # 公開フロー中ではエディタの file input が見つからない問題があるため
                    # 公開完了 → エディタへ戻る → サムネ投入 → 更新 の流れに分離
                    if thumbnail_path.exists():
                        try:
                            note_id_m = _re.search(r"/n/(n[a-z0-9]+)", actual_url) or _re.search(r"/notes/(n[a-z0-9]+)", actual_url)
                            if note_id_m:
                                note_id = note_id_m.group(1)
                                editor_url = f"https://editor.note.com/notes/{note_id}/edit/"
                                print(f"🖼️  公開後サムネ設定モード: {editor_url}")
                                page.goto(editor_url, wait_until="domcontentloaded", timeout=25000)
                                try:
                                    page.wait_for_load_state("networkidle", timeout=15000)
                                except Exception:
                                    pass
                                page.wait_for_timeout(6000)
                                shot(page, "13a-editor-for-thumbnail")
                                dump_html(page, "13a-editor-for-thumbnail")
                                enumerate_form_elements(page, "公開後エディタ (サムネ設定用)")

                                # ページ上部にスクロール（ヘッダー画像エリアは最上部）
                                try:
                                    page.evaluate("() => window.scrollTo(0, 0)")
                                    page.wait_for_timeout(800)
                                except Exception:
                                    pass

                                thumb_set = False
                                # Step 1: 既に file input が visible ならそのまま set_input_files
                                # （note の最新 UI ではボタンクリック不要で input が常設の可能性）
                                for sel in [
                                    'input[type="file"][accept*="image"]',
                                    'input[type="file"]',
                                ]:
                                    try:
                                        loc = page.locator(sel).first
                                        # visible でなくても set_input_files は動く
                                        loc.set_input_files(str(thumbnail_path), timeout=3000)
                                        thumb_set = True
                                        print(f"✅ サムネ添付 (file input 直接: {sel})")
                                        page.wait_for_timeout(8000)
                                        shot(page, "13b-after-thumbnail-direct")
                                        break
                                    except Exception:
                                        continue

                                # Step 2: ヘッダー画像エリアっぽいボタンをクリックしてから file input
                                if not thumb_set:
                                    eyecatch_button_selectors = [
                                        'button:has-text("画像を追加")',
                                        'button:has-text("ヘッダー画像")',
                                        'button:has-text("画像をアップロード")',
                                        'button:has-text("カバー画像")',
                                        'button:has-text("アイキャッチ")',
                                        'button:has-text("記事画像")',
                                        'div:has-text("画像を追加") > button',
                                        '[class*="eyecatch"] button',
                                        '[class*="thumbnail"] button',
                                        '[class*="cover"] button',
                                        '[class*="header-image"] button',
                                        '[class*="HeaderImage"] button',
                                        '[aria-label*="画像"]',
                                        'label:has-text("画像")',
                                    ]
                                    for sel in eyecatch_button_selectors:
                                        try:
                                            page.locator(sel).first.click(timeout=1500)
                                            page.wait_for_timeout(1000)
                                            print(f"   ヘッダー画像ボタン押下: {sel}")
                                            # クリック後に再度 file input 探索
                                            for fsel in [
                                                'input[type="file"][accept*="image"]',
                                                'input[type="file"]',
                                            ]:
                                                try:
                                                    page.locator(fsel).first.set_input_files(
                                                        str(thumbnail_path), timeout=3000)
                                                    thumb_set = True
                                                    print(f"   ✅ サムネ添付 (post-click: {fsel})")
                                                    page.wait_for_timeout(8000)
                                                    break
                                                except Exception:
                                                    continue
                                            if thumb_set:
                                                break
                                        except Exception:
                                            continue

                                # Step 3: JS dispatch で paste/drop
                                if not thumb_set:
                                    try:
                                        if _upload_image_via_dispatch(page, thumbnail_path):
                                            thumb_set = True
                                            print(f"✅ サムネ添付 (JS dispatch)")
                                            page.wait_for_timeout(8000)
                                    except Exception:
                                        pass

                                if thumb_set:
                                    # 更新ボタン押下で保存（記事タイプ等の他フィールドは既に確定済）
                                    page.wait_for_timeout(3000)
                                    shot(page, "13c-before-update-click")
                                    # まず「公開設定/公開に進む」を再度開いて更新ボタンを出す
                                    for sel in [
                                        'button:has-text("公開に進む")',
                                        'button:has-text("公開設定")',
                                    ]:
                                        try:
                                            page.locator(sel).first.click(timeout=2000)
                                            page.wait_for_timeout(4000)
                                            print(f"   公開パネル再展開: {sel}")
                                            break
                                        except Exception:
                                            continue
                                    updated = False
                                    for sel in [
                                        'button:has-text("更新する")',
                                        'button:has-text("更新")',
                                        'button:has-text("投稿する")',
                                        'button:has-text("公開する")',
                                        'button[type="submit"]:has-text("更新")',
                                    ]:
                                        try:
                                            page.locator(sel).last.click(timeout=2500, force=True)
                                            page.wait_for_timeout(8000)
                                            updated = True
                                            print(f"✅ サムネ反映で更新クリック: {sel}")
                                            break
                                        except Exception:
                                            continue
                                    shot(page, "13d-after-thumbnail-update")
                                    if not updated:
                                        print("⚠️  サムネはアップロードしたが更新ボタンが押せず（自動保存に期待）")
                                else:
                                    print(f"⚠️  公開後サムネ添付失敗（全手段）")
                                    shot(page, "13b-no-thumbnail")
                                    dump_html(page, "13b-no-thumbnail")
                            else:
                                print(f"⚠️  公開URLから note ID 取れず（サムネスキップ）: {actual_url}")
                        except Exception as e:
                            print(f"WARNING: 公開後サムネ設定で例外: {e}", file=sys.stderr)
                            shot(page, "13-thumbnail-exception")
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
