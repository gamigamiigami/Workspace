#!/usr/bin/env python3
"""
Threads (Meta) 自動投稿スクリプト (公式Graph API版・完全無料)

GitHub Actions cron で X と同じスロット (JST 7:00 / 21:00) に実行され、
weekly生成ファイルから該当ツイートをThreadsに投稿する。

【セットアップ（初回のみ・約15分）】
setup/meta-api-setup.md を参照。
必要なGitHub Secret：
  - THREADS_ACCESS_TOKEN: ThreadsのアクセストークンL
  - THREADS_USER_ID: ThreadsのユーザーID

【無料化の仕組み】
- Threads公式Graph API (¥0)
- API経由なのでアカウントロックリスクなし
"""

import datetime
import os
import re
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

ROOT = Path(__file__).resolve().parents[3]
WEEKLY_DIR = ROOT / "projects" / "rakuda-sensei" / "sns" / "weekly"
POSTED_LOG = ROOT / "projects" / "rakuda-sensei" / "sns" / ".threads-posted.log"

JST = ZoneInfo("Asia/Tokyo")
WEEKDAY_JP = ["月", "火", "水", "木", "金", "土", "日"]
API_BASE = "https://graph.threads.net/v1.0"


def current_slot() -> tuple[datetime.date, str]:
    now = datetime.datetime.now(JST)
    slot = "朝" if now.hour < 14 else "夜"
    return now.date(), slot


def find_weekly_file(target_date: datetime.date) -> Path | None:
    monday = target_date - datetime.timedelta(days=target_date.weekday())
    candidate = WEEKLY_DIR / f"{monday.isoformat()}-x-posts.md"
    if candidate.exists():
        return candidate
    files = sorted(WEEKLY_DIR.glob("*-x-posts.md"), reverse=True)
    return files[0] if files else None


def extract_tweet(weekly_md: str, target_date: datetime.date, slot: str) -> str | None:
    month, day = target_date.month, target_date.day
    day_match = re.search(rf"##\s*{month}/{day}\([月火水木金土日]\)", weekly_md)
    if not day_match:
        day_match = re.search(rf"##\s*{month}月{day}日", weekly_md)
        if not day_match:
            return None

    section_start = day_match.end()
    next_day = re.search(r"\n##\s+\d", weekly_md[section_start:])
    section = weekly_md[section_start: section_start + (next_day.start() if next_day else len(weekly_md))]

    slot_match = re.search(rf"###\s*{slot}", section)
    if not slot_match:
        return None

    slot_start = slot_match.end()
    next_slot = re.search(r"\n###\s+", section[slot_start:])
    slot_section = section[slot_start: slot_start + (next_slot.start() if next_slot else len(section))]

    body_match = re.search(r"-\s*本文[：:]\s*\n((?:(?!- タグ|\n##|\n###).*\n?)+)", slot_section)
    if body_match:
        body = body_match.group(1).strip()
        body = re.split(r"\n-\s*タグ", body)[0].strip()
        return body
    return None


def is_already_posted(target_date: datetime.date, slot: str) -> bool:
    if not POSTED_LOG.exists():
        return False
    key = f"{target_date.isoformat()}-{slot}"
    return key in POSTED_LOG.read_text(encoding="utf-8")


def mark_posted(target_date: datetime.date, slot: str, tweet_text: str):
    POSTED_LOG.parent.mkdir(parents=True, exist_ok=True)
    key = f"{target_date.isoformat()}-{slot}"
    timestamp = datetime.datetime.now(JST).isoformat(timespec="seconds")
    with POSTED_LOG.open("a", encoding="utf-8") as f:
        f.write(f"{key}\t{timestamp}\t{tweet_text[:50]}...\n")


def post_to_threads(text: str) -> tuple[bool, str]:
    """Threads Graph APIで投稿。(成功フラグ, メッセージ)を返す"""
    token = os.environ.get("THREADS_ACCESS_TOKEN")
    user_id = os.environ.get("THREADS_USER_ID")
    if not token or not user_id:
        return False, "THREADS_ACCESS_TOKEN / THREADS_USER_ID が未設定"

    # Step 1: Container作成
    try:
        r1 = requests.post(
            f"{API_BASE}/{user_id}/threads",
            params={"media_type": "TEXT", "text": text, "access_token": token},
            timeout=30,
        )
        if r1.status_code != 200:
            return False, f"Container作成失敗 ({r1.status_code}): {r1.text[:200]}"
        container_id = r1.json().get("id")
        if not container_id:
            return False, f"Container ID取得失敗: {r1.text[:200]}"
    except requests.RequestException as e:
        return False, f"Container作成リクエスト失敗: {e}"

    # Step 2: 公開
    try:
        r2 = requests.post(
            f"{API_BASE}/{user_id}/threads_publish",
            params={"creation_id": container_id, "access_token": token},
            timeout=30,
        )
        if r2.status_code != 200:
            return False, f"公開失敗 ({r2.status_code}): {r2.text[:200]}"
        post_id = r2.json().get("id")
        return True, f"投稿成功 post_id={post_id}"
    except requests.RequestException as e:
        return False, f"公開リクエスト失敗: {e}"


def main(text_override: str = "", force: bool = False, dry_run: bool = False) -> int:
    if text_override:
        tweet_text = text_override
        target_date = datetime.date.today()
        slot = "manual"
    else:
        target_date, slot = current_slot()
        print(f"🕐 スロット: {target_date.isoformat()} {WEEKDAY_JP[target_date.weekday()]}曜 {slot}")

        if not force and is_already_posted(target_date, slot):
            print(f"ℹ️  既投稿済み (force=True で再投稿可)")
            return 0

        weekly_file = find_weekly_file(target_date)
        if not weekly_file:
            print(f"ERROR: weeklyファイルなし", file=sys.stderr)
            return 1

        tweet_text = extract_tweet(weekly_file.read_text(encoding="utf-8"), target_date, slot)
        if not tweet_text:
            print(f"ERROR: {target_date} {slot}のツイート抽出失敗", file=sys.stderr)
            return 1

    print(f"📝 投稿予定: {tweet_text}")
    print(f"📏 文字数: {len(tweet_text)} (Threadsは500字まで)")

    if len(tweet_text) > 500:
        print(f"WARNING: 500字超過、切り詰めます", file=sys.stderr)
        tweet_text = tweet_text[:497] + "..."

    if dry_run:
        print("✅ Dry run完了")
        return 0

    ok, msg = post_to_threads(tweet_text)
    if not ok:
        print(f"ERROR: {msg}", file=sys.stderr)
        return 1

    print(f"✅ {msg}")
    if slot != "manual":
        mark_posted(target_date, slot, tweet_text)
    return 0


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--text", default="", help="任意テキストを直接投稿（スケジュール無視）")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    sys.exit(main(args.text, args.force, args.dry_run))
