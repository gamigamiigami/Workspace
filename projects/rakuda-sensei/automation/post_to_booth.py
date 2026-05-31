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

STEALTH_JS = """
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
Object.defineProperty(navigator, 'languages', { get: () => ['ja-JP', 'ja', 'en-US', 'en'] });
Object.defineProperty(navigator, 'plugins', {
  get: () => [{name: 'Chrome PDF Plugin'}, {name: 'Chrome PDF Viewer'}, {name: 'Native Client'}]
});
window.chrome = { runtime: {} };
const getParameter = WebGLRenderingContext.prototype.getParameter;
WebGLRenderingContext.prototype.getParameter = function(parameter) {
  if (parameter === 37445) return 'Intel Inc.';
  if (parameter === 37446) return 'Intel Iris OpenGL Engine';
  return getParameter.apply(this, [parameter]);
};
"""


def normalize_cookies(raw_json: str) -> list:
    """Cookie-Editor JSONをPlaywright SetCookieParam形式に正規化"""
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


def parse_product_meta(html_path: Path) -> dict:
    text = html_path.read_text(encoding="utf-8")
    meta = {"title": "", "price": 0, "description": "", "tags": []}

    # 行単位でメタ情報を抽出（HTMLコメント全体が複数行のため）
    title_m = re.search(r"BOOTH_TITLE:\s*(.+?)\s*$", text, re.MULTILINE)
    if title_m:
        meta["title"] = title_m.group(1).strip()

    # フォールバック: <title> タグ
    if not meta["title"]:
        t_m = re.search(r"<title>\s*(.+?)\s*</title>", text, re.IGNORECASE)
        if t_m:
            meta["title"] = t_m.group(1).strip()

    price_m = re.search(r"BOOTH_PRICE:\s*([\d,]+)", text)
    if price_m:
        meta["price"] = int(price_m.group(1).replace(",", ""))

    # DESC は BOOTH_TAGS or --> までの複数行
    desc_m = re.search(r"BOOTH_DESC:\s*\n((?:(?!BOOTH_TAGS:|-->).*\n?)+)", text)
    if desc_m:
        meta["description"] = desc_m.group(1).strip()

    tags_m = re.search(r"BOOTH_TAGS:\s*(.+?)\s*$", text, re.MULTILINE)
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
            extra_http_headers={
                "Accept-Language": "ja-JP,ja;q=0.9,en;q=0.8",
            },
        )
        context.add_init_script(STEALTH_JS)

        # クッキー認証を優先（reCAPTCHA回避）
        cookie_json = os.environ.get("BOOTH_SESSION_COOKIE")
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

        # playwright-stealth (最初のgoto前に適用)
        try:
            from playwright_stealth import stealth_sync
            stealth_sync(page)
            print("🥷 playwright-stealth 適用")
        except ImportError:
            print("⚠️ playwright-stealth未インストール")
        except Exception as e:
            print(f"⚠️ stealth適用エラー（続行）: {e}")

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
            # 戦略1: 既知URL候補を試す
            new_item_urls = [
                "https://manage.booth.pm/items/new",
                "https://manage.booth.pm/items/create",
                "https://manage.booth.pm/products/new",
                "https://manage.booth.pm/items/add",
            ]

            def is_valid_create_page(p) -> bool:
                """404でもログインでもない、かつinput要素があれば有効"""
                try:
                    title = p.title()
                    if "404" in title or "見つかりません" in title:
                        return False
                    url_lower = p.url.lower()
                    if "login" in url_lower or "accounts.pixiv" in url_lower or "sign_in" in url_lower:
                        return False
                    # input要素が存在すれば有効
                    if p.locator("input, textarea").count() > 0:
                        return True
                    return False
                except Exception:
                    return False

            page_loaded = False
            for url in new_item_urls:
                try:
                    page.goto(url, wait_until="domcontentloaded", timeout=20000)
                    page.wait_for_timeout(3000)
                    if is_valid_create_page(page):
                        print(f"📍 商品作成ページ到達 (戦略1): {page.url}")
                        page_loaded = True
                        break
                    else:
                        print(f"⏭ {url} → 404 or ログイン or input無し (title={page.title()})")
                except Exception as e:
                    print(f"⏭ {url} 失敗: {e}", file=sys.stderr)
                    continue

            # 戦略2: 管理画面トップから「新規出品」ボタンを探してクリック
            if not page_loaded:
                print("\n🔍 戦略2: 管理画面トップから新規出品ボタンを探す")
                try:
                    page.goto("https://manage.booth.pm/", wait_until="domcontentloaded", timeout=20000)
                    page.wait_for_timeout(3000)
                    new_btn_selectors = [
                        'a:has-text("新規出品")',
                        'a:has-text("新規追加")',
                        'button:has-text("新規出品")',
                        'a:has-text("商品を追加")',
                        'a:has-text("出品する")',
                        'a[href*="items/new"]',
                        'a[href*="items/create"]',
                        'a[href*="items/add"]',
                        'a[href*="products/new"]',
                        '[aria-label*="新規"]',
                        '[aria-label*="追加"]',
                    ]
                    for sel in new_btn_selectors:
                        try:
                            el = page.locator(sel).first
                            el.wait_for(timeout=3000, state="visible")
                            print(f"   → ボタン発見: {sel}")
                            el.click(timeout=5000)
                            page.wait_for_timeout(4000)
                            if is_valid_create_page(page):
                                print(f"📍 商品作成ページ到達 (戦略2): {page.url}")
                                page_loaded = True
                                break
                        except Exception:
                            continue
                except Exception as e:
                    print(f"戦略2失敗: {e}", file=sys.stderr)

            # 戦略3: items 一覧ページから「新規」ボタンを探す
            if not page_loaded:
                print("\n🔍 戦略3: items 一覧から新規出品ボタンを探す")
                items_list_urls = [
                    "https://manage.booth.pm/items",
                    "https://manage.booth.pm/products",
                ]
                for list_url in items_list_urls:
                    try:
                        page.goto(list_url, wait_until="domcontentloaded", timeout=20000)
                        page.wait_for_timeout(3000)
                        title = page.title()
                        if "404" in title or "見つかりません" in title:
                            continue
                        print(f"   📋 一覧到達: {page.url} ({title})")
                        # 一覧ページ上の「新規出品」「+」ボタン
                        for sel in [
                            'a:has-text("新規出品")',
                            'a:has-text("商品を追加")',
                            'a:has-text("出品する")',
                            'button:has-text("新規")',
                            'a[href*="new"]',
                            'a[href*="create"]',
                            '[class*="new"][role="button"]',
                            'a.btn-primary',
                        ]:
                            try:
                                el = page.locator(sel).first
                                el.wait_for(timeout=2000, state="visible")
                                el.click(timeout=3000)
                                page.wait_for_timeout(4000)
                                if is_valid_create_page(page):
                                    print(f"📍 商品作成ページ到達 (戦略3): {page.url}")
                                    page_loaded = True
                                    break
                            except Exception:
                                continue
                        if page_loaded:
                            break
                    except Exception:
                        continue

            try:
                page.screenshot(path="booth-01-newitem-page.png")
            except Exception:
                pass

            if not page_loaded:
                # === 強化診断モード（戦略3全部失敗時） ===
                print("\n" + "=" * 60, file=sys.stderr)
                print("ERROR: 商品作成ページに到達できません（戦略1-3全部失敗）", file=sys.stderr)
                print("=" * 60, file=sys.stderr)
                try:
                    page.screenshot(path="booth-00-nopage.png", full_page=True)
                    print(f"URL: {page.url}")
                    print(f"Title: {page.title()}")
                    body_text = page.locator("body").inner_text()[:1500]
                    print(f"\n=== ページ可視テキスト先頭1500字 ===")
                    print(body_text)
                    # クリック可能要素列挙
                    btn_info = page.locator("a, button").evaluate_all(
                        "els => els.slice(0, 30).map(e => ({tag: e.tagName, text: (e.innerText||'').slice(0,40), href: e.href || null}))"
                    )
                    print(f"\n=== クリック可能要素（最大30件） ===")
                    for b in btn_info:
                        if b.get('text') or b.get('href'):
                            print(f"  <{b['tag']}> text={b.get('text','')!r} href={b.get('href','')}")
                    html = page.content()
                    Path("booth-page-dump.html").write_text(html, encoding="utf-8")
                    print(f"\n📄 HTMLダンプ保存: booth-page-dump.html")
                except Exception as e:
                    print(f"診断情報取得失敗: {e}")
                browser.close()
                return 1

            # 動的UI待ち（React/Vue マウント完了を念のため待つ）
            try:
                page.wait_for_load_state("networkidle", timeout=10000)
            except Exception:
                pass
            page.wait_for_timeout(3000)

            # iframe があるならその中も探索対象に
            frames = [page] + [f for f in page.frames if f.url and f.url != page.url]
            print(f"📑 探索フレーム数: {len(frames)}")

            # 商品名入力 - セレクタ大幅拡充
            name_selectors = [
                'input[name="item[name]"]',
                'input[name*="name"][type="text"]',
                'input[name*="title"]',
                'input[placeholder*="商品名"]',
                'input[placeholder*="商品タイトル"]',
                'input[placeholder*="タイトル"]',
                'input[id*="name"]',
                'input[id*="title"]',
                'input[aria-label*="商品名"]',
                'textarea[name*="name"]',
                '[data-testid*="name"] input',
                'form input[type="text"]:first-of-type',
                'input.item-name',
                'input[class*="title"]',
                'input[class*="name"]',
            ]
            name_filled = False
            for frame in frames:
                if name_filled:
                    break
                for sel in name_selectors:
                    try:
                        el = frame.locator(sel).first
                        el.wait_for(timeout=2000, state="visible")
                        el.fill(meta["title"])
                        try:
                            page.wait_for_timeout(300)
                        except Exception:
                            pass
                        frame_label = "main" if frame is page else repr(frame)
                        print(f"✅ 商品名入力完了 (frame={frame_label}, selector: {sel})")
                        name_filled = True
                        break
                    except Exception:
                        continue

            if not name_filled:
                print("\n" + "=" * 60, file=sys.stderr)
                print("ERROR: 商品名入力欄が全候補マッチしませんでした", file=sys.stderr)
                print("=" * 60, file=sys.stderr)

                # --- 強化診断モード ---
                try:
                    page.screenshot(path="booth-02-name-not-found.png", full_page=True)
                    print("📸 スクショ保存: booth-02-name-not-found.png")
                except Exception as e:
                    print(f"スクショ失敗: {e}", file=sys.stderr)

                # 1. ページ基本情報
                try:
                    print(f"\n=== ページ基本 ===")
                    print(f"URL: {page.url}")
                    print(f"Title: {page.title()}")
                except Exception:
                    pass

                # 2. 主要見出し（H1, H2, H3）
                try:
                    print(f"\n=== 見出し（最大5件ずつ） ===")
                    for tag in ["h1", "h2", "h3"]:
                        texts = page.locator(tag).all_text_contents()
                        for t in texts[:5]:
                            t = t.strip().replace("\n", " ")
                            if t:
                                print(f"<{tag}>: {t[:120]}")
                except Exception as e:
                    print(f"見出し取得失敗: {e}", file=sys.stderr)

                # 3. 「ショップ設定」「カテゴリ」など特殊画面の検出
                try:
                    body_text = page.locator("body").inner_text()[:2000]
                    print(f"\n=== ページ可視テキスト先頭2000字 ===")
                    print(body_text)
                    print()
                    # 既知パターンの検出
                    setup_keywords = [
                        ("ショップ設定", "ショップ初期設定未完了の可能性"),
                        ("ショップを開設", "ショップ未開設"),
                        ("カテゴリ", "カテゴリ選択が先かも"),
                        ("プロフィール", "プロフィール設定が先かも"),
                        ("支払", "支払情報未登録"),
                        ("銀行", "口座情報未登録"),
                        ("本人確認", "本人確認未完了"),
                        ("利用規約", "利用規約同意必要"),
                    ]
                    print(f"=== 既知の阻害要因検出 ===")
                    for kw, hint in setup_keywords:
                        if kw in body_text:
                            print(f"⚠️ 「{kw}」検出 → {hint}")
                except Exception as e:
                    print(f"可視テキスト取得失敗: {e}", file=sys.stderr)

                # 4. ボタン・リンク列挙
                try:
                    print(f"\n=== クリック可能要素（最大20件） ===")
                    btn_info = page.locator("button, a[href]").evaluate_all(
                        "els => els.slice(0, 20).map(e => ({tag: e.tagName, text: (e.innerText||'').slice(0,40), href: e.href || null}))"
                    )
                    for b in btn_info:
                        print(f"  <{b['tag']}> text={b.get('text','')!r} href={b.get('href','')}")
                except Exception as e:
                    print(f"クリック要素取得失敗: {e}", file=sys.stderr)

                # 5. 全input要素（text以外も含む）
                try:
                    print(f"\n=== input要素全部（最大20件） ===")
                    all_inputs = page.locator("input, textarea, select").evaluate_all(
                        "els => els.slice(0, 20).map(e => ({tag: e.tagName, type: e.type, name: e.name, id: e.id, placeholder: e.placeholder, ariaLabel: e.getAttribute('aria-label')}))"
                    )
                    if all_inputs:
                        for i in all_inputs:
                            print(f"  <{i.get('tag','')}> type={i.get('type','')} name={i.get('name','')!r} id={i.get('id','')!r} placeholder={i.get('placeholder','')!r}")
                    else:
                        print("  （input/textarea/select が1つも見つからない＝フォーム自体がない画面）")
                except Exception as e:
                    print(f"input列挙失敗: {e}", file=sys.stderr)

                # 6. HTMLダンプ
                try:
                    html_dump = page.content()
                    Path("booth-page-dump.html").write_text(html_dump, encoding="utf-8")
                    print(f"\n📄 HTMLダンプ保存: booth-page-dump.html ({len(html_dump)} 文字・Artifactで確認)")
                except Exception as e:
                    print(f"HTMLダンプ失敗: {e}", file=sys.stderr)

                print("=" * 60, file=sys.stderr)
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
