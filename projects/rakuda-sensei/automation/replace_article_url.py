#!/usr/bin/env python3
"""
note記事の公開URLを各告知ファイルの placeholder に一括置換する

【使い方】
python3 projects/rakuda-sensei/automation/replace_article_url.py \\
  https://note.com/rakuda_sensei/n/n1234567890ab \\
  [--target-dir projects/rakuda-sensei/sns/cross-posts/2026-06-02-side-fire-sheet]

target-dir 省略時は最新の cross-posts/ サブフォルダを自動検出。
置換対象: `xxxx` / `https://note.com/rakuda_sensei/n/xxxx`
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CROSSPOSTS_ROOT = ROOT / "projects" / "rakuda-sensei" / "sns" / "cross-posts"

PLACEHOLDER_PATTERNS = [
    r"https://note\.com/rakuda_sensei/n/xxxx",
    r"\[記事URL自動挿入\]",
]


def find_latest_dir() -> Path:
    dirs = sorted(
        [p for p in CROSSPOSTS_ROOT.iterdir() if p.is_dir()],
        key=lambda p: p.name,
        reverse=True,
    )
    if not dirs:
        sys.exit(f"❌ cross-posts/ にサブフォルダがありません: {CROSSPOSTS_ROOT}")
    return dirs[0]


def replace_in_file(path: Path, url: str) -> int:
    """ファイル内のplaceholderを置換し、変更箇所数を返す"""
    text = path.read_text(encoding="utf-8")
    original = text
    for pat in PLACEHOLDER_PATTERNS:
        text = re.sub(pat, url, text)
    if text != original:
        path.write_text(text, encoding="utf-8")
        count = sum(len(re.findall(pat, original)) for pat in PLACEHOLDER_PATTERNS)
        return count
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("url", help="公開後の note 記事URL")
    ap.add_argument("--target-dir", help="cross-posts 配下のサブフォルダパス（省略時は最新）")
    args = ap.parse_args()

    # URL検証
    if not re.match(r"^https://note\.com/[\w_]+/n/[\w]+$", args.url):
        sys.exit(f"❌ URL形式が正しくありません: {args.url}")

    target_dir = Path(args.target_dir) if args.target_dir else find_latest_dir()
    if not target_dir.is_absolute():
        target_dir = ROOT / target_dir
    if not target_dir.exists():
        sys.exit(f"❌ ディレクトリが見つかりません: {target_dir}")

    print(f"📂 対象ディレクトリ: {target_dir}")
    print(f"🔗 置換URL: {args.url}\n")

    total = 0
    for f in sorted(target_dir.iterdir()):
        if not f.is_file() or f.suffix not in {".md", ".json", ".txt"}:
            continue
        count = replace_in_file(f, args.url)
        if count > 0:
            print(f"  ✓ {f.name}: {count}箇所置換")
            total += count
        else:
            print(f"  - {f.name}: 変更なし")

    print(f"\n✅ 完了: 合計 {total} 箇所を置換")


if __name__ == "__main__":
    main()
