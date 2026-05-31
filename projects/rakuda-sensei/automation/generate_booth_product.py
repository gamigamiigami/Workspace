#!/usr/bin/env python3
"""
BOOTH教材 自動生成スクリプト (GitHub Models版・完全無料)

中学国語の単元ローテーションでAIがワークシートHTMLを自動生成。
HTMLにBOOTH出品メタ情報をコメント埋め込み → post-to-booth が拾って自動出品。

【無料化の仕組み】
GitHub Models (gpt-4o-mini) を GITHUB_TOKEN で呼ぶ。追加課金なし。
"""

import datetime
import os
import re
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

from openai import OpenAI

ROOT = Path(__file__).resolve().parents[3]
PERSONA_PATH = ROOT / "knowledge" / "persona.md"
PRODUCT_PLAYBOOK = ROOT / "knowledge" / "product-playbook.md"
PRODUCTS_DIR = ROOT / "projects" / "rakuda-sensei" / "products"
ROTATION_LOG = PRODUCTS_DIR / ".rotation.log"

GH_MODELS_ENDPOINT = "https://models.github.ai/inference"
MODEL = "openai/gpt-4o-mini"
MAX_TOKENS = 6000
JST = ZoneInfo("Asia/Tokyo")

# 中学国語の単元ローテーション（product-playbook.mdに準拠）
UNITS = [
    {"grade": 1, "topic": "文法・自立語と付属語", "type": "drill", "price": 300},
    {"grade": 1, "topic": "漢字・部首と画数", "type": "drill", "price": 300},
    {"grade": 1, "topic": "古文・歴史的仮名遣い入門", "type": "drill", "price": 500},
    {"grade": 2, "topic": "文法・助動詞の識別", "type": "drill", "price": 500},
    {"grade": 2, "topic": "漢字・同音異義語", "type": "drill", "price": 300},
    {"grade": 2, "topic": "古文・係り結びの法則", "type": "drill", "price": 500},
    {"grade": 3, "topic": "文法・敬語の使い分け", "type": "drill", "price": 500},
    {"grade": 3, "topic": "漢字・四字熟語", "type": "drill", "price": 500},
    {"grade": 3, "topic": "古文・漢文の返り点", "type": "drill", "price": 800},
    {"grade": 0, "topic": "全学年・原稿用紙の使い方", "type": "drill", "price": 300},
    {"grade": 0, "topic": "全学年・接続詞活用ワーク", "type": "drill", "price": 500},
]


def next_unit() -> dict:
    """既存商品と被らない単元を選ぶ"""
    if not ROTATION_LOG.exists():
        return UNITS[0]
    log_text = ROTATION_LOG.read_text(encoding="utf-8") if ROTATION_LOG.exists() else ""
    used = set()
    for line in log_text.splitlines():
        parts = line.strip().split("\t")
        if len(parts) >= 2:
            used.add(parts[1])
    for u in UNITS:
        if u["topic"] not in used:
            return u
    return UNITS[0]  # 全部使い切ったら最初に戻る


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9-]", "", text.lower().replace(" ", "-"))[:40] or "worksheet"


