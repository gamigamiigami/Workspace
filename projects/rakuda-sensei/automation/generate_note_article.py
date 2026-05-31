#!/usr/bin/env python3
"""
note記事 自動生成スクリプト (GitHub Models版・完全無料)

3本柱（柱A: ICT時短 / 柱B: 資産形成 / 柱C: バイブコーディング）を
ローテーションしながら、AIが完全な販売記事を生成する。

入力: persona.md + sns-playbook.md + note-writer skill + 直近の生成履歴 + 月次PDCAレポート
出力: projects/rakuda-sensei/articles/{YYYY-MM-DD}-{slug}.md
      ↓ post-to-note ワークフローが拾って自動投稿

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
PLAYBOOK_PATH = ROOT / "knowledge" / "sns-playbook.md"
PRODUCT_PLAYBOOK = ROOT / "knowledge" / "product-playbook.md"
VOICE_PATH = ROOT / "knowledge" / "voice-and-style.md"  # 最優先参照
SALES_PATH = ROOT / "knowledge" / "sales-playbook.md"  # 売れる記事戦略
NOTE_SKILL = ROOT / ".claude" / "skills" / "note-writer" / "SKILL.md"
ARTICLES_DIR = ROOT / "projects" / "rakuda-sensei" / "articles"
REPORTS_DIR = ROOT / "projects" / "rakuda-sensei" / "reports"
ROTATION_LOG = ROOT / "projects" / "rakuda-sensei" / "articles" / ".rotation.log"

GH_MODELS_ENDPOINT = "https://models.github.ai/inference"
MODEL = "openai/gpt-4o-mini"
MAX_TOKENS = 8192
JST = ZoneInfo("Asia/Tokyo")

# 3本柱のテーマ定義
PILLARS = {
    "A": {
        "name": "ICT・AI活用で校務時短",
        "tags": "#教員のバトン #働き方改革 #ChatGPT活用",
        "topics": [
            "校務でChatGPTをこう使ってる5つの場面",
            "Excel関数で成績処理を30分→5分にした方法",
            "Google Formsで保護者連絡を効率化",
            "Claude Codeで授業準備を半分に",
            "教員のためのAIプロンプトテンプレ20",
            "Notion×教員: 校務管理を一元化",
            "音声入力で所見作成を3倍速に",
            "PowerAutomateで定型業務を全自動化",
        ],
        "price_range": (300, 980),
    },
    "B": {
        "name": "公務員×資産形成・節約",
        "tags": "#公務員 #資産形成 #つみたてNISA",
        "topics": [
            # === フェーズ1: 集中強化4本（sales-playbook.md 戦略決定） ===
            "公務員が5年で2000万貯めた｜オルカン80%・実家暮らしの全戦略",
            "日本株デイトレで-50万｜失敗から学んだ低リスク投資配分",
            "20代公務員の家計簿全公開｜支出10万で月30万貯金する仕組み",
            "教員×つみたてNISA｜共働き予定夫婦のFIREロードマップ",
            # === フェーズ2: ローテ用ストック ===
            "iDeCo使わない公務員の選択｜つみたてNISAだけで十分な理由",
            "公務員共済貯金を最大限活用する方法",
            "節約Tips30: 月3万浮かせた具体策",
            "教員の手取りを最適化する控除術",
            "20代公務員のFIREロードマップ",
            "ふるさと納税で得する公務員設計",
            "バリスタファイアを目指す夫婦のお金会議テンプレ",
        ],
        "price_range": (500, 980),
    },
    "C": {
        "name": "教育ゲーム制作・バイブコーディング",
        "tags": "#教育ゲーム #バイブコーディング #ClaudeCode",
        "topics": [
            "教員が0から作るAI共作教育ゲーム入門",
            "Claude Codeで漢字ゲームを30分で作る",
            "iPad対応HTML5ゲームの作り方",
            "プログラミング未経験教員のためのバイブコーディング",
            "教材の自作と販売: 知財・規約・収益化",
            "AIに頼って国語ゲーム10本作った話",
            "授業で使えるWebアプリの内製化",
            "教育ゲーム販売の収益公開",
        ],
        "price_range": (500, 1800),
    },
}


def next_pillar() -> str:
    """
    柱B（公務員×資産形成）集中強化戦略（2026-05-31 sales-playbook.md準拠）:
      - 最初の4本: 全てB（ブランド確立）
      - 5本目以降: B → A → B → C → B → A → B → C ... (B 50% / A 25% / C 25%)
    """
    if not ROTATION_LOG.exists():
        return "B"
    lines = [l.strip() for l in ROTATION_LOG.read_text(encoding="utf-8").splitlines() if l.strip()]
    history = [l.split("\t")[-1] for l in lines]
    n = len(history)

    # フェーズ1: 最初の4本は全てB
    if n < 4:
        return "B"

    # フェーズ2: B重視ローテ (B→A→B→C 4本サイクル)
    phase2_cycle = ["B", "A", "B", "C"]
    return phase2_cycle[(n - 4) % 4]


def used_topics() -> list[str]:
    """既に生成済みのトピックを取得"""
    if not ARTICLES_DIR.exists():
        return []
    topics = []
    for f in ARTICLES_DIR.glob("*.md"):
        if f.name.startswith("."):
            continue
        text = f.read_text(encoding="utf-8")
        title_m = re.search(r"\|\s*\*\*タイトル\*\*\s*\|\s*(.+?)\s*\|", text)
        if title_m:
            topics.append(title_m.group(1).strip())
    return topics


def pick_topic(pillar: str, used: list[str]) -> str:
    """その柱の中で未使用のトピックを返す。全部使った場合は再利用"""
    topics = PILLARS[pillar]["topics"]
    for t in topics:
        if t not in used:
            return t
    return topics[0]  # ローテで戻る


def latest_pdca_insights() -> str:
    """直近のPDCAレポートから生成プロンプトに使うインサイトを抽出"""
    if not REPORTS_DIR.exists():
        return "（PDCAレポートなし。初回生成）"
    files = sorted(REPORTS_DIR.glob("*-pdca.md"), reverse=True)
    if not files:
        return "（PDCAレポートなし。初回生成）"
    text = files[0].read_text(encoding="utf-8")
    # Action / 良かった点を抽出
    action_match = re.search(r"##\s*Action.*?\n(.+?)(?=\n##|\Z)", text, re.DOTALL)
    good_match = re.search(r"###\s*良かった点.*?\n(.+?)(?=\n###|\n##|\Z)", text, re.DOTALL)
    parts = []
    if good_match:
        parts.append(f"**前月の良かった点:**\n{good_match.group(1).strip()[:500]}")
    if action_match:
        parts.append(f"**今月のアクション:**\n{action_match.group(1).strip()[:500]}")
    return "\n\n".join(parts) if parts else "（前回データから読み取れず）"


def slugify(title: str) -> str:
    """日本語タイトルから英数字のslugを生成"""
    # Pillar prefix + 通し番号で簡潔に
    return re.sub(r"[^a-z0-9-]", "", title.lower())[:30] or "article"


def build_prompt(pillar: str, topic: str, persona: str, playbook: str,
                  product_pb: str, note_skill: str, insights: str,
                  used_topics_list: list[str], voice: str = "",
                  sales: str = "") -> str:
    pillar_info = PILLARS[pillar]
    price_min, price_max = pillar_info["price_range"]

    return f"""あなたは「残業嫌いのらくだ先生🐪」（公立中学校教員・公務員・20代）のnote記事を執筆します。

