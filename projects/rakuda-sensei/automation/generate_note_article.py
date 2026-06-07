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

# quality_check_article を同じディレクトリから import 可能にする
sys.path.insert(0, str(Path(__file__).parent))

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
# GitHub Models gpt-4o-mini の制約:
#   - input: 8,000 tokens 上限 (413 tokens_limit_reached エラー回避)
#   - max_tokens(output): 4,000 程度に抑える（記事5,500字 ≈ 3,700 tokens）
MAX_TOKENS = 4000
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
            # === フェーズ1: 集中強化4本（2026-05-31 実情ヒアリング後の訂正版） ===
            "先取り投資→生活→貯金｜公務員が5年で2000万築いたお金の流れ",
            "日本株デイトレで-50万｜公務員がインデックス積立に振り切るまで",
            "固定費を洗い出すと先取り投資ができる｜支出10万で回せる家計設計",
            "毎月15万NISA自動積立を5年継続｜S&P500とオルカンに集中したリアル配分",
            # === フェーズ2: ローテ用ストック ===
            "家計簿で変動費を把握する｜公務員が月10万生活を実現した実践法",
            "投信10銘柄に分散したリアル｜証券会社移動と新NISAで起きた銘柄カオス整理術",
            "公務員共済貯金 vs NISA｜先取りすべきはどっち？",
            "20代公務員のバリスタファイアロードマップ｜共働き保育士と組んだお金の戦略",
            "節約Tips｜娯楽費5万を死守しながら月15万投資する優先順位",
            "教員の手取りを最適化する控除術｜年末調整で取りこぼさない方法",
            "ふるさと納税で得する公務員設計｜実家暮らしでも家族が喜ぶ返礼品の選び方",
            # === iDeCo 関連は有料化NG（voice-and-style 準拠）→ 無料記事用に別管理 ===
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


def detect_paid_asset(topic: str, pillar: str) -> tuple[bool, str]:
    """
    トピックから「有料化すべきデジタル成果物」が伴うか判定（2026-06-01戦略転換）。
    - 添付デジタル成果物がある場合のみ有料化
    - 本文知識は無料で公開
    """
    paid_triggers = [
        ("テンプレ", "Excel/Notionテンプレート"),
        ("エクセル", "Excelテンプレート"),
        ("家計簿", "家計簿テンプレート"),
        ("ワークシート", "印刷用PDFワークシート"),
        ("チェックリスト", "印刷用チェックリスト"),
        ("プロンプト", "AIプロンプト集"),
        ("コード", "ソースコード一式"),
        ("ゲーム", "ゲームデータ・コード一式"),
        ("配分表", "投資配分シート"),
        ("家計フロー", "家計設計テンプレ"),
        ("採点", "採点テンプレ"),
    ]
    for kw, asset in paid_triggers:
        if kw in topic:
            return True, asset
    return False, ""


