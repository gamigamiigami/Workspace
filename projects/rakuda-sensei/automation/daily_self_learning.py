#!/usr/bin/env python3
"""
深夜 3:00〜6:00 JST の自己学習ループ（完全無料）

GitHub Models (gpt-4o-mini) で、有料記事の収益化ノウハウを毎日リサーチし、
knowledge/learning-log.md に蓄積、定期的に knowledge/sales-playbook.md に統合する。

【設計】
- 起動: JST 3:00 (UTC 18:00) cron
- 終了: workflow の timeout-minutes (180) で必ず JST 6:00 までに停止
- リズム: 90秒/ラウンド × 最大60ラウンド = 1.5h（余裕を持って終わる）
- 統合: 毎日1回 sales-playbook.md に digest を追記

【消費】
- GitHub Models (無料・伊神さんのClaude Proとは別枠)
- 月の負荷: 約60 req/day × 30日 = 1,800 req/month → 余裕で無料枠内
"""

import datetime
import os
import random
import re
import sys
import time
from pathlib import Path
from zoneinfo import ZoneInfo

from openai import OpenAI

ROOT = Path(__file__).resolve().parents[3]
SALES_PATH = ROOT / "knowledge" / "sales-playbook.md"
VOICE_PATH = ROOT / "knowledge" / "voice-and-style.md"
PERSONA_PATH = ROOT / "knowledge" / "persona.md"
LEARNING_LOG = ROOT / "knowledge" / "learning-log.md"

GH_MODELS_ENDPOINT = "https://models.github.ai/inference"
MODEL = "openai/gpt-4o-mini"
JST = ZoneInfo("Asia/Tokyo")

# 安全マージン: 6:00 JST より少し早く終わらせる
ROUND_DURATION_LIMIT_SEC = 2.5 * 3600
SLEEP_BETWEEN_ROUNDS = 90

LEARNING_TOPICS = [
    # === タイトル・冒頭 ===
    "売れるnoteタイトルの最新パターン（数字・対比・感情ワード）",
    "教員ジャンルで開封率が高い書き出し500字の型",
    "ペイウォール直前200字に入れるべきhookの型",

    # === 有料部分の中身 ===
    "コピペできるテンプレが有料部分にもたらす購入率効果",
    "手順チェックリストの最適な粒度（何ステップが買われやすいか）",
    "公務員×資産形成ジャンルで有料化に最適な数値表のフォーマット",
    "有料部分3点セット（テンプレ/リスト/数値表）の最適配分",

    # === ジャンル・競合 ===
    "公務員×資産形成 note の市場規模と空白地帯の特定",
    "教員系 note creator トップの共通する成功パターン",
    "FIRE/セミリタイア系 note との差別化ポイント",
    "教員バレせずに信頼性を担保する自己紹介の書き方",

    # === 集客導線 ===
    "X 宣伝ツイートで購入率を上げる文言パターン",
    "X のプロフィール文と固定ツイートで note への流入を最大化",
    "Threads でのnote記事告知の効果的タイミング",
    "サムネ画像が刺さるレイアウト・配色・フォント",

    # === LTV・リピート ===
    "リピート購入を生む記事末尾CTA設計",
    "マガジン化のタイミング（何記事貯まったらマガジン化が最適か）",
    "フォロワー数別の有料記事適正価格帯",

    # === コンテンツ改善 ===
    "失敗談を購入動機に転換する書き出しの黄金パターン",
    "教員読者が『この人本物だ』と感じる具体性のレベル感",
    "数字や金額を出すときの単位の選び方（月? 年? 累計?）",

    # === 心理的トリガー ===
    "教員特有の購買動機（時間が買える/精神的余裕/将来不安）の利用",
    "公務員特有の購買動機（安定の裏の不安/副業欲）の利用",
    "20代教員 vs 30-40代教員のニーズ差",

    # === PDCA設計 ===
    "売れた記事と売れなかった記事を分析する観点",
    "週1本ペースでの記事品質をキープする運営術",
    "AI生成バレを完全に防ぐためのファクトチェック法",

    # === 拡張展開 ===
    "note記事をBOOTH教材やKindleにリパッケージする戦略",
    "音声・動画コンテンツへの展開でLTV最大化",
    "個人ブランドの育て方（フォロワー数より重要な指標）",
]


def now_jst() -> str:
    return datetime.datetime.now(JST).isoformat(timespec="minutes")


def append_to_log(topic: str, insights: str, round_no: int):
    LEARNING_LOG.parent.mkdir(exist_ok=True, parents=True)
    if not LEARNING_LOG.exists():
        LEARNING_LOG.write_text(
            "# 自己学習ログ\n\n"
            "毎日 深夜3-6時 JST に自動稼働。GitHub Models（無料）で有料記事収益化ノウハウを学習。\n"
            "蓄積した知見は定期的に sales-playbook.md に統合される。\n\n"
            "---\n",
            encoding="utf-8",
        )

    entry = f"\n## [{now_jst()}] R{round_no} {topic}\n\n{insights.strip()}\n"
    with LEARNING_LOG.open("a", encoding="utf-8") as f:
        f.write(entry)