def build_prompt(unit: dict, persona: str, product_pb: str) -> str:
    return f"""あなたは「残業嫌いのらくだ先生🐪」（公立中学校教員・国語）のBOOTH販売用ワークシートを制作します。

==== 今回の単元 ====
対象学年: 中{unit['grade'] if unit['grade'] else '全学年共通'}
単元: {unit['topic']}
価格: ¥{unit['price']}

==== ペルソナ（厳守）====
{persona[:2000]}

==== 商品制作プレイブック ====
{product_pb[:3000]}

==== 必須出力フォーマット ====
完全動作する HTML ファイル を1つだけ出力してください。説明文不要、HTMLのみ。

**HTMLの先頭に以下のコメント形式で出品メタ情報を必ず埋め込む（post-to-boothが自動取得）:**

```html
<!DOCTYPE html>
<!--
BOOTH_TITLE: 中{unit['grade']}国語「{unit['topic']}」ワークシート - らくだ先生
BOOTH_PRICE: {unit['price']}
BOOTH_DESC:
中{unit['grade']}国語の「{unit['topic']}」を効率よくマスターできるワークシート。
基礎5問＋応用5問＋発展5問＋解答＋採点ルーブリック付き。
B4横二つ折り両面印刷推奨。授業の小テスト・宿題・自主学習に。
教員が時短で配れる/採点できる設計。
BOOTH_TAGS: 中学国語,{unit['topic']},ワークシート,教員,教材
-->
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>中{unit['grade']}国語「{unit['topic']}」ワークシート</title>
  <style>
    /* 印刷最適化 + Web表示両対応のCSS */
    @media print {{
      @page {{ size: B4 landscape; margin: 10mm; }}
      body {{ font-family: serif; }}
    }}
    body {{ font-family: serif; max-width: 1200px; margin: 0 auto; padding: 20px; line-height: 1.8; }}
    h1, h2, h3 {{ color: #3D2F1F; }}
    .question {{ margin: 20px 0; padding: 15px; border-left: 4px solid #8B6F47; }}
    .answer-space {{ border-bottom: 1px solid #999; min-height: 30px; margin: 10px 0; }}
    .level-basic {{ background: #FDF6E3; }}
    .level-applied {{ background: #F0E5D0; }}
    .level-advanced {{ background: #E8D5A7; }}
    .answer-key {{ page-break-before: always; background: #F5F5F5; padding: 20px; }}
    .rubric {{ page-break-before: always; }}
    table {{ border-collapse: collapse; width: 100%; margin: 10px 0; }}
    th, td {{ border: 1px solid #999; padding: 8px; text-align: left; }}
    th {{ background: #E8D5A7; }}
  </style>
</head>
<body>
  <header>
    <h1>中{unit['grade']}国語「{unit['topic']}」</h1>
    <p>名前: ＿＿＿＿＿＿＿　学級: ＿＿＿　日付: ＿＿＿＿</p>
  </header>

  <!-- 解説セクション (200-400字程度) -->
  <section>
    <h2>📖 ポイント</h2>
    <p>（単元の核心を中学生にわかる言葉で簡潔に）</p>
  </section>

  <!-- 基礎問題5問 -->
  <section>
    <h2>🟢 基礎問題（各5点・25点満点）</h2>
    <div class="question level-basic">
      （問題1〜5、選択式or穴埋め）
    </div>
  </section>

  <!-- 応用問題5問 -->
  <section>
    <h2>🟡 応用問題（各6点・30点満点）</h2>
    <div class="question level-applied">
      （問題6〜10、記述式中心）
    </div>
  </section>

  <!-- 発展問題5問 -->
  <section>
    <h2>🔴 発展問題（各9点・45点満点）</h2>
    <div class="question level-advanced">
      （問題11〜15、誤答指摘・記述説明）
    </div>
  </section>

  <!-- 解答 -->
  <section class="answer-key">
    <h2>📝 解答</h2>
    <table>
      <tr><th>問</th><th>解答</th><th>配点</th><th>ポイント</th></tr>
      <!-- 15問分 -->
    </table>
  </section>

  <!-- 採点ルーブリック -->
  <section class="rubric">
    <h2>📊 採点ルーブリック</h2>
    <table>
      <tr><th>得点</th><th>到達度</th><th>次のアクション</th></tr>
      <tr><td>90-100</td><td>完璧に理解</td><td>応用問題へ</td></tr>
      <tr><td>70-89</td><td>概ね理解</td><td>誤答箇所を復習</td></tr>
      <tr><td>50-69</td><td>基本のみ理解</td><td>応用は再指導</td></tr>
      <tr><td>0-49</td><td>要再指導</td><td>基礎から</td></tr>
    </table>
  </section>

  <footer style="margin-top: 40px; padding-top: 20px; border-top: 2px solid #8B6F47;">
    <p>制作: 残業嫌いのらくだ先生🐪 / らくだ先生のしごと部屋</p>
    <p>本商品の二次配布・商用利用は禁止します。授業内・校内利用OK。</p>
  </footer>
</body>
</html>
```

==== 制約 ====
- 上記HTMLテンプレートに**実際の問題・解答・解説を全て埋める**こと
- 中学{unit['grade']}年生向けの適切な難易度
- 単元「{unit['topic']}」の典型的な誤答パターンを発展問題に含める
- 問題は教科書準拠（光村・東書・三省堂のいずれでも対応可な内容）
- 「らくだ先生」「ぼく」一人称統一（HTMLコメント内とfooterで）
- ペルソナのNGリスト厳守（特定の生徒・学校名禁止）
- 商品HTMLとして完成形を出力（プレースホルダ（XXX等）残さない）
"""


def main() -> int:
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        print("ERROR: GITHUB_TOKEN が設定されていません", file=sys.stderr)
        return 1

    unit = next_unit()
    print(f"📚 単元: 中{unit['grade']} {unit['topic']} ¥{unit['price']}")

    persona = PERSONA_PATH.read_text(encoding="utf-8") if PERSONA_PATH.exists() else ""
    product_pb = PRODUCT_PLAYBOOK.read_text(encoding="utf-8") if PRODUCT_PLAYBOOK.exists() else ""

    client = OpenAI(base_url=GH_MODELS_ENDPOINT, api_key=token)
    response = client.chat.completions.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        temperature=0.6,  # 教材は正確性重視で低温度
        messages=[
            {"role": "user", "content": build_prompt(unit, persona, product_pb)},
        ],
    )

    body = response.choices[0].message.content or ""
    usage = response.usage

    # HTMLブロックを抽出
    html_match = re.search(r"```html\n(.+?)```", body, re.DOTALL)
    html_content = html_match.group(1) if html_match else body

    # 出力先
    slug = slugify(unit["topic"])
    today = datetime.datetime.now(JST).date()
    dir_name = f"chu{unit['grade']}-{slug}-{today.isoformat()}"
    out_dir = PRODUCTS_DIR / dir_name
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "worksheet.html"

    out_path.write_text(html_content, encoding="utf-8")
    print(f"✅ 商品生成完了: {out_path}")

    # ローテーションログ
    ROTATION_LOG.parent.mkdir(parents=True, exist_ok=True)
    with ROTATION_LOG.open("a", encoding="utf-8") as f:
        f.write(f"{today.isoformat()}\t{unit['topic']}\t¥{unit['price']}\n")

    # 次のワークフロー用
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as f:
            f.write(f"product_path={out_path.relative_to(ROOT)}\n")
            f.write(f"unit={unit['topic']}\n")
            f.write(f"price={unit['price']}\n")

    print(f"🤖 tokens: in={usage.prompt_tokens if usage else '?'} out={usage.completion_tokens if usage else '?'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
