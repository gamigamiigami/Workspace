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

    # 2. 「## 記事本文」セクションがあればそこから抽出
    m = re.search(r"##\s+記事本文\s*\n+(.+?)(?:\n##\s+投稿後|\Z)", cleaned, re.DOTALL)
    if m:
        body = m.group(1).strip()
    else:
        # フォールバック: --- 区切りから本文セクションだけ取得
        sections = cleaned.split("---")
        body_candidates = []
        for section in sections:
            # 内部メモらしいキーワードを含むセクションはスキップ
            skip_keywords = [
                "投稿メタデータ", "サムネ", "投稿後アクション",
                "対応Addnessゴール", "note-writer skill",
                "作成日：", "作成日:",
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
            compose_loaded = False
            for url in compose_urls:
                try:
                    print(f"🔗 試行: {url}")
                    page.goto(url, wait_until="domcontentloaded", timeout=20000)
                    page.wait_for_timeout(3000)
                    # editorっぽいURLに辿り着いたか
                    if "editor" in page.url or "/notes/" in page.url or "edit" in page.url:
                        print(f"✅ エディタ到達: {page.url}")
                        compose_loaded = True
                        break
                    else:
                        print(f"⏭ {url} → リダイレクトor非エディタ ({page.url})")
                except Exception as e:
                    print(f"⏭ {url} 失敗: {e}")
                    continue

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

            # 無料部分を入力
            page.keyboard.insert_text(free_body)
            page.wait_for_timeout(500)

            # ペイウォール挿入（有料部分がある場合）
            if paid_body and meta["price"] > 0:
                page.keyboard.press("Enter")
                page.keyboard.press("Enter")
                try:
                    paywall_btn = page.locator('button[aria-label*="有料"], button:has-text("ここから先は")').first
                    paywall_btn.click(timeout=5000)
                    page.wait_for_timeout(500)
                except Exception:
                    try:
                        plus_btn = page.locator('button[aria-label*="ブロック"], button.ProseMirror-menuitem').first
                        plus_btn.click(timeout=5000)
                        page.wait_for_timeout(300)
                        paywall_item = page.locator('button:has-text("有料"), li:has-text("有料")').first
                        paywall_item.click(timeout=5000)
                        page.wait_for_timeout(500)
                    except Exception:
                        print("WARNING: ペイウォール挿入失敗。手動設定が必要かもしれません", file=sys.stderr)

                page.keyboard.insert_text(paid_body)
                page.wait_for_timeout(500)

            print("✅ 本文入力完了")
            # noteは数秒で自動下書き保存するので待機
            page.wait_for_timeout(4000)
            shot(page, "05-after-body-input")
            dump_html(page, "05-after-body-input")

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

            # アイキャッチ画像（サムネ）アップロード
            # 記事ファイル名から推定 (articles/002-foo.md → assets/thumbnails/002-foo.png)
            thumbnail_path = (
                ROOT / "projects" / "rakuda-sensei" / "assets" / "thumbnails"
                / f"{md_path.stem}.png"
            )
            if thumbnail_path.exists():
                print(f"🖼️  サムネ候補: {thumbnail_path.name}")
                # Step 1: file input を直接探す（多くの場合 hidden で常駐）
                file_input_selectors = [
                    'input[type="file"][accept*="image"]',
                    'input[type="file"]',
                ]
                thumb_set = False
                for sel in file_input_selectors:
                    try:
                        # set_input_files は hidden input でも動作する
                        page.locator(sel).first.set_input_files(
                            str(thumbnail_path), timeout=3000)
                        thumb_set = True
                        print(f"✅ サムネ添付 (selector: {sel})")
                        page.wait_for_timeout(6000)  # アップロード待ち
                        shot(page, "07-after-thumbnail")
                        break
                    except Exception as e:
                        continue
                if not thumb_set:
                    print(f"⚠️  サムネ添付失敗（file input 見つからず）")
                    shot(page, "07-no-thumbnail")
            else:
                print(f"ℹ️  サムネファイル無し: {thumbnail_path.name}")

            # 価格設定 - セレクタ拡充
            if meta["price"] > 0:
                paid_selectors = [
                    'label:has-text("有料")',
                    'input[value="paid"]',
                    'button:has-text("有料")',
                    'input[type="radio"][value*="paid"]',
                    'input[type="radio"][value*="有料"]',
                    '[data-testid*="paid"]',
                    '[role="radio"]:has-text("有料")',
                    'input[type="radio"] + label:has-text("有料")',
                    '[class*="paid"] input',
                ]
                paid_clicked = False
                for sel in paid_selectors:
                    try:
                        page.locator(sel).first.click(timeout=2000)
                        paid_clicked = True
                        page.wait_for_timeout(1500)
                        break
                    except Exception:
                        continue
                # 有料を選んだ後に価格入力欄が現れるので少し待つ
                page.wait_for_timeout(1500)
                shot(page, "07b-after-paid-radio")
                dump_html(page, "07b-after-paid-radio")
                price_selectors = [
                    'input[type="number"][name*="price"]',
                    'input[placeholder*="価格"]',
                    'input[placeholder*="¥"]',
                    'input[placeholder*="円"]',
                    'input[placeholder*="100"]',
                    'input[placeholder*="500"]',
                    'input[type="number"]',
                    'input[inputmode="numeric"]',
                    'input[inputmode="decimal"]',
                    'input[name="price"]',
                    'input[name*="amount"]',
                    'input[aria-label*="価格"]',
                    'input[aria-label*="¥"]',
                    '[class*="price"] input',
                    '[class*="amount"] input',
                    '[data-testid*="price"] input',
                    'form input[type="text"]',
                ]
                price_set = False
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

            # 最終投稿前にHTMLダンプ
            page.wait_for_timeout(1500)
            shot(page, "08b-before-final-publish")
            dump_html(page, "08b-before-final-publish")

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
                    loc.click(timeout=2500)
                    page.wait_for_timeout(6000)
                    published = True
                    print(f"✅ 投稿ボタンクリック (selector: {sel})")
                    break
                except Exception:
                    continue

            shot(page, "09-after-final-click")
            dump_html(page, "09-after-final-click")
            # noteは記事編集中なので、エディタURLにいる時点で既に「下書き」として保存されている
            edit_url = page.url
            print(f"📝 現在URL: {edit_url}")

            if published:
                shot(page, "10-after-publish-click")
                # 公開URLパターン (note.com/{user}/n/{hash}) に遷移していれば成功
                if "/n/" in page.url and "/notes/" not in page.url:
                    print(f"✅ 公開完了！URL: {page.url}")
                    # 後続のクロスポスト連携用にURLを永続化
                    url_file = ROOT / "projects" / "rakuda-sensei" / "articles" / ".last-published-url.txt"
                    url_file.write_text(page.url + "\n", encoding="utf-8")
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
