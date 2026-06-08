#!/usr/bin/env python3
"""
note 記事公開時の自動 Threads 告知投稿

X 告知は note の SNS プロモ連携が publish 時に自動で行うため、ここでは扱わない。
日常的な X 投稿は post_to_x.py (weekly cron) が担当する。

generate_cross_post.py が生成した sns/cross-posts/{date}-{slug}/ から
最新のクロスポスト案を読み込んで、Threads に告知を即時投稿する。

【動作】
1. sns/cross-posts/ の最新ディレクトリを発見
2. threads.md から本文を抽出
3. .promo-posted.log で重複投稿を防止
4. Threads: Meta Graph API で投稿

【使い方】
GitHub Actions から自動呼び出し (post-note-promo.yml 経由)
ローカル手動: python post_note_promo.py [--dry-run]
"""

from __future__ import annotations

import datetime
import json
import os
import re
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

ROOT = Path(__file__).resolve().parents[3]
CROSSPOST_DIR = ROOT / "projects" / "rakuda-sensei" / "sns" / "cross-posts"
POSTED_LOG = ROOT / "projects" / "rakuda-sensei" / "sns" / ".promo-posted.log"

JST = ZoneInfo("Asia/Tokyo")


def find_latest_crosspost_dir() -> Path | None:
    """最新のクロスポストディレクトリを返す"""
    if not CROSSPOST_DIR.exists():
        return None
    dirs = sorted(
        [d for d in CROSSPOST_DIR.iterdir() if d.is_dir() and not d.name.startswith(".")],
        reverse=True,
    )
    return dirs[0] if dirs else None


def get_published_url() -> str | None:
    """直近の公開URL を .last-published-url.txt から取得 (クエリ除去)"""
    url_file = ROOT / "projects" / "rakuda-sensei" / "articles" / ".last-published-url.txt"
    if not url_file.exists():
        return None
    url = url_file.read_text(encoding="utf-8").strip().splitlines()[0].strip()
    # ?app_launch=false や ?flash_message_key=... を除去
    return re.sub(r"\?.*$", "", url) if url else None


def extract_threads_text(threads_md_path: Path) -> str | None:
    """threads.md から本文を抽出 (ヘッダー後の本文)"""
    if not threads_md_path.exists():
        return None
    text = threads_md_path.read_text(encoding="utf-8")
    # 「---」以降を本文として扱う
    parts = re.split(r"\n---\s*\n", text, maxsplit=1)
    if len(parts) >= 2:
        return parts[1].strip()
    # フォールバック: 最初の # 見出しを除いた残り
    lines = text.split("\n")
    body_lines = [l for l in lines if not l.startswith("#") and l.strip()]
    return "\n".join(body_lines).strip() if body_lines else None


def is_already_promoted(crosspost_id: str) -> bool:
    if not POSTED_LOG.exists():
        return False
    return crosspost_id in POSTED_LOG.read_text(encoding="utf-8")


def mark_promoted(crosspost_id: str, platforms: list[str]):
    POSTED_LOG.parent.mkdir(parents=True, exist_ok=True)
    ts = datetime.datetime.now(JST).isoformat(timespec="seconds")
    with POSTED_LOG.open("a", encoding="utf-8") as f:
        f.write(f"{crosspost_id}\t{ts}\t{','.join(platforms)}\n")


def post_to_threads(text: str, dry_run: bool = False) -> bool:
    """Threads に Meta Graph API で投稿"""
    token = os.environ.get("THREADS_ACCESS_TOKEN")
    user_id = os.environ.get("THREADS_USER_ID")
    if not token or not user_id:
        print("⚠️ THREADS_ACCESS_TOKEN / THREADS_USER_ID 未設定 → Threads 投稿スキップ")
        return False

    if dry_run:
        print(f"   [dry-run] Threads 投稿予定: {text[:60]}...")
        return True

    # 500字制限
    if len(text) > 500:
        text = text[:497] + "..."

    try:
        # Container 作成
        r1 = requests.post(
            f"https://graph.threads.net/v1.0/{user_id}/threads",
            params={"media_type": "TEXT", "text": text, "access_token": token},
            timeout=30,
        )
        if r1.status_code != 200:
            print(f"❌ Threads container作成失敗 ({r1.status_code}): {r1.text[:200]}")
            return False
        container_id = r1.json().get("id")
        if not container_id:
            print(f"❌ container_id取得失敗")
            return False

        # 公開
        r2 = requests.post(
            f"https://graph.threads.net/v1.0/{user_id}/threads_publish",
            params={"creation_id": container_id, "access_token": token},
            timeout=30,
        )
        if r2.status_code != 200:
            print(f"❌ Threads 公開失敗 ({r2.status_code}): {r2.text[:200]}")
            return False
        print(f"✅ Threads 投稿完了")
        return True
    except Exception as e:
        print(f"❌ Threads 投稿エラー: {e}")
        return False


def main(dry_run: bool = False) -> int:
    latest = find_latest_crosspost_dir()
    if not latest:
        print("ℹ️ cross-posts/ にディレクトリなし。スキップ")
        return 0

    crosspost_id = latest.name
    print(f"📦 最新クロスポスト: {crosspost_id}")

    if not dry_run and is_already_promoted(crosspost_id):
        print(f"ℹ️ {crosspost_id} は既に告知投稿済み。スキップ")
        return 0

    # メタ情報読み込み
    meta = {}
    meta_path = latest / "promo-meta.json"
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            # source_title / article_title いずれにも対応
            title = meta.get("source_title") or meta.get("article_title") or "?"
            print(f"   元記事: {title}")
        except Exception:
            pass

    # 公開URL を取得 (古い placeholder を実URL に置換するため)
    real_url = get_published_url()
    if real_url:
        print(f"   公開URL: {real_url}")

    threads_text = extract_threads_text(latest / "threads.md")

    # URL を実URL で上書き
    if real_url and threads_text:
        url_pat = re.compile(r"https?://note\.com/[\w\-]+/n/n[a-z0-9]+(?:\?[^\s]*)?")
        threads_text = url_pat.sub(real_url, threads_text)

    posted_platforms = []
    skipped_intentionally = False  # Threads トークン未設定など意図的スキップを区別

    if threads_text:
        has_threads_token = bool(os.environ.get("THREADS_ACCESS_TOKEN") and os.environ.get("THREADS_USER_ID"))
        if not has_threads_token:
            print("\nℹ️ THREADS_ACCESS_TOKEN / THREADS_USER_ID 未設定 → Threads 自動投稿は無効化")
            skipped_intentionally = True
        else:
            print(f"\n🧵 Threads 投稿: {threads_text[:80]}...")
            if post_to_threads(threads_text, dry_run=dry_run):
                posted_platforms.append("Threads")
    else:
        print("⚠️ Threads 本文が抽出できず")

    if posted_platforms and not dry_run:
        mark_promoted(crosspost_id, posted_platforms)

    print(f"\n📊 投稿成功: {posted_platforms or 'なし'}")
    print("ℹ️ X 告知は note の SNS プロモ連携が publish 時に自動投稿済み (本スクリプトでは扱わない)")
    # Threads トークン未設定で意図的にスキップした場合は成功扱い
    # (X は note 側で自動投稿済みなので、ここで「投稿数=0」でも問題ない)
    return 0 if posted_platforms or dry_run or skipped_intentionally else 1


if __name__ == "__main__":
    dry = "--dry-run" in sys.argv
    sys.exit(main(dry_run=dry))
