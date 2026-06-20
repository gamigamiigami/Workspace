#!/usr/bin/env python3
"""
Instagram 自動投稿スクリプト (公式Graph API版・完全無料)

GitHub Actions で workflow_dispatch トリガーにより実行。
sns/instagram/{slug}.md の投稿ファイルを読んでIGに投稿。

【セットアップ（初回のみ・約30分）】
setup/meta-api-setup.md を参照。
- Instagramアカウントをビジネス/クリエイターアカウントに切替（無料）
- Facebookページと連携（無料）
- Meta Developer App登録 → アクセストークン取得（無料）

必要なGitHub Secret：
  - META_ACCESS_TOKEN: Meta長期アクセストークン
  - IG_USER_ID: InstagramビジネスアカウントID

【投稿ファイル形式】
sns/instagram/{slug}.md にフロントマターでメタ情報を記載：

  ---
  image: https://gamigamiigami.github.io/Workspace/projects/rakuda-sensei/dashboard/posts-images/foo.png
  status: draft  # draft or posted
  ---
  教材作り3時間→30分にした方法🐪

  プロフィールリンクから記事へ👆

  #教員のバトン #国語の先生 #働き方改革

【重要】Instagram投稿には画像URL（公開アクセス可能）が必須。
GitHub Pages経由で配信するか、imgurなどの無料ホスティング利用。

【無料化の仕組み】
- Instagram Graph API (¥0、Meta公式)
- GitHub Pages画像ホスティング (¥0)
- API経由なのでアカウントロックリスクなし
"""

import os
import re
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[3]
IG_DIR = ROOT / "projects" / "rakuda-sensei" / "sns" / "instagram"
API_BASE = "https://graph.facebook.com/v21.0"


def parse_post_file(md_path: Path) -> dict:
    """Frontmatter付きMDファイルを解析"""
    text = md_path.read_text(encoding="utf-8")
    meta = {"image": "", "status": "draft", "caption": ""}

    if text.startswith("---"):
        end = text.find("---", 3)
        if end != -1:
            frontmatter = text[3:end].strip()
            for line in frontmatter.splitlines():
                if ":" in line:
                    k, v = line.split(":", 1)
                    meta[k.strip()] = v.strip()
            meta["caption"] = text[end + 3:].strip()
        else:
            meta["caption"] = text
    else:
        meta["caption"] = text

    return meta


def post_to_instagram(image_url: str, caption: str) -> tuple[bool, str]:
    """Instagram Graph APIで投稿"""
    token = os.environ.get("META_ACCESS_TOKEN")
    ig_user_id = os.environ.get("IG_USER_ID")
    if not token or not ig_user_id:
        return False, "META_ACCESS_TOKEN / IG_USER_ID が未設定"

    if not image_url:
        return False, "image URLが未指定（IG投稿には画像必須）"

    # Step 1: Media container作成
    try:
        r1 = requests.post(
            f"{API_BASE}/{ig_user_id}/media",
            params={
                "image_url": image_url,
                "caption": caption,
                "access_token": token,
            },
            timeout=60,
        )
        if r1.status_code != 200:
            return False, f"Container作成失敗 ({r1.status_code}): {r1.text[:300]}"
        container_id = r1.json().get("id")
        if not container_id:
            return False, f"Container ID取得失敗: {r1.text[:300]}"
    except requests.RequestException as e:
        return False, f"Container作成リクエスト失敗: {e}"

    # IG mediaは処理完了まで数秒待つ必要あり
    time.sleep(5)

    # Step 2: 公開
    try:
        r2 = requests.post(
            f"{API_BASE}/{ig_user_id}/media_publish",
            params={"creation_id": container_id, "access_token": token},
            timeout=60,
        )
        if r2.status_code != 200:
            return False, f"公開失敗 ({r2.status_code}): {r2.text[:300]}"
        post_id = r2.json().get("id")
        return True, f"投稿成功 post_id={post_id}"
    except requests.RequestException as e:
        return False, f"公開リクエスト失敗: {e}"


def main(post_path: str, dry_run: bool = False) -> int:
    # Meta APIトークン未設定なら「まだ未セットアップ」としてスキップ（エラーにしない）
    if not dry_run and (not os.environ.get("META_ACCESS_TOKEN") or not os.environ.get("IG_USER_ID")):
        print("ℹ️  META_ACCESS_TOKEN / IG_USER_ID 未設定のためスキップ")
        print("   → Meta APIセットアップ完了後に自動投稿が始まります")
        return 0

    md_path = ROOT / post_path
    if not md_path.exists():
        # 投稿対象ファイルが無いのは「やることなし」→スキップ
        print(f"ℹ️  {md_path} がない → 投稿対象なしのためスキップ")
        return 0

    meta = parse_post_file(md_path)
    print(f"📷 画像: {meta['image']}")
    print(f"📝 キャプション ({len(meta['caption'])}字):")
    print(meta["caption"][:200] + ("..." if len(meta["caption"]) > 200 else ""))

    if not meta["image"]:
        print("ERROR: image URLがフロントマターに必要です", file=sys.stderr)
        return 1

    if meta.get("status") == "posted":
        print("ℹ️  すでに投稿済み (frontmatterのstatus: posted)")
        return 0

    if dry_run:
        print("✅ Dry run完了")
        return 0

    ok, msg = post_to_instagram(meta["image"], meta["caption"])
    if not ok:
        print(f"ERROR: {msg}", file=sys.stderr)
        return 1

    print(f"✅ {msg}")

    # 投稿済みステータスをファイルに更新
    text = md_path.read_text(encoding="utf-8")
    if "status: draft" in text:
        text = text.replace("status: draft", "status: posted")
        md_path.write_text(text, encoding="utf-8")

    return 0


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("post_path", help="投稿MDファイルのパス")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    sys.exit(main(args.post_path, args.dry_run))
