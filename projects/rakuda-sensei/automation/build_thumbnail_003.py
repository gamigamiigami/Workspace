#!/usr/bin/env python3
"""
note 記事003「公務員が5年で2,000万貯めた『先取り投資→生活→貯金』の順番」のサムネ生成。
1280x670 PNG。
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parents[1] / "assets" / "thumbnails" / "003-saki-tori-flow.png"

W, H = 1280, 670

FONT_BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
FONT_REG = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"


def font(size: int, bold: bool = True):
    path = FONT_BOLD if bold else FONT_REG
    return ImageFont.truetype(path, size, index=0)


def gradient(w: int, h: int, top, bottom) -> Image.Image:
    img = Image.new("RGB", (w, h), top)
    px = img.load()
    for y in range(h):
        t = y / max(h - 1, 1)
        r = int(top[0] + (bottom[0] - top[0]) * t)
        g = int(top[1] + (bottom[1] - top[1]) * t)
        b = int(top[2] + (bottom[2] - top[2]) * t)
        for x in range(w):
            px[x, y] = (r, g, b)
    return img


def draw_text_centered(draw, text, y, font_obj, fill, w=W):
    bbox = draw.textbbox((0, 0), text, font=font_obj)
    tw = bbox[2] - bbox[0]
    x = (w - tw) // 2
    draw.text((x, y), text, font=font_obj, fill=fill)


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)

    # 深緑→ティールのグラデ（資産形成・安定感）
    img = gradient(W, H, (18, 60, 50), (15, 90, 95))
    d = ImageDraw.Draw(img)

    # 上端: 肩書き
    sub_top = "公務員教員／実家暮らし／5年継続中"
    d_sub = font(28, bold=False)
    bbox = d.textbbox((0, 0), sub_top, font=d_sub)
    sub_w = bbox[2] - bbox[0]
    d.text(((W - sub_w) // 2, 55), sub_top, font=d_sub, fill=(190, 230, 215))

    # キャッチ
    catch = "貯金してから投資、で3年間0円だった私が"
    d_catch = font(36, bold=True)
    bbox = d.textbbox((0, 0), catch, font=d_catch)
    cw = bbox[2] - bbox[0]
    d.text(((W - cw) // 2, 105), catch, font=d_catch, fill=(255, 230, 130))

    # メインタイトル(2行)
    title1 = "先取り投資→生活→貯金"
    title2 = "5年で2,000万貯めた順番"
    d_t1 = font(82, bold=True)
    d_t2 = font(72, bold=True)
    draw_text_centered(d, title1, 180, d_t1, (255, 255, 255))
    draw_text_centered(d, title2, 290, d_t2, (255, 245, 210))

    # 中段ライン
    d.rectangle([(220, 410), (W - 220, 414)], fill=(255, 230, 130))

    # 3バッジ
    badges = [
        ("月15万 NISA 自動積立", (236, 116, 116)),
        ("固定費4.5万 生活10万", (96, 178, 220)),
        ("Excelテンプレ付き", (130, 200, 130)),
    ]
    badge_y = 445
    badge_h = 70
    gap = 25
    fdesc = font(30, bold=True)
    total_w = 0
    bws = []
    for text, _ in badges:
        bbox = d.textbbox((0, 0), text, font=fdesc)
        bw = (bbox[2] - bbox[0]) + 50
        bws.append(bw)
        total_w += bw
    total_w += gap * (len(badges) - 1)
    x = (W - total_w) // 2
    for (text, color), bw in zip(badges, bws):
        d.rounded_rectangle(
            [(x, badge_y), (x + bw, badge_y + badge_h)],
            radius=35, fill=color,
        )
        bbox = d.textbbox((0, 0), text, font=fdesc)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        d.text((x + (bw - tw) // 2, badge_y + (badge_h - th) // 2 - 6), text, font=fdesc, fill=(255, 255, 255))
        x += bw + gap

    # 最下部: 著者
    d_foot = font(28, bold=True)
    foot = "残業嫌いのらくだ先生　／　現役公務員教員"
    bbox = d.textbbox((0, 0), foot, font=d_foot)
    fw = bbox[2] - bbox[0]
    d.text(((W - fw) // 2, 575), foot, font=d_foot, fill=(180, 220, 210))

    # 右下にラクダ絵文字
    d_em = font(60, bold=True)
    d.text((W - 110, H - 110), "🐪", font=d_em, fill=(255, 255, 255))

    img.save(OUT, "PNG", optimize=True)
    print(f"✅ {OUT} ({img.size[0]}×{img.size[1]})")


if __name__ == "__main__":
    main()