**🚨 最重要厳守事項 🚨**
1. AI生成と気付かれない記事を書く
2. 有料部分は必ず「コピペできる成果物 + 手順チェックリスト + 数値表」の3点セット
   （抽象的なノウハウだけは絶対NG・売れない）

==== 最優先参照1: 伊神さんの実際の口調・人物情報 ====
{voice}

==== 最優先参照2: 売れる有料記事の戦略 ====
{sales}

上記2ファイルは**ペルソナ厳守より優先**して反映する。
口調・NG表現・人物情報は voice-and-style から、
記事構成・タイトル・有料部分の作り方は sales-playbook から取る。

==== 今回のテーマ ====
柱: {pillar} ({pillar_info['name']})
タイトル候補: 「{topic}」（このまま使わず、sales-playbook の鉄則で再構成・数字と対比を入れる）
価格帯: ¥{price_min}〜¥{price_max}
推奨タグ: {pillar_info['tags']}

==== ペルソナ（基本情報）====
{persona}

==== SNSプレイブック（柱と一貫性）====
{playbook[:3000]}

==== 商品制作プレイブック ====
{product_pb[:2000]}

==== note記事執筆ノウハウ ====
{note_skill[:5000]}

==== 前月のPDCAインサイト ====
{insights}

==== 既存記事タイトル（重複回避）====
{chr(10).join('- ' + t for t in used_topics_list[:20])}

==== 必須出力フォーマット ====
以下の形式で**完全な記事**を生成してください。投稿メタデータ表は必ず最上部に。

```
# note第N弾記事ドラフト

作成日：{datetime.date.today().isoformat()}
柱：{pillar} ({pillar_info['name']})
note-writer skill適用：型X（適切なものを選ぶ）

---

## 📋 投稿メタデータ

| 項目 | 値 |
|------|---|
| **タイトル** | 32字以内のSEOタイトル |
| タイトル文字数 | XX字 |
| **価格** | ¥XXX（理由を添える） |
| 推奨タグ | `#tag1` `#tag2` `#tag3` |
| 無料部分 | 約X,XXX字 |
| 有料部分 | 約X,XXX字 |
| 投稿時刻 | 平日朝6:30 or 夜21:30〜22:30推奨 |
| ペイウォール位置 | 「────────── ペイウォール ──────────」の行 |