def consolidate_into_playbook(client: OpenAI) -> str:
    """今日学んだログから sales-playbook.md に追記すべき普遍ノウハウを抽出"""
    if not LEARNING_LOG.exists():
        return "（ログなし）"

    log = LEARNING_LOG.read_text(encoding="utf-8")
    today = datetime.datetime.now(JST).strftime("%Y-%m-%d")

    # 今日のエントリのみを抽出
    pattern = rf"## \[{today}T[^\]]+\] [^\n]+\n\n(.+?)(?=\n## \[|\Z)"
    today_entries = re.findall(pattern, log, re.DOTALL)
    if not today_entries:
        return "（今日のエントリなし）"

    digest_prompt = f"""あなたは note 戦略アナリスト。
今日のリサーチ {len(today_entries)} 件から、sales-playbook.md に追記すべき
**再利用可能な原則**だけ 5 項目以内で抽出してください。
- 日付・個別事例ではなく、普遍的な原則
- 戦略書に既に書かれていないもの
- 短いセクションタイトル + 1-3行の解説

リサーチ内容（一部抜粋）:
{chr(10).join(today_entries[:8])[:6000]}

==== 出力フォーマット ====
### {{セクションタイトル}}
{{1-3行の解説}}

（5項目まで・原則として実装可能なものだけ）
"""
    try:
        response = client.chat.completions.create(
            model=MODEL,
            max_tokens=1500,
            temperature=0.4,
            messages=[{"role": "user", "content": digest_prompt}],
        )
        digest = (response.choices[0].message.content or "").strip()
    except Exception as e:
        return f"統合失敗: {e}"

    if not digest:
        return "digest空"

    addition = (
        f"\n\n---\n\n## 自己学習による追加知見 ({today})\n\n"
        f"<!-- daily_self_learning.py が自動追記 -->\n\n"
        f"{digest}\n"
    )
    with SALES_PATH.open("a", encoding="utf-8") as f:
        f.write(addition)
    return digest[:200]


def main() -> int:
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        print("ERROR: GITHUB_TOKEN 未設定", file=sys.stderr)
        return 1

    client = OpenAI(base_url=GH_MODELS_ENDPOINT, api_key=token)

    sales = SALES_PATH.read_text(encoding="utf-8") if SALES_PATH.exists() else ""
    voice = VOICE_PATH.read_text(encoding="utf-8") if VOICE_PATH.exists() else ""

    start = time.time()
    print(f"🧠 自己学習ループ開始 {now_jst()}")
    print(f"   モデル: {MODEL} (GitHub Models・無料)")
    print(f"   時間制限: {ROUND_DURATION_LIMIT_SEC/3600:.1f}h")

    topics = LEARNING_TOPICS.copy()
    random.shuffle(topics)

    round_no = 0
    success_count = 0
    while time.time() - start < ROUND_DURATION_LIMIT_SEC and round_no < 60:
        topic = topics[round_no % len(topics)]
        round_no += 1
        print(f"\n--- Round {round_no}: {topic[:40]} ---")

        prompt = f"""あなたは note 有料記事市場のアナリスト兼戦略家。
伊神さん（公立中学校教員・公務員・20代）の note 収益化を支援する。

==== 今日のリサーチテーマ ====
{topic}

==== 現在の戦略書 (sales-playbook.md・要点抽出) ====
{sales[:5000]}

==== 伊神さんの口調・人物情報 ====
{voice[:2500]}

==== タスク ====
このテーマで、まだ戦略書に書かれていない**新しい実装可能な知見**を 3 つ書き出してください:
1. 具体的な実装・テンプレに落とせる
2. すぐ次の note 記事に反映できる
3. 既存知見の繰り返しではない
4. 一般論ではなく「伊神さんが今やるべき具体策」として書く

==== 出力フォーマット ====
### 知見1: {{1行タイトル}}
{{具体的な内容3-5行 + 適用例}}

### 知見2: {{タイトル}}
{{...}}

### 知見3: {{タイトル}}
{{...}}
"""
        try:
            response = client.chat.completions.create(
                model=MODEL,
                max_tokens=1500,
                temperature=0.85,
                messages=[{"role": "user", "content": prompt}],
            )
            insights = (response.choices[0].message.content or "").strip()
            if insights:
                append_to_log(topic, insights, round_no)
                success_count += 1
                print(f"   ✅ 蓄積成功 ({len(insights)}字)")
            else:
                print("   ⚠️ 空レスポンス")
        except Exception as e:
            print(f"   ❌ エラー: {e}")
            time.sleep(60)  # クールダウン長め

        if time.time() - start + SLEEP_BETWEEN_ROUNDS >= ROUND_DURATION_LIMIT_SEC:
            print("⏳ 時間切れに近づいたためループ終了")
            break
        time.sleep(SLEEP_BETWEEN_ROUNDS)

    print(f"\n📚 統合フェーズ: sales-playbook.md に追記")
    summary = consolidate_into_playbook(client)
    print(f"   {summary[:300]}")

    elapsed_min = (time.time() - start) / 60
    print(f"\n🎯 完了: {round_no}ラウンド試行 / {success_count}成功 / {elapsed_min:.1f}分")

    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as f:
            f.write(f"rounds_attempted={round_no}\n")
            f.write(f"rounds_succeeded={success_count}\n")
            f.write(f"elapsed_min={elapsed_min:.1f}\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())
