#!/usr/bin/env python3
"""
Instagram投稿画像 自動生成スクリプト (Pillow版・完全無料)

ツイート本文を1080x1080のInstagram画像に変換。
ラクダブランドカラー + 日本語フォント (Noto Sans CJK) で統一感。
GitHub Pages配信前提でdashboard/assets/posts/ に保存。

【無料化の仕組み】
- Pillow: PIL fork (HPND license・¥0)
- Noto Sans CJK: SIL Open Font License (¥0)
- GitHub Pages画像ホスティング (¥0)
"""

import os
import sys
import textwrap
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[3]
ASSETS_DIR = ROOT / "projects" / "rakuda-sensei" / "dashboard" / "assets" / "posts"

# らくだブランドカラー
BG_CREAM = (253, 246, 227)
BG_BEIGE = (232, 213, 167)
ACCENT = (139, 111, 71)
TEXT_DARK = (61, 47, 31)
TEXT_MUTED = (107, 93, 79)
WHITE = (255, 255, 255)

# 日本語フォントパス候補
FONT_CANDIDATES = [
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/Library/Fonts/Arial Unicode.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",  # fallback
]


def find_font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    print("WARNING: 日本語フォントが見つかりません。デフォルトフォント使用", file=sys.stderr)
    return ImageFont.load_default()


def wrap_japanese(text: str, max_chars_per_line: int = 14) -> list[str]:
    """日本語テキストを文字数で折り返す"""
    lines = []
    for paragraph in text.split("\n"):
        if not paragraph.strip():
            lines.append("")
            continue
        chunks = textwrap.wrap(
            paragraph,
            width=max_chars_per_line,
            break_long_words=True,
            break_on_hyphens=False,
        )
        lines.extend(chunks if chunks else [""])
    return lines


def create_post_image(text: str, output_path: Path, header: str = "残業嫌いのらくだ先生🐪") -> Path:
    """1080x1080 Instagram用画像を生成"""
    SIZE = 1080
    img = Image.new("RGB", (SIZE, SIZE), color=BG_CREAM)
    draw = ImageDraw.Draw(img)

    # ボーダー
    draw.rectangle([(30, 30), (SIZE - 30, SIZE - 30)], outline=ACCENT, width=8)

    # ヘッダー帯
    header_height = 120
    draw.rectangle([(30, 30), (SIZE - 30, 30 + header_height)], fill=ACCENT)
    header_font = find_font(40)
    draw.text(
        (SIZE / 2, 30 + header_height / 2),
        header,
        font=header_font,
        fill=WHITE,
        anchor="mm",
    )

    # メインテキスト（中央配置）
    # ハッシュタグ部分とそれ以外を分離
    main_text = text
    tags = ""
    if "\n\n" in text and "#" in text.split("\n\n")[-1]:
        parts = text.rsplit("\n\n", 1)
        main_text = parts[0]
        tags = parts[1]

    body_font = find_font(48)
    lines = wrap_japanese(main_text, 16)

    # 行間計算
    line_height = 70
    total_height = len(lines) * line_height
    start_y = (SIZE - total_height) / 2 - 50  # 中央より少し上

    for i, line in enumerate(lines):
        draw.text(
            (SIZE / 2, start_y + i * line_height),
            line,
            font=body_font,
            fill=TEXT_DARK,
            anchor="mm",
        )

    # フッター: ブランド名 + タグ
    footer_y = SIZE - 120
    footer_font = find_font(28)
    if tags:
        tag_lines = wrap_japanese(tags, 30)
        for i, t in enumerate(tag_lines[:2]):
            draw.text((SIZE / 2, footer_y - 30 + i * 35), t, font=footer_font, fill=TEXT_MUTED, anchor="mm")

    brand_font = find_font(24)
    draw.text(
        (SIZE / 2, SIZE - 60),
        "@rakuda_sensei / らくだ先生のしごと部屋",
        font=brand_font,
        fill=ACCENT,
        anchor="mm",
    )

    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    img.save(output_path, format="PNG", optimize=True)
    print(f"✅ 画像生成: {output_path} ({output_path.stat().st_size // 1024}KB)")
    return output_path


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python generate_instagram_image.py <text> <output_path>", file=sys.stderr)
        sys.exit(1)
    text = sys.argv[1]
    out = Path(sys.argv[2])
    if not out.is_absolute():
        out = ROOT / out
    create_post_image(text, out)
