#!/usr/bin/env python3
"""
SNS各種のアイコン・ヘッダー画像を一括生成（PIL・完全無料）

生成物:
- icon-400.png      : 汎用アイコン 400x400 (note / X / Threads / Instagram プロフ用)
- header-x.png      : X ヘッダー 1500x500
- header-note.png   : note ヘッダー 1280x300
- header-ig.png     : Instagram カバー 1080x566
- thumbnail-template.png : note記事サムネテンプレ 1280x670

すべて Noto Sans CJK + らくだブランドカラーで統一感を出す。
"""

import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[3]
OUT_DIR = ROOT / "projects" / "rakuda-sensei" / "assets" / "brand"

# らくだブランドカラー (dashboard/style.css と統一)
BG_CREAM = (253, 246, 227)
BG_BEIGE = (232, 213, 167)
ACCENT = (139, 111, 71)
DARK = (61, 47, 31)
WHITE = (255, 255, 255)
TEXT_MUTED = (107, 93, 79)

FONT_CANDIDATES = [
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def find_font(size: int) -> ImageFont.FreeTypeFont:
    for p in FONT_CANDIDATES:
        if Path(p).exists():
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()


def draw_rakuda_simple(draw: ImageDraw.ImageDraw, cx: int, cy: int, size: int = 100, color=DARK):
    """シンプルなラクダのアイコン（円・楕円・線で構成、絵文字代替）"""
    # 体（楕円）
    body_w, body_h = int(size * 1.2), int(size * 0.7)
    draw.ellipse(
        (cx - body_w // 2, cy - body_h // 4, cx + body_w // 2, cy + body_h * 3 // 4),
        fill=color,
    )
    # こぶ（2つの小さな半円）
    hump_r = int(size * 0.25)
    draw.ellipse(
        (cx - hump_r * 2 - 5, cy - hump_r // 2 - body_h // 4 - hump_r, cx - 5, cy - hump_r // 2 - body_h // 4 + hump_r),
        fill=color,
    )
    draw.ellipse(
        (cx + 5, cy - hump_r // 2 - body_h // 4 - hump_r, cx + hump_r * 2 + 5, cy - hump_r // 2 - body_h // 4 + hump_r),
        fill=color,
    )
    # 首（細長い縦楕円）
    neck_w = int(size * 0.18)
    neck_h = int(size * 0.5)
    neck_cx = cx - body_w // 3
    neck_cy = cy - body_h // 4 - neck_h // 3
    draw.ellipse(
        (neck_cx - neck_w // 2, neck_cy - neck_h // 2, neck_cx + neck_w // 2, neck_cy + neck_h // 2),
        fill=color,
    )
    # 頭（小さい楕円）
    head_w, head_h = int(size * 0.3), int(size * 0.22)
    head_cx = neck_cx - int(size * 0.15)
    head_cy = neck_cy - neck_h // 2 - int(size * 0.05)
    draw.ellipse(
        (head_cx - head_w // 2, head_cy - head_h // 2, head_cx + head_w // 2, head_cy + head_h // 2),
        fill=color,
    )
    # 目（白丸）
    eye_r = max(2, size // 40)
    draw.ellipse(
        (head_cx - head_w // 4, head_cy - eye_r, head_cx - head_w // 4 + eye_r * 2, head_cy + eye_r),
        fill=WHITE,
    )
    # 脚 (4本)
    leg_w = max(3, size // 25)
    leg_h = int(size * 0.35)
    for offset in [-body_w // 3, -body_w // 8, body_w // 8, body_w // 3]:
        lx = cx + offset
        draw.rectangle(
            (lx - leg_w // 2, cy + body_h * 3 // 4 - 5, lx + leg_w // 2, cy + body_h * 3 // 4 + leg_h),
            fill=color,
        )


def make_icon(size: int = 400) -> Image.Image:
    """汎用アイコン: 円形背景にらくだ + 文字"""
    img = Image.new("RGB", (size, size), BG_BEIGE)
    draw = ImageDraw.Draw(img)
    # 円形ベース
    pad = size // 12
    draw.ellipse((pad, pad, size - pad, size - pad), fill=BG_CREAM, outline=ACCENT, width=size // 60)
    # らくだイラスト
    draw_rakuda_simple(draw, cx=size // 2, cy=size * 11 // 20, size=size * 35 // 100, color=ACCENT)
    # 上部テキスト「らくだ先生」
    font = find_font(size * 14 // 100)
    draw.text((size // 2, size * 13 // 100), "らくだ先生", font=font, fill=DARK, anchor="mm")
    return img


def make_header_x(width: int = 1500, height: int = 500) -> Image.Image:
    """X ヘッダー画像"""
    img = Image.new("RGB", (width, height), BG_CREAM)
    draw = ImageDraw.Draw(img)
    # 帯
    draw.rectangle((0, 0, width, height // 5), fill=ACCENT)
    draw.rectangle((0, height * 4 // 5, width, height), fill=ACCENT)
    # メインメッセージ
    msg_font = find_font(60)
    draw.text(
        (width // 2, height // 2 - 50),
        "ICT・AIで残業ゼロ × 副業10万 × 5年で2000万",
        font=msg_font,
        fill=DARK,
        anchor="mm",
    )
    sub_font = find_font(36)
    draw.text(
        (width // 2, height // 2 + 30),
        "教員でも、時間とお金の自由は両立できる🐪",
        font=sub_font,
        fill=ACCENT,
        anchor="mm",
    )
    # らくだ右下
    draw_rakuda_simple(draw, cx=width - 180, cy=height - 110, size=130, color=DARK)
    # ブランド左下
    brand_font = find_font(28)
    draw.text((50, height - 60), "@rakuda_sensei", font=brand_font, fill=WHITE, anchor="lm")
    return img


def make_header_note(width: int = 1280, height: int = 300) -> Image.Image:
    """note ヘッダー画像"""
    img = Image.new("RGB", (width, height), BG_CREAM)
    draw = ImageDraw.Draw(img)
    draw.rectangle((0, height - 12, width, height), fill=ACCENT)
    # 大メッセージ
    font_main = find_font(58)
    draw.text(
        (width // 2, height // 2 - 30),
        "残業嫌いのらくだ先生🐪",
        font=font_main,
        fill=DARK,
        anchor="mm",
    )
    font_sub = find_font(28)
    draw.text(
        (width // 2, height // 2 + 50),
        "教員のセミリタイア実験室 / 無料記事中心",
        font=font_sub,
        fill=TEXT_MUTED,
        anchor="mm",
    )
    draw_rakuda_simple(draw, cx=130, cy=height // 2, size=110, color=ACCENT)
    return img


def make_header_ig(width: int = 1080, height: int = 566) -> Image.Image:
    """Instagram カバー（投稿用画像比率）"""
    img = Image.new("RGB", (width, height), BG_BEIGE)
    draw = ImageDraw.Draw(img)
    # 中央フレーム
    pad = 40
    draw.rectangle((pad, pad, width - pad, height - pad), fill=BG_CREAM, outline=ACCENT, width=6)
    msg_font = find_font(54)
    draw.text(
        (width // 2, height // 2 - 60),
        "教員のセミリタイア実験",
        font=msg_font,
        fill=DARK,
        anchor="mm",
    )
    sub_font = find_font(32)
    draw.text(
        (width // 2, height // 2 + 10),
        "ICT・AI・副業・資産形成",
        font=sub_font,
        fill=ACCENT,
        anchor="mm",
    )
    draw_rakuda_simple(draw, cx=width // 2, cy=height - 130, size=100, color=DARK)
    return img


def make_thumbnail_template(width: int = 1280, height: int = 670) -> Image.Image:
    """note 記事サムネのベーステンプレ (1280x670)"""
    img = Image.new("RGB", (width, height), BG_CREAM)
    draw = ImageDraw.Draw(img)
    # 縦ライン
    draw.rectangle((0, 0, 30, height), fill=ACCENT)
    # 上見出し
    font_h = find_font(82)
    draw.text(
        (80, 90),
        "{記事タイトルを\n  ここに}",
        font=font_h,
        fill=DARK,
    )
    # ブランド
    font_b = find_font(36)
    draw.text(
        (80, height - 110),
        "残業嫌いのらくだ先生🐪",
        font=font_b,
        fill=ACCENT,
    )
    draw_rakuda_simple(draw, cx=width - 180, cy=height - 130, size=180, color=DARK)
    return img


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"📁 出力先: {OUT_DIR}")

    assets = [
        ("icon-400.png", make_icon(400)),
        ("icon-200.png", make_icon(200)),
        ("header-x.png", make_header_x()),
        ("header-note.png", make_header_note()),
        ("header-ig.png", make_header_ig()),
        ("thumbnail-template.png", make_thumbnail_template()),
    ]

    for name, img in assets:
        out_path = OUT_DIR / name
        img.save(out_path, format="PNG", optimize=True)
        print(f"  ✅ {name} ({img.size[0]}x{img.size[1]}, {out_path.stat().st_size // 1024}KB)")

    print(f"\n🎨 ブランド画像 {len(assets)} 枚生成完了")
    return 0


if __name__ == "__main__":
    sys.exit(main())
