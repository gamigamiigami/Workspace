#!/usr/bin/env python3
"""
ブラウザセッションクッキー抽出ツール (初回セットアップ用・1回のみ実行)

【使い方】
1. ターミナルで実行: python extract_cookies.py note
   (または "booth" を指定)
2. ブラウザが開くのでnote.com/BOOTHにログインする
3. ログイン完了後、ターミナルに戻りEnterキーを押す
4. クッキーがJSON形式で表示されるのでコピーする
5. GitHubのSettings > Secrets > Actionsに貼り付ける

【コスト】0円（Playwrightはローカル実行、クッキーは自分のPC上のみ）
"""

import json
import sys
from playwright.sync_api import sync_playwright

TARGETS = {
    "note": {
        "url": "https://note.com/login",
        "secret_name": "NOTE_SESSION_COOKIE",
        "cookie_domains": ["note.com"],
        "login_check": lambda page: "note.com" in page.url and "/login" not in page.url,
    },
    "booth": {
        "url": "https://accounts.booth.pm/sign_in",
        "secret_name": "BOOTH_SESSION_COOKIE",
        "cookie_domains": ["booth.pm", "accounts.booth.pm", "manage.booth.pm"],
        "login_check": lambda page: "manage.booth.pm" in page.url or (
            "booth.pm" in page.url and "sign_in" not in page.url
        ),
    },
}


def extract(service: str):
    if service not in TARGETS:
        print(f"ERROR: サービス名は 'note' または 'booth' を指定してください", file=sys.stderr)
        return 1

    target = TARGETS[service]

    print(f"\n{'='*60}")
    print(f"  {service.upper()} セッションクッキー取得ツール")
    print(f"{'='*60}")
    print(f"\n1. ブラウザが開きます（非ヘッドレスモード）")
    print(f"2. {service}にログインしてください")
    print(f"3. ログイン後、このターミナルに戻ってEnterを押してください\n")

    input("準備ができたらEnterを押してください...")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)  # 有人ブラウザで開く
        context = browser.new_context()
        page = context.new_page()

        page.goto(target["url"])
        print(f"\nブラウザが開きました。{service}にログインしてください。")
        print("ログイン完了後、このターミナルに戻ってEnterを押してください。")

        input("\nログイン完了後にEnterを押してください...")

        # ログイン確認
        if not target["login_check"](page):
            print(f"WARNING: ログインが確認できませんでした。現在のURL: {page.url}")
            print("手動で確認してください。続けますか？(y/n)")
            if input().strip().lower() != "y":
                browser.close()
                return 1

        # クッキー取得
        all_cookies = context.cookies()
        # 対象ドメインのクッキーのみフィルタ
        relevant_cookies = [
            c for c in all_cookies
            if any(domain in c.get("domain", "") for domain in target["cookie_domains"])
        ]

        browser.close()

    if not relevant_cookies:
        print("ERROR: クッキーが取得できませんでした。ログインを確認してください", file=sys.stderr)
        return 1

    cookie_json = json.dumps(relevant_cookies, ensure_ascii=False, indent=2)

    print(f"\n{'='*60}")
    print(f"✅ クッキー取得完了！({len(relevant_cookies)}個)")
    print(f"{'='*60}")
    print(f"\n【次のステップ】")
    print(f"以下のJSONをコピーして、GitHubに登録してください：")
    print(f"\n手順: GitHubリポジトリ > Settings > Secrets and variables > Actions")
    print(f"      > New repository secret")
    print(f"Name: {target['secret_name']}")
    print(f"Secret: (以下のJSONをそのまま貼り付け)\n")
    print("--- ここからコピー ---")
    print(cookie_json)
    print("--- ここまでコピー ---")
    print(f"\n⚠️  このJSONはあなたのログイン情報です。GitHubのSecretは暗号化されて安全に保管されます。")
    print(f"⚠️  第三者には絶対に見せないでください。\n")

    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python extract_cookies.py <note|booth>")
        sys.exit(1)

    sys.exit(extract(sys.argv[1]))
