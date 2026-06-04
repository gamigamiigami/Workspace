#!/usr/bin/env python3
"""
Instagram投稿 自動生成オーケストレータ

毎日1本、X週次ファイルから本日の朝スロットを取り出して：
1. PIL で正方形画像を生成
2. dashboard/assets/posts/ に保存（GitHub Pages配信）
3. sns/instagram/{date}.md にキャプションと画像URLを記録

post-to-instagram.yml が拾って Meta Graph API で自動投稿。
"""

import datetime
import os
import re
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

from generate_instagram_image import create_post_image

ROOT = Path(__file__).resolve().parents[3]
WEEKLY_DIR = ROOT / "projects" / "rakuda-sensei" / "sns" / "weekly"
IG_DIR = ROOT / "projects" / "rakuda-sensei" / "sns" / "instagram"
IMG_DIR = ROOT / "projects" / "rakuda-sensei" / "dashboard" / "assets" / "posts"

JST = ZoneInfo("Asia/Tokyo")
WEEKDAY_JP = ["月", "火", "水", "木", "金", "土", "日"]

# GitHub Pages URL prefix
REPO_OWNER = os.environ.get("GITHUB_REPOSITORY_OWNER", "gamigamiigami")
REPO_NAME = (os.environ.get("GITHUB_REPOSITORY") or "gamigamiigami/Workspace").split("/")[-1]
DEFAULT_BRANCH = os.environ.get("GITHUB_REF_NAME", "claude/workspace-knowledge-base-setup-ccVKP")

# raw.githubusercontent.com 経由（GitHub Pages待ち不要）
IMG_URL_PREFIX = f"https://raw.githubusercontent.com/{REPO_OWNER}/{REPO_NAME}/{DEFAULT_BRANCH}/projects/rakuda-sensei/dashboard/assets/posts"


def find_weekly_file(target_date: datetime.date) -> Path | None:
    monday = target_date - datetime.timedelta(days=target_date.weekday())
    candidate = WEEKLY_DIR / f"{monday.isoformat()}-x-posts.md"
    if candidate.exists():
        return candidate
    files = sorted(WEEKLY_DIR.glob("*-x-posts.md"), reverse=True)
    return files[0] if files else None


def extract_morning_tweet(weekly_md: str, target_date: datetime.date) -> tuple[str, str] | None:
    """指定日の朝スロットの本文とタグを抽出"""
    month, day = target_date.month, target_date.day
    day_match = re.search(rf"##\s*{month}/{day}\([月火水木金土日]\)", weekly_md)
    if not day_match:
        day_match = re.search(rf"##\s*{month}月{day}日", weekly_md)
        if not day_match:
            return None

    section_start = day_match.end()
    next_day = re.search(r"\n##\s+\d", weekly_md[section_start:])
    section = weekly_md[section_start: section_start + (next_day.start() if next_day else len(weekly_md))]

    slot_match = re.search(r"###\s*朝", section)
    if not slot_match:
        return None

    slot_start = slot_match.end()
    next_slot = re.search(r"\n###\s+", section[slot_start:])
    slot_section = section[slot_start: slot_start + (next_slot.start() if next_slot else len(section))]

    body_match = re.search(r"-\s*本文[：:]\s*\n((?:(?!- タグ|\n##|\n###).*\n?)+)", slot_section)
    if not body_match:
        return None
    body = body_match.group(1).strip()
    body = re.split(r"\n-\s*タグ", body)[0].strip()

    tag_match = re.search(r"-\s*タグ[：:]\s*(.+)", slot_section)
    tags = tag_match.group(1).strip() if tag_match else ""

    return body, tags


def slugify_date(d: datetime.date) -> str:
    return d.strftime("%Y%m%d")


def main() -> int:
    today = datetime.datetime.now(JST).date()
    weekday = WEEKDAY_JP[today.weekday()]
    print(f"📅 対象日: {today} ({weekday}曜)")

    weekly_file = find_weekly_file(today)
    if not weekly_file:
        print(f"ERROR: weeklyファイルが見つかりません", file=sys.stderr)
        return 1

    extracted = extract_morning_tweet(weekly_file.read_text(encoding="utf-8"), today)
    if not extracted:
        print(f"WARNING: {today}({weekday})の朝スロットが抽出できません。スキップ", file=sys.stderr)
        return 0  # 失敗扱いにしない

    body, tags = extracted
    print(f"📝 本文: {body[:60]}...")
    print(f"🏷  タグ: {tags}")

    # 画像生成
    slug = slugify_date(today)
    img_name = f"{slug}.png"
    img_path = IMG_DIR / img_name
    create_post_image(body, img_path)

    # IG投稿MDファイル作成
    IG_DIR.mkdir(parents=True, exist_ok=True)
    ig_md_path = IG_DIR / f"{today.isoformat()}.md"

    # Instagram用キャプション（X本文 + タグ + 誘導文）
    caption = (
        f"{body}\n\n"
        f"━━━━━━━━━━\n"
        f"📚 詳しい教材はBOOTHで\n"
        f"📝 まとめ記事はnoteで\n"
        f"プロフィールリンクから🔗\n"
        f"━━━━━━━━━━\n\n"
        f"{tags}\n"
        f"#らくだ先生 #公立教員 #20代教員 #働き方改革 #セミリタイア"
    )

    image_url = f"{IMG_URL_PREFIX}/{img_name}"

    md_content = f"""---
image: {image_url}
status: draft
generated_at: {datetime.datetime.now(JST).isoformat(timespec='seconds')}
source_date: {today.isoformat()}
---
{caption}
"""
    ig_md_path.write_text(md_content, encoding="utf-8")
    print(f"✅ IG投稿MD作成: {ig_md_path}")
    print(f"🖼  画像URL: {image_url}")

    # 次のステップに渡す
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as f:
            f.write(f"ig_post_path={ig_md_path.relative_to(ROOT)}\n")
            f.write(f"image_path={img_path.relative_to(ROOT)}\n")
            f.write(f"image_url={image_url}\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())
