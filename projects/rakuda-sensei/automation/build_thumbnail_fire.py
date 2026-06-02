#!/usr/bin/env python3
"""
note記事002 (サイドFIRE計画シート) 用サムネ画像生成
1280×670 (16:9)・Pillowのみで作成（無料）
絵文字はカラー矩形で代用（NotoColorEmojiはPILで安定描画できないため）
"""

from __future__ import annotations
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "projects" / "rakuda-sensei" / "assets" / "thumbnails"
OUT.mkdir(parents=True, exist_ok=True)

W, H = 1280, 670

BG = (245, 240, 230)
BROWN = (139, 111, 71)
DARK = (61, 47, 31)
GREEN = (102, 187, 106)
YELLOW = (255, 245, 157)
WHITE = (255, 255, 255)
GRAY = (120, 120, 120)
LIGHT_GRAY = (220, 220, 220)
BLUE = (179, 229, 252)
PURPLE = (209, 196, 233)
RED_CHECK = (46, 125, 50)

FONT_BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
FONT_REG = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"


def font(size: int, bold: bool = True):
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REG, size)


def center_text(draw, xy, text, fnt, fill):
    box = draw.textbbox((0, 0), text, font=fnt)
    w, h = box[2] - box[0], box[3] - box[1]
    x, y = xy
    draw.text((x - w // 2 - box[0], y - h // 2 - box[1]), text, font=fnt, fill=fill)


def color_chip(draw, cx, cy, color, size=20, outline=None):
    """色見本の四角を描く"""
    half = size // 2
    draw.rounded_rectangle(
        [(cx - half, cy - half), (cx + half, cy + half)],
        radius=4, fill=color, outline=outline or color, width=2,
    )


def build():
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)

    # 左上：ジャンルラベル
    draw.rounded_rectangle([(60, 50), (340, 100)], radius=6, fill=BROWN)
    center_text(draw, (200, 75), "公務員 × 資産形成", font(22), WHITE)

    # メインタイトル
    center_text(draw, (W // 2, 175), "サイドFIRE 達成診断", font(80), DARK)

    # ヒーローバナー風の緑帯
    banner_y = 255
    draw.rounded_rectangle([(140, banner_y), (W - 140, banner_y + 88)],
                           radius=16, fill=GREEN)
    # ✓ アイコン + テキスト
    center_text(draw, (W // 2, banner_y + 44),
                "✓  達成見込み！おめでとう",
                font(38), WHITE)

    # サブコピー
    center_text(draw, (W // 2, 385),
                "公務員夫婦が 5分の入力で 全部わかる",
                font(34), DARK)
    center_text(draw, (W // 2, 430),
                "Excel シート ( 6シート・全11入力 )",
                font(26, bold=False), GRAY)

    # 中段：機能バッジ4つ（絵文字→カラーチップに）
    badge_y = 490
    badges = [
        (YELLOW,  "入力する場所"),
        (GREEN,   "自動計算"),
        (BLUE,    "現金（成長なし）"),
        (PURPLE,  "運用資産（複利）"),
    ]
    badge_w = 260
    total_w = badge_w * 4 + 20 * 3
    start_x = (W - total_w) // 2
    for i, (color, sub) in enumerate(badges):
        x = start_x + i * (badge_w + 20)
        draw.rounded_rectangle([(x, badge_y), (x + badge_w, badge_y + 80)],
                               radius=10, fill=WHITE, outline=LIGHT_GRAY, width=2)
        # 左に色チップ
        color_chip(draw, x + 36, badge_y + 40, color, size=32, outline=GRAY)
        # 右にラベル
        draw.text((x + 70, badge_y + 28),
                  sub, font=font(18), fill=DARK)

    # 下部の帯（クレジット）
    draw.rectangle([(0, H - 50), (W, H)], fill=BROWN)
    draw.text((40, H - 38), "残業嫌いの らくだ先生",
              font=font(22), fill=WHITE)
    right_text = "note.com / rakuda_sensei"
    bbox = draw.textbbox((0, 0), right_text, font=font(20, bold=False))
    tw = bbox[2] - bbox[0]
    draw.text((W - tw - 40, H - 36), right_text,
              font=font(20, bold=False), fill=WHITE)

    out = OUT / "002-side-fire-sheet.png"
    img.save(out, "PNG", optimize=True)
    return out


if __name__ == "__main__":
    out = build()
    print(f"✅ サムネ生成: {out} ({out.stat().st_size // 1024}KB)")