### サムネ画像指示書（Canva用）
（サイズ・配色・フォント・配置の指示）

---

## 記事本文

### 〜（記事の本文をここから書く・3500-4000字の無料部分）〜

（強い書き出し → 問題提起 → 解決の方向性 → 具体例 → 無料部分のクライマックス → ペイウォールへの誘導）

────────── ペイウォール ──────────

### 有料部分

（2500-3000字の有料部分・無料部分では出せない具体テンプレ・実数値・コード・ノウハウ集など）

---

## 投稿後アクション
- Xで宣伝ツイート（型③商品宣伝）
- 1週間後に効果測定
```

==== 重要制約 ====
- 無料部分: 3,500〜4,000字
- 有料部分: 2,500〜3,000字
- ペルソナのNGリスト厳守（本名・学校名・地域名・生徒個人エピソード禁止）
- 柱B（資産形成）は金融商品取引法に配慮（「絶対上がる」「○○証券おすすめ」NG、実体験ベースで中立的に）
- 一人称: 本文では「ぼく」、自己紹介・キャッチでは「らくだ」
- 🐪は記事全体で2-3回まで
- 個人特定可能な数字（具体的な勤務時刻・地名）は出さない
- 「2000万円」「月10万円」など実績数字は自然に織り込む
"""


def main() -> int:
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        print("ERROR: GITHUB_TOKEN が設定されていません", file=sys.stderr)
        return 1

    pillar = os.environ.get("PILLAR") or next_pillar()
    if pillar not in PILLARS:
        print(f"ERROR: 不正な柱: {pillar}", file=sys.stderr)
        return 1

    used = used_topics()
    topic = pick_topic(pillar, used)

    print(f"🎯 柱: {pillar} ({PILLARS[pillar]['name']})")
    print(f"📝 トピック: {topic}")
    print(f"📁 既存記事数: {len(used)}件")

    persona = PERSONA_PATH.read_text(encoding="utf-8") if PERSONA_PATH.exists() else ""
    playbook = PLAYBOOK_PATH.read_text(encoding="utf-8") if PLAYBOOK_PATH.exists() else ""
    product_pb = PRODUCT_PLAYBOOK.read_text(encoding="utf-8") if PRODUCT_PLAYBOOK.exists() else ""
    note_skill = NOTE_SKILL.read_text(encoding="utf-8") if NOTE_SKILL.exists() else ""
    voice = VOICE_PATH.read_text(encoding="utf-8") if VOICE_PATH.exists() else ""
    sales = SALES_PATH.read_text(encoding="utf-8") if SALES_PATH.exists() else ""
    insights = latest_pdca_insights()

    client = OpenAI(base_url=GH_MODELS_ENDPOINT, api_key=token)
    response = client.chat.completions.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        temperature=0.85,
        messages=[
            {"role": "user", "content": build_prompt(pillar, topic, persona, playbook,
                                                     product_pb, note_skill, insights, used,
                                                     voice=voice, sales=sales)},
        ],
    )

    body = response.choices[0].message.content or ""
    usage = response.usage

    ARTICLES_DIR.mkdir(parents=True, exist_ok=True)
    today = datetime.datetime.now(JST).date()
    slug = slugify(topic[:20])
    out_path = ARTICLES_DIR / f"{today.isoformat()}-pillar{pillar}-{slug}.md"

    # ヘッダー追加
    header = (
        f"<!-- AUTO-GENERATED by generate_note_article.py at {datetime.datetime.now(JST).isoformat(timespec='seconds')} -->\n"
        f"<!-- Pillar: {pillar} ({PILLARS[pillar]['name']}) | Topic: {topic} -->\n"
        f"<!-- Model: {MODEL} | tokens: in={usage.prompt_tokens if usage else '?'} out={usage.completion_tokens if usage else '?'} -->\n"
        f"<!-- ⚠️ AI生成記事。投稿前にペルソナNGリスト・金融法令違反チェックを推奨 -->\n\n"
    )
    out_path.write_text(header + body, encoding="utf-8")
    print(f"✅ 記事生成完了: {out_path}")

    # ローテーションログ更新
    with ROTATION_LOG.open("a", encoding="utf-8") as f:
        f.write(f"{today.isoformat()}\t{topic}\t{pillar}\n")

    # 次のワークフローに渡すための出力
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as f:
            f.write(f"article_path={out_path.relative_to(ROOT)}\n")
            f.write(f"pillar={pillar}\n")
            f.write(f"topic={topic}\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())
