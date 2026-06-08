#!/usr/bin/env python3
"""
note 記事004 (無料・集客記事) サムネ
1280x670 PNG
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parents[1] / "assets" / "thumbnails" / "004-free-koumuin-15man.png"
W, H = 1280, 670

FONT_BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
FONT_REG = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"


def font(size, bold=True):
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REG, size, index=0)


def gradient(w, h, top, bottom):
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


def centered(draw, text, y, fnt, fill):
    bbox = draw.textbbox((0, 0), text, font=fnt)
    x = (W - (bbox[2] - bbox[0])) // 2
    draw.text((x, y), text, font=fnt, fill=fill)


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    # 暖色オレンジ→マゼンタ (無料・親しみ・読みやすさ)
    img = gradient(W, H, (199, 70, 30), (140, 30, 90))
    d = ImageDraw.Draw(img)

    sub = "公務員教員 27歳 実家暮らし 5年継続"
    fsub = font(28, bold=False)
    bbox = d.textbbox((0, 0), sub, font=fsub)
    d.text(((W - (bbox[2] - bbox[0])) // 2, 50), sub, font=fsub, fill=(255, 220, 180))

    catch = "月15万NISA積立を5年やったら"
    fc = font(40, bold=True)
    centered(d, catch, 100, fc, (255, 245, 180))

    title1 = "投信1,075万"
    title2 = "5年で2,000万まで来た話"
    centered(d, title1, 175, font(110, bold=True), (255, 255, 255))
    centered(d, title2, 310, font(60, bold=True), (255, 245, 220))

    d.rectangle([(220, 420), (W - 220, 424)], fill=(255, 230, 130))

    badges = [
        ("無料 / 全公開", (96, 178, 220)),
        ("リアル数字", (130, 200, 130)),
        ("実家月3万から", (255, 180, 70)),
    ]
    y = 455
    h = 70
    gap = 28
    fdesc = font(30, bold=True)
    bws = []
    total_w = 0
    for text, _ in badges:
        bbox = d.textbbox((0, 0), text, font=fdesc)
        bw = (bbox[2] - bbox[0]) + 50
        bws.append(bw)
        total_w += bw
    total_w += gap * (len(badges) - 1)
    x = (W - total_w) // 2
    for (text, color), bw in zip(badges, bws):
        d.rounded_rectangle([(x, y), (x + bw, y + h)], radius=35, fill=color)
        bbox = d.textbbox((0, 0), text, font=fdesc)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        d.text((x + (bw - tw) // 2, y + (h - th) // 2 - 6), text, font=fdesc, fill=(255, 255, 255))
        x += bw + gap

    foot = "残業嫌いのらくだ先生　／　無料公開記事"
    ff = font(28, bold=True)
    bbox = d.textbbox((0, 0), foot, font=ff)
    d.text(((W - (bbox[2] - bbox[0])) // 2, 580), foot, font=ff, fill=(255, 220, 180))
    d.text((W - 110, H - 110), "🐪", font=font(60, bold=True), fill=(255, 255, 255))

    img.save(OUT, "PNG", optimize=True)
    print(f"✅ {OUT}")


if __name__ == "__main__":
    main()
