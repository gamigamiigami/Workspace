#!/usr/bin/env python3
"""
note 記事002「公務員夫婦のサイドFIRE達成診断シート」のサムネ生成。
1280x670 PNG。記事内容ベースで「何の記事か」「クリックしたくなる」を両立。
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parents[1] / "assets" / "thumbnails" / "002-side-fire-sheet.png"

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

    # 紺→深いティールのグラデ（信頼感・夜空のような落ち着き）
    img = gradient(W, H, (28, 42, 79), (15, 76, 95))
    d = ImageDraw.Draw(img)

    # 上端: 小さい肩書き
    sub_top = "公務員夫婦／共働きFPもFP本も読まずに半年で組んだ"
    d_sub = font(28, bold=False)
    bbox = d.textbbox((0, 0), sub_top, font=d_sub)
    sub_w = bbox[2] - bbox[0]
    d.text(((W - sub_w) // 2, 60), sub_top, font=d_sub, fill=(190, 215, 230))

    # 中央上: 強調キャッチ「あと何年、働く？」
    catch = "あと何年、働くか分からない夫婦へ。"
    d_catch = font(38, bold=True)
    bbox = d.textbbox((0, 0), catch, font=d_catch)
    cw = bbox[2] - bbox[0]
    d.text(((W - cw) // 2, 110), catch, font=d_catch, fill=(255, 230, 130))

    # メインタイトル(2行)
    title1 = "サイドFIRE達成診断シート"
    title2 = "5分入力で「答え」が出る"
    d_t1 = font(78, bold=True)
    d_t2 = font(96, bold=True)
    draw_text_centered(d, title1, 195, d_t1, (255, 255, 255))
    draw_text_centered(d, title2, 295, d_t2, (255, 245, 210))

    # 中段ライン
    d.rectangle([(220, 425), (W - 220, 429)], fill=(255, 230, 130))

    # 下段: 3バッジ（記事の中身が分かる）
    badges = [
        ("11項目入れるだけ", (236, 116, 116)),
        ("達成率を自動算出", (96, 178, 220)),
        ("不足は4択で提示", (130, 200, 130)),
    ]
    badge_y = 460
    badge_h = 70
    gap = 30
    fdesc = font(34, bold=True)
    total_w = 0
    bws = []
    for text, _ in badges:
        bbox = d.textbbox((0, 0), text, font=fdesc)
        bw = (bbox[2] - bbox[0]) + 60
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
    foot = "残業嫌いのらくだ先生　／　現役公務員夫婦"
    bbox = d.textbbox((0, 0), foot, font=d_foot)
    fw = bbox[2] - bbox[0]
    d.text(((W - fw) // 2, 580), foot, font=d_foot, fill=(180, 210, 225))

    # 右下にラクダ絵文字代替の小マーク（フリーで安全）
    d_em = font(60, bold=True)
    d.text((W - 110, H - 110), "🐪", font=d_em, fill=(255, 255, 255))

    img.save(OUT, "PNG", optimize=True)
    print(f"✅ {OUT} ({img.size[0]}×{img.size[1]})")


if __name__ == "__main__":
    main()
