#!/usr/bin/env python3
"""
Meta APIトークン自動延長スクリプト (Threads / Instagram)

Meta長期トークンは60日有効。50日目に自動でリフレッシュして GitHub Secret を更新する。
これで実質「永久に有効」になる（人間作業ゼロ）。

【セットアップ】
GitHub Secret 追加:
  - GH_PAT: Personal Access Token（repo scope）
    → このトークンでGitHub Secrets API経由で META_ACCESS_TOKEN / THREADS_ACCESS_TOKEN を更新する

【仕組み】
1. 現在のトークンで refresh_access_token エンドポイントを叩く
2. 新しい60日有効トークンを取得
3. GitHub Secrets API でリポジトリの Secret を上書き
"""

import datetime
import os
import sys
from base64 import b64encode

import requests
from nacl import encoding, public

REPO = os.environ.get("GITHUB_REPOSITORY", "gamigamiigami/Workspace")
API_BASE = "https://api.github.com"


def get_repo_public_key(gh_token: str) -> tuple[str, str]:
    """リポジトリの公開鍵を取得（Secret暗号化に必要）"""
    r = requests.get(
        f"{API_BASE}/repos/{REPO}/actions/secrets/public-key",
        headers={"Authorization": f"Bearer {gh_token}", "Accept": "application/vnd.github+json"},
        timeout=30,
    )
    r.raise_for_status()
    data = r.json()
    return data["key"], data["key_id"]


def encrypt_secret(public_key: str, secret_value: str) -> str:
    """libsodium sealed box でSecretを暗号化"""
    pk = public.PublicKey(public_key.encode("utf-8"), encoding.Base64Encoder())
    sealed_box = public.SealedBox(pk)
    encrypted = sealed_box.encrypt(secret_value.encode("utf-8"))
    return b64encode(encrypted).decode("utf-8")


def update_repo_secret(gh_token: str, name: str, value: str) -> bool:
    """GitHub Secret を更新"""
    pub_key, key_id = get_repo_public_key(gh_token)
    encrypted_value = encrypt_secret(pub_key, value)

    r = requests.put(
        f"{API_BASE}/repos/{REPO}/actions/secrets/{name}",
        headers={"Authorization": f"Bearer {gh_token}", "Accept": "application/vnd.github+json"},
        json={"encrypted_value": encrypted_value, "key_id": key_id},
        timeout=30,
    )
    if r.status_code in (201, 204):
        print(f"✅ Secret更新成功: {name}")
        return True
    print(f"❌ Secret更新失敗 ({name}): {r.status_code} {r.text[:200]}", file=sys.stderr)
    return False


def refresh_threads_token(current_token: str) -> str | None:
    """Threads長期トークンをリフレッシュ"""
    r = requests.get(
        "https://graph.threads.net/refresh_access_token",
        params={"grant_type": "th_refresh_token", "access_token": current_token},
        timeout=30,
    )
    if r.status_code != 200:
        print(f"❌ Threads token refresh失敗: {r.status_code} {r.text[:200]}", file=sys.stderr)
        return None
    return r.json().get("access_token")


def refresh_instagram_token(current_token: str) -> str | None:
    """Instagram長期トークンをリフレッシュ"""
    r = requests.get(
        "https://graph.instagram.com/refresh_access_token",
        params={"grant_type": "ig_refresh_token", "access_token": current_token},
        timeout=30,
    )
    if r.status_code != 200:
        print(f"❌ Instagram token refresh失敗: {r.status_code} {r.text[:200]}", file=sys.stderr)
        return None
    return r.json().get("access_token")


def main() -> int:
    gh_token = os.environ.get("GH_PAT") or os.environ.get("GITHUB_TOKEN")
    if not gh_token:
        print("ERROR: GH_PAT または GITHUB_TOKEN が必要", file=sys.stderr)
        return 1

    print(f"🔄 {datetime.datetime.utcnow().isoformat()} Metaトークン自動延長開始")
    print(f"📦 リポジトリ: {REPO}")

    success = 0
    skipped = 0

    # Threads
    threads_token = os.environ.get("THREADS_ACCESS_TOKEN")
    if threads_token:
        print("🧵 Threadsトークンをリフレッシュ中...")
        new_token = refresh_threads_token(threads_token)
        if new_token:
            if update_repo_secret(gh_token, "THREADS_ACCESS_TOKEN", new_token):
                success += 1
        else:
            print("⚠️  Threadsリフレッシュ失敗（トークン期限切れの可能性）")
    else:
        print("⏭ THREADS_ACCESS_TOKEN なし、スキップ")
        skipped += 1

    # Instagram
    ig_token = os.environ.get("META_ACCESS_TOKEN")
    if ig_token:
        print("📷 Instagramトークンをリフレッシュ中...")
        new_token = refresh_instagram_token(ig_token)
        if new_token:
            if update_repo_secret(gh_token, "META_ACCESS_TOKEN", new_token):
                success += 1
        else:
            print("⚠️  Instagramリフレッシュ失敗（トークン期限切れの可能性）")
    else:
        print("⏭ META_ACCESS_TOKEN なし、スキップ")
        skipped += 1

    print(f"\n📊 結果: 成功 {success}件 / スキップ {skipped}件")
    return 0 if success > 0 or skipped > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