def build_prompt(pillar: str, topic: str, persona: str, playbook: str,
                  product_pb: str, note_skill: str, insights: str,
                  used_topics_list: list[str], voice: str = "",
                  sales: str = "") -> str:
    pillar_info = PILLARS[pillar]
    price_min, price_max = pillar_info["price_range"]
    is_paid, asset_type = detect_paid_asset(topic, pillar)

    # 戦略転換: 基本無料、デジタル成果物がある時だけ有料
    pricing_instruction = (
        f"""**この記事は有料記事**: デジタル成果物「{asset_type}」を有料部分で配布する。
- 無料部分（3,500〜4,000字）: 知識・ノウハウを完全公開（出し惜しみNG）
- 有料部分（800〜1,500字）: 上記の「{asset_type}」だけを置く（蛇足は書かない）
- 価格: ¥{price_min}〜¥{price_max}（成果物の濃度で決める）
"""
        if is_paid else
        f"""**この記事は無料公開**: 集客・SNS流入の受け皿として全文無料で出す。
- 本文 4,000〜5,500字
- ペイウォール記号「────────── ペイウォール ──────────」は入れない
- 末尾に「すぐ使える成果物（テンプレ・コード等）が欲しい方は↓の有料マガジンへ」CTAを入れる
- 価格メタデータは「¥0」と書く
"""
    )

    return f"""あなたは「残業嫌いのらくだ先生🐪」（公立中学校教員・公務員・20代）のnote記事を執筆します。

**🚨 最重要厳守事項 🚨**
1. AI生成と気付かれない記事を書く
2. 有料部分は必ず「コピペできる成果物 + 手順チェックリスト + 数値表」の3点セット
   （抽象的なノウハウだけは絶対NG・売れない）

==== 最優先参照1: 伊神さんの実際の口調・人物情報 ====
{voice[:2000]}

==== 最優先参照2: 売れる有料記事の戦略 ====
{sales[:2500]}

上記2ファイルは**ペルソナ厳守より優先**して反映する。
口調・NG表現・人物情報は voice-and-style から、
記事構成・タイトル・有料部分の作り方は sales-playbook から取る。

==== 今回のテーマ ====
柱: {pillar} ({pillar_info['name']})
タイトル候補: 「{topic}」（このまま使わず、sales-playbook の鉄則で再構成・数字と対比を入れる）
価格帯: ¥{price_min}〜¥{price_max}
推奨タグ: {pillar_info['tags']}

==== ペルソナ（基本情報）====
{persona[:1500]}

==== SNSプレイブック（柱と一貫性）====
{playbook[:1500]}

==== 商品制作プレイブック ====
{product_pb[:1000]}

==== note記事執筆ノウハウ ====
{note_skill[:2500]}

==== 前月のPDCAインサイト ====
{insights[:800]}

==== 既存記事タイトル（重複回避）====
{chr(10).join('- ' + t for t in used_topics_list[:10])}

==== 価格戦略（最重要・2026-06-01 戦略転換）====
{pricing_instruction}

==== 必須出力フォーマット ====
以下の形式で**完全な記事**を生成してください。投稿メタデータ表は必ず最上部に。
**目次は本文先頭に自動生成すること**（H2見出しをリスト化）。

```
# note第N弾記事ドラフト

作成日：{datetime.date.today().isoformat()}
柱：{pillar} ({pillar_info['name']})
記事タイプ：{('有料記事（成果物付き）' if is_paid else '無料記事（集客）')}
note-writer skill適用：型X（適切なものを選ぶ）

---

## 📋 投稿メタデータ

| 項目 | 値 |
|------|---|
| **タイトル** | 32字以内のSEOタイトル |
| タイトル文字数 | XX字 |
| **価格** | {'¥XXX（成果物の内容を添える）' if is_paid else '¥0（無料公開）'} |
| 推奨タグ | `#tag1` `#tag2` `#tag3` |
| 無料部分 | 約X,XXX字 |
| 有料部分 | {'約X,XXX字' if is_paid else 'なし'} |
| 添付成果物 | {asset_type if is_paid else 'なし（全文無料公開）'} |
| 投稿時刻 | 平日朝6:30 or 夜21:30〜22:30推奨 |

### サムネ画像指示書（Canva用）
（サイズ・配色・フォント・配置の指示）

---

## 記事本文

### この記事の目次
- 〇〇とは（300字）
- なぜ〇〇が必要か（500字）
- 具体的な〇〇の方法（1500字）
- 失敗パターンと対処（800字）
- まとめ（300字）
{('- 【有料】' + asset_type) if is_paid else '- すぐ使える成果物について（マガジン紹介）'}

（本文をここから書く・伊神さんの口調と具体エピソードで・目次の各セクションを順に展開）

{'────────── ペイウォール ──────────' if is_paid else ''}

{('### 有料部分（' + asset_type + 'のみ）') if is_paid else ''}

{('（800〜1500字・実際のテンプレ・コード・数値表のみ・蛇足NG）') if is_paid else ''}

{('') if is_paid else '''### 📦 すぐ使える成果物をお求めの方へ

本記事のテンプレ・コード・チェックリストをセットにした有料記事は別途公開しています。
マガジン購読で全ての成果物が見放題に。
（マガジンリンク or 関連有料記事リンク）'''}

---

## 投稿後アクション
- X / Threads / Instagram で告知ツイート
- 1週間後に流入数・購入数測定
```

==== 重要制約 ====
{('- 無料部分: 3,500〜4,000字 / 有料部分: 800〜1,500字（成果物のみ）') if is_paid else '- 全文無料: 4,000〜5,500字'}
- **目次は必ず本文先頭に置く**（読者がスマホでも一目で内容把握できるように）
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

    prompt = build_prompt(pillar, topic, persona, playbook,
                           product_pb, note_skill, insights, used,
                           voice=voice, sales=sales)
    # GitHub Models gpt-4o-mini の 8,000 token 上限超過を事前検知
    # tiktoken で正確に測る (失敗時は len//2 のラフ推定にフォールバック)
    exact_tokens = None
    try:
        import tiktoken
        enc = tiktoken.encoding_for_model("gpt-4o-mini")
        exact_tokens = len(enc.encode(prompt))
    except Exception as e:
        print(f"ℹ️  tiktoken 実測スキップ ({e}) → 推定値で判定", file=sys.stderr)
    est_tokens = exact_tokens if exact_tokens is not None else len(prompt) // 2
    method = "tiktoken実測" if exact_tokens is not None else "len//2推定"
    print(f"📐 プロンプト: {len(prompt):,}字 / {est_tokens:,}トークン ({method}, 上限8,000)")
    if est_tokens > 7500:
        print(f"❌ プロンプトが上限近接 → 各 knowledge ファイルの slice を縮小してください", file=sys.stderr)
        print(f"   現在のサイズ: voice={len(voice)} sales={len(sales)} persona={len(persona)} "
              f"playbook={len(playbook)} product_pb={len(product_pb)} skill={len(note_skill)}",
              file=sys.stderr)
        return 1

    client = OpenAI(base_url=GH_MODELS_ENDPOINT, api_key=token)
    # 429 (rate limit) の指数バックオフリトライ (最大3回)
    import time
    response = None
    for attempt in range(3):
        try:
            response = client.chat.completions.create(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                temperature=0.85,
                messages=[
                    {"role": "user", "content": prompt},
                ],
            )
            break
        except Exception as e:
            msg = str(e)
            is_rate_limit = "429" in msg or "rate" in msg.lower() or "quota" in msg.lower()
            if is_rate_limit and attempt < 2:
                wait_s = (attempt + 1) * 30  # 30s, 60s
                print(f"⏳ レート制限ヒット → {wait_s}秒待機して再試行 ({attempt+1}/3)", file=sys.stderr)
                time.sleep(wait_s)
                continue
            print(f"ERROR: OpenAI API 呼び出し失敗: {e}", file=sys.stderr)
            return 1
    if response is None:
        print("ERROR: API応答取得失敗 (リトライ尽きた)", file=sys.stderr)
        return 1

    body = response.choices[0].message.content or ""
    usage = response.usage
    finish_reason = response.choices[0].finish_reason

    # 出力切り捨て検出: finish_reason == 'length' は max_tokens 到達 = 記事が途中で終わってる
    if finish_reason == "length":
        print(f"⚠️  生成が max_tokens={MAX_TOKENS} で切り捨てられた可能性 (finish_reason=length)", file=sys.stderr)
        print(f"   出力トークン: {usage.completion_tokens if usage else '?'} / 本文字数: {len(body):,}", file=sys.stderr)
        print(f"   → 記事末尾が途中で切れているはず。MAX_TOKENS を増やすか、無料部分の字数指定を縮小してください", file=sys.stderr)

    # 空レスポンス検出: 1,500字未満は明らかに失敗
    if len(body) < 1500:
        print(f"ERROR: 生成本文が異常に短い ({len(body)}字) - API応答失敗の可能性", file=sys.stderr)
        print(f"   finish_reason={finish_reason} / 生本文プレビュー: {body[:200]!r}", file=sys.stderr)
        return 1

    # ========== 品質チェック & 自動研磨 ==========
    quality_report_md = ""
    try:
        from quality_check_article import polish, report_to_markdown
        body, q_report = polish(body)
        quality_report_md = report_to_markdown(q_report)
        print(f"\n🪞 品質スコア: {q_report.score}/100")
        print(f"   NG表現置換: {q_report.ng_phrase_hits} / 実体験密度: {q_report.episode_density} / 太字化: {q_report.bold_applied} / 段落分割: {q_report.paragraphs_split}")
        for issue in q_report.issues[:5]:
            print(f"   ⚠ {issue}")
    except Exception as e:
        print(f"WARNING: 品質チェック失敗（記事はそのまま保存）: {e}", file=sys.stderr)

    ARTICLES_DIR.mkdir(parents=True, exist_ok=True)
    today = datetime.datetime.now(JST).date()
    slug = slugify(topic[:20])
    out_path = ARTICLES_DIR / f"{today.isoformat()}-pillar{pillar}-{slug}.md"

    # ヘッダー追加
    header = (
        f"<!-- AUTO-GENERATED by generate_note_article.py at {datetime.datetime.now(JST).isoformat(timespec='seconds')} -->\n"
        f"<!-- Pillar: {pillar} ({PILLARS[pillar]['name']}) | Topic: {topic} -->\n"
        f"<!-- Model: {MODEL} | tokens: in={usage.prompt_tokens if usage else '?'} out={usage.completion_tokens if usage else '?'} -->\n"
        f"<!-- ⚠️ AI生成記事 + 自動研磨済み。投稿前にNGリスト・金融法令違反チェックを推奨 -->\n\n"
    )
    # 品質レポートは記事末尾にコメントとして埋め込み（投稿時に find_body_section で除去される）
    footer = ""
    if quality_report_md:
        footer = f"\n\n<!--\n{quality_report_md}\n-->\n"
    out_path.write_text(header + body + footer, encoding="utf-8")
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
