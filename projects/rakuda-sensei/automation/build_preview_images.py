#!/usr/bin/env python3
"""
note記事002 用 Excelシートプレビュー画像を生成
Pillow のみで作成（無料・LibreOffice 不要）
記事本文中に貼って商品イメージを伝えるため
"""

from __future__ import annotations
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "projects" / "rakuda-sensei" / "assets" / "previews"
OUT.mkdir(parents=True, exist_ok=True)

# Excelシートと同じカラー
BG = (245, 240, 230)
WHITE = (255, 255, 255)
DARK = (61, 47, 31)
GRAY = (130, 130, 130)
LIGHT_GRAY = (235, 235, 235)
BORDER_GRAY = (200, 200, 200)
HEADER_BROWN = (139, 111, 71)
HERO_GREEN = (102, 187, 106)
OUTPUT_GREEN = (165, 214, 167)
INPUT_YELLOW = (255, 245, 157)
SAVINGS_BLUE = (179, 229, 252)
INVEST_PURPLE = (209, 196, 233)
ACCENT_RED = (211, 47, 47)
SECTION_BEIGE = (232, 213, 167)

FONT_BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
FONT_REG = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"


def f(size: int, bold: bool = False):
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REG, size)


def draw_cell(draw, x, y, w, h, fill=WHITE, outline=BORDER_GRAY, outline_w=1):
    draw.rectangle([(x, y), (x + w, y + h)], fill=fill, outline=outline, width=outline_w)


def draw_text(draw, x, y, text, font, fill=DARK, anchor="lt"):
    draw.text((x, y), text, font=font, fill=fill, anchor=anchor)


def draw_center(draw, cx, cy, text, font, fill=DARK):
    bbox = draw.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    draw.text((cx - w // 2 - bbox[0], cy - h // 2 - bbox[1]), text, font=font, fill=fill)


def title_bar(draw, y, text, w=1080, h=44):
    draw.rectangle([(0, y), (w, y + h)], fill=HEADER_BROWN)
    draw_center(draw, w // 2, y + h // 2, text, f(20, bold=True), fill=WHITE)


def section_bar(draw, y, text, w=1080, h=36, x_start=20):
    draw.rectangle([(x_start, y), (w - 20, y + h)], fill=SECTION_BEIGE, outline=BORDER_GRAY)
    draw_text(draw, x_start + 14, y + h // 2 - 11, text, f(16, bold=True), fill=HEADER_BROWN)


# =======================================================================
def build_conclusion_preview() -> Path:
    """結論シート：ヒーローバナー + Step 1〜5 のサマリ"""
    W, H = 1080, 1400
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)

    # シートタブ風 (上部)
    title_bar(draw, 0, "🎯 結論｜あなたのサイドFIRE達成診断")

    # ▼ヒーローバナー (緑の大きい結果表示) ▼
    hero_y = 70
    draw.rounded_rectangle([(30, hero_y), (W - 30, hero_y + 50)],
                           radius=4, fill=HERO_GREEN)
    draw_center(draw, W // 2, hero_y + 25, "🎉 サイドFIRE 達成可否",
                f(18, bold=True), fill=WHITE)
    # 判定セル
    draw.rounded_rectangle([(30, hero_y + 56), (W - 30, hero_y + 156)],
                           radius=4, fill=HERO_GREEN)
    draw_center(draw, W // 2, hero_y + 106, "✓ 達成見込み！おめでとう🐪",
                f(42, bold=True), fill=WHITE)

    # ▼Step 1: 必要総資産▼
    y = 260
    section_bar(draw, y, "Step 1: 必要な総資産を計算（4%ルール）")
    y += 46
    rows1 = [
        ("FIRE後の年生活費", "3,936,000円", "393万円", False),
        ("FIRE後の年副業収入", "1,200,000円", "120万円", False),
        ("資産取崩しが必要な年額", "2,736,000円", "274万円", False),
        ("💡 サイドFIRE 必要総資産", "68,400,000円", "6,840万円", True),
    ]
    for label, val, man, is_result in rows1:
        bg = OUTPUT_GREEN if is_result else WHITE
        draw.rectangle([(40, y), (380, y + 32)], fill=WHITE, outline=BORDER_GRAY)
        draw.rectangle([(380, y), (620, y + 32)], fill=bg, outline=BORDER_GRAY)
        draw.rectangle([(620, y), (820, y + 32)], fill=(250, 250, 250), outline=BORDER_GRAY)
        draw_text(draw, 50, y + 7, label, f(15, bold=is_result))
        draw_text(draw, 610, y + 7, val, f(15, bold=is_result), anchor="rt")
        draw_text(draw, 810, y + 7, man, f(15, bold=is_result), fill=(60, 120, 60), anchor="rt")
        y += 32

    # ▼Step 2: 達成時資産▼
    y += 20
    section_bar(draw, y, "Step 2: 目標年齢時に達成できる資産")
    y += 46
    rows2 = [
        ("目標FIREまでの年数", "18年", "", False, None),
        ("💧 目標年齢時の貯金（成長なし）", "500,000円", "50万円", False, SAVINGS_BLUE),
        ("📈 目標年齢時の運用資産（複利）", "54,260,000円", "5,426万円", False, INVEST_PURPLE),
        ("💰 目標年齢時の予想総資産", "54,760,000円", "5,476万円", True, None),
    ]
    for label, val, man, is_result, color in rows2:
        bg = OUTPUT_GREEN if is_result else (color if color else WHITE)
        draw.rectangle([(40, y), (380, y + 32)], fill=WHITE, outline=BORDER_GRAY)
        draw.rectangle([(380, y), (620, y + 32)], fill=bg, outline=BORDER_GRAY)
        draw.rectangle([(620, y), (820, y + 32)], fill=(250, 250, 250), outline=BORDER_GRAY)
        draw_text(draw, 50, y + 7, label, f(15, bold=is_result))
        draw_text(draw, 610, y + 7, val, f(15, bold=is_result), anchor="rt")
        draw_text(draw, 810, y + 7, man, f(15, bold=is_result), fill=(60, 120, 60), anchor="rt")
        y += 32

    # ▼Step 5: ここを動かせば達成▼
    y += 25
    section_bar(draw, y, "Step 5: ここを動かせば達成できる（自動計算）")
    y += 46
    # テーブルヘッダ
    headers = ["変える項目", "現状", "→ 達成ライン", "一言メモ"]
    widths = [240, 180, 200, 380]
    cx = 40
    for hdr, w in zip(headers, widths):
        draw.rectangle([(cx, y), (cx + w, y + 30)], fill=HEADER_BROWN, outline=HEADER_BROWN)
        draw_center(draw, cx + w // 2, y + 15, hdr, f(14, bold=True), fill=WHITE)
        cx += w
    y += 30
    # データ行
    rows5 = [
        ("A. 月積立を増やす",        "15.0万円/月", "22.0万円/月", "投資への月積立額"),
        ("B. FIRE開始年齢を遅らせる", "45歳",        "52歳",        "資産が貯まる年齢まで働く"),
        ("C. FIRE後副業を増やす",    "10.0万円/月", "14.5万円/月", "セミリタイア後の月収"),
        ("D. FIRE後生活費を下げる",  "32.8万円/月", "28.0万円/月", "『生活費』シートで調整"),
    ]
    for row in rows5:
        cx = 40
        for i, (cell, w) in enumerate(zip(row, widths)):
            bg = OUTPUT_GREEN if i == 2 else WHITE
            draw.rectangle([(cx, y), (cx + w, y + 32)], fill=bg, outline=BORDER_GRAY)
            if i == 0 or i == 3:
                draw_text(draw, cx + 10, y + 8, cell, f(14))
            else:
                draw_center(draw, cx + w // 2, y + 16, cell, f(14, bold=(i == 2)))
            cx += w
        y += 32

    # フッター注釈
    y += 30
    draw_center(draw, W // 2, y, "🟡入力セル → 🟢自動計算 → 答えが一発で見える",
                f(14), fill=GRAY)

    out = OUT / "preview-01-conclusion.png"
    img.save(out, "PNG", optimize=True)
    return out


# =======================================================================
def build_input_preview() -> Path:
    """入力シート：11項目の黄色入力欄"""
    W, H = 1080, 1200
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)

    title_bar(draw, 0, "入力｜🟡黄色セルだけ書き換える")
    draw_center(draw, W // 2, 90, "全11項目・5分で埋まる / 値の右に万円表示",
                f(14), fill=GRAY)

    # セクション群
    y = 130
    sections = [
        ("👤 基本情報", [
            ("現在年齢", "27", "歳", None, None),
            ("目標 FIRE 年齢", "45", "歳", None, None),
        ]),
        ("💰 夫婦の月収入", [
            ("夫婦の月手取り合計", "450,000", "円", "45万円", "(2人の手取り合計)"),
            ("夫婦のボーナス年合計", "1,600,000", "円", "160万円", "(年ボーナス手取り合計)"),
            ("🔢 年手取り合計", "7,000,000", "円", "700万円", "(自動)"),
        ]),
        ("💸 月の生活費（『生活費』シートから自動反映）", [
            ("月生活費（現在）", "322,000", "円", "32万円", "← 編集は『生活費』シート"),
            ("🔢 月貯蓄可能額", "128,000", "円", "13万円", "(月収 − 月生活費)"),
        ]),
        ("🏦 今ある資産（貯金と運用を分けて入力）", [
            ("現在の貯金（現金・利率0%）", "500,000", "円", "50万円", "(銀行預金など)", SAVINGS_BLUE),
            ("現在の運用資産（投資・年利成長）", "15,000,000", "円", "1,500万円", "(NISA/iDeCo)", INVEST_PURPLE),
            ("🔢 総資産（現在）", "15,500,000", "円", "1,550万円", None),
        ]),
        ("📈 投資設定", [
            ("月積立額", "150,000", "円", "15万円", "(NISA+iDeCo合計)"),
            ("想定年利", "5.0%", "", None, "(オルカン+SP500で5-6%)"),
        ]),
    ]

    for sec_title, rows in sections:
        section_bar(draw, y, sec_title)
        y += 42
        for row in rows:
            label = row[0]
            val = row[1]
            unit = row[2]
            man = row[3]
            note = row[4]
            color = row[5] if len(row) > 5 else None
            is_input = "🔢" not in label  # 計算結果でなければ入力セル
            # ラベル
            draw_text(draw, 50, y + 8, label, f(14, bold=is_input))
            # 値セル (yellow if input)
            bg = INPUT_YELLOW if is_input else WHITE
            if color is not None:
                bg = color
            draw.rectangle([(440, y), (640, y + 32)], fill=bg, outline=(160, 130, 50), width=2)
            draw_text(draw, 630, y + 8, f"{val}{unit}", f(15, bold=True), anchor="rt")
            # 万円表示
            if man:
                draw.rectangle([(650, y), (790, y + 32)], fill=(250, 250, 250), outline=BORDER_GRAY)
                draw_text(draw, 780, y + 8, man, f(13, bold=True), fill=(60, 120, 60), anchor="rt")
            # ノート
            if note:
                draw_text(draw, 800, y + 8, note, f(12), fill=GRAY)
            y += 36
        y += 16

    # 凡例
    y += 10
    legend_y = y
    draw_center(draw, W // 2, legend_y, "🟡黄色＝入力する場所 / 💧青＝現金 / 🟣紫＝運用資産 / 🟢緑＝自動計算",
                f(13), fill=GRAY)

    out = OUT / "preview-02-input.png"
    img.save(out, "PNG", optimize=True)
    return out


# =======================================================================
def build_living_preview() -> Path:
    """生活費シート：項目別の月額入力"""
    W, H = 1080, 1100
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)

    title_bar(draw, 0, "生活費｜月の家計内訳")
    draw_center(draw, W // 2, 90, "🟡黄色セルに金額入力 → 合計が『入力』シートに自動反映",
                f(14), fill=GRAY)

    y = 130
    section_bar(draw, y, "📌 今の月の生活費（現在）")
    y += 42

    # ヘッダ
    cols = [("項目", 280), ("月額", 200), ("万円表示", 140), ("備考", 360)]
    cx = 40
    for hdr, w in cols:
        draw.rectangle([(cx, y), (cx + w, y + 32)], fill=HEADER_BROWN, outline=HEADER_BROWN)
        draw_center(draw, cx + w // 2, y + 16, hdr, f(14, bold=True), fill=WHITE)
        cx += w
    y += 32

    items = [
        ("住居費", "90,000円", "9万円", "家賃・住宅ローン・管理費"),
        ("食費", "80,000円", "8万円", "自炊中心＋外食少し"),
        ("水道光熱費", "22,000円", "2万円", "電気・ガス・水道"),
        ("通信費", "18,000円", "2万円", "スマホ＋ネット"),
        ("日用品", "12,000円", "1万円", "消耗品・雑貨"),
        ("交通費", "20,000円", "2万円", "車・公共交通"),
        ("医療・保険", "15,000円", "2万円", "医療費＋保険料"),
        ("娯楽・交際費", "25,000円", "3万円", "レジャー・外食"),
        ("社会保険料", "40,000円", "4万円", "国保・年金等"),
        ("教育費", "0円", "-円", "子どもがいる場合のみ"),
        ("その他", "0円", "-円", "雑費"),
    ]
    for label, val, man, memo in items:
        cx = 40
        cells = [
            (label, 280, "left", f(14)),
            (val, 200, "right", f(14, bold=True)),
            (man, 140, "right", f(13, bold=True)),
            (memo, 360, "left", f(12)),
        ]
        for cell, w, align, font in cells:
            bg = INPUT_YELLOW if w == 200 else WHITE
            draw.rectangle([(cx, y), (cx + w, y + 30)], fill=bg, outline=BORDER_GRAY)
            color = (60, 120, 60) if w == 140 else (GRAY if w == 360 else DARK)
            if align == "right":
                draw_text(draw, cx + w - 12, y + 7, cell, font, fill=color, anchor="rt")
            else:
                draw_text(draw, cx + 12, y + 7, cell, font, fill=color)
            cx += w
        y += 30

    # 合計行
    cx = 40
    draw.rectangle([(cx, y), (cx + 280, y + 36)], fill=OUTPUT_GREEN, outline=BORDER_GRAY)
    draw_text(draw, cx + 12, y + 10, "🔢 合計（月）", f(16, bold=True))
    cx += 280
    draw.rectangle([(cx, y), (cx + 200, y + 36)], fill=OUTPUT_GREEN, outline=BORDER_GRAY)
    draw_text(draw, cx + 188, y + 10, "322,000円", f(16, bold=True), anchor="rt")
    cx += 200
    draw.rectangle([(cx, y), (cx + 140, y + 36)], fill=OUTPUT_GREEN, outline=BORDER_GRAY)
    draw_text(draw, cx + 128, y + 10, "32万円", f(15, bold=True), fill=(40, 100, 40), anchor="rt")
    cx += 140
    draw.rectangle([(cx, y), (cx + 360, y + 36)], fill=OUTPUT_GREEN, outline=BORDER_GRAY)
    draw_text(draw, cx + 12, y + 10, "← この値が『入力』シートに自動反映", f(12, bold=True), fill=ACCENT_RED)
    y += 60

    # 補足
    draw_center(draw, W // 2, y, "「FIRE後の生活費」も同じ表でもう1セット入力可", f(14, bold=True), fill=GRAY)
    y += 30
    draw_center(draw, W // 2, y, "→ 社会保険料が消える・医療費が増える等の違いを反映できる", f(12), fill=GRAY)

    out = OUT / "preview-03-living.png"
    img.save(out, "PNG", optimize=True)
    return out


# =======================================================================
def build_yearly_preview() -> Path:
    """年次推移シート：年齢×資産の表"""
    W, H = 1080, 1100
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)

    title_bar(draw, 0, "📊 年次推移｜年齢別の資産")
    draw_center(draw, W // 2, 90, "現状ペース継続したら各年齢でいくら？", f(14), fill=GRAY)

    y = 130
    section_bar(draw, y, "0〜40年後の予測（一部抜粋）")
    y += 42

    # ヘッダ
    cols = [("年齢", 100), ("経過", 100), ("💧貯金", 160), ("📈運用FV", 180),
            ("💰総資産", 180), ("万円表示", 130), ("必要資産との差", 180)]
    cx = 30
    for hdr, w in cols:
        draw.rectangle([(cx, y), (cx + w, y + 32)], fill=HEADER_BROWN, outline=HEADER_BROWN)
        draw_center(draw, cx + w // 2, y + 16, hdr, f(13, bold=True), fill=WHITE)
        cx += w
    y += 32

    # 行データ（実際のFV計算に近い値）
    rows = [
        ("27歳", "0年後",  "50万円", "150万円",   "200万円",   "200万円",   "-6,640万円"),
        ("30歳", "3年後",  "50万円", "858万円",   "908万円",   "908万円",   "-5,932万円"),
        ("35歳", "8年後",  "50万円", "1,997万円", "2,047万円", "2,047万円", "-4,793万円"),
        ("40歳", "13年後", "50万円", "3,439万円", "3,489万円", "3,489万円", "-3,351万円"),
        ("45歳", "18年後", "50万円", "5,426万円", "5,476万円", "5,476万円", "-1,364万円"),
        ("47歳", "20年後", "50万円", "6,418万円", "6,468万円", "6,468万円", "-372万円"),
        ("48歳", "21年後", "50万円", "6,946万円", "6,996万円", "6,996万円", "+156万円"),
        ("50歳", "23年後", "50万円", "7,729万円", "7,779万円", "7,779万円", "+939万円"),
        ("55歳", "28年後", "50万円", "10,275万円", "10,325万円", "1億325万円", "+3,485万円"),
        ("60歳", "33年後", "50万円", "13,564万円", "13,614万円", "1億3,614万円", "+6,774万円"),
    ]
    for i, row in enumerate(rows):
        cx = 30
        widths = [w for _, w in cols]
        for j, (cell, w) in enumerate(zip(row, widths)):
            # セルカラー
            if j == 2:  # 貯金
                bg = SAVINGS_BLUE
            elif j == 3:  # 運用FV
                bg = INVEST_PURPLE
            elif j == 6:  # 差
                bg = WHITE
            else:
                bg = WHITE
            draw.rectangle([(cx, y), (cx + w, y + 30)], fill=bg, outline=BORDER_GRAY)
            # 差は赤字/緑字
            color = DARK
            if j == 6:
                color = ACCENT_RED if cell.startswith("-") else (40, 130, 40)
            # 達成行は背景を緑
            if "+" in row[6]:
                # 軽く緑帯（行全体）
                pass  # キープ
            if j in (0, 1):
                draw_center(draw, cx + w // 2, y + 14, cell, f(13, bold=(j == 0)))
            else:
                draw_text(draw, cx + w - 10, y + 7, cell, f(13, bold=True), fill=color, anchor="rt")
            cx += w
        y += 30

    # 達成ライン強調
    y += 30
    draw.rectangle([(30, y), (W - 30, y + 50)], fill=HERO_GREEN)
    draw_center(draw, W // 2, y + 25, "🎯 47-48歳で必要資産 6,840万円を超える＝サイドFIRE達成ライン",
                f(15, bold=True), fill=WHITE)

    out = OUT / "preview-04-yearly.png"
    img.save(out, "PNG", optimize=True)
    return out


# =======================================================================
if __name__ == "__main__":
    print("Excelシート プレビュー画像を生成します...")
    for builder in [build_conclusion_preview, build_input_preview,
                     build_living_preview, build_yearly_preview]:
        out = builder()
        size_kb = out.stat().st_size // 1024
        print(f"  ✓ {out.name} ({size_kb}KB)")
    print(f"\n保存先: {OUT}")
