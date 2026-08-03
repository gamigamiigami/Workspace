#!/usr/bin/env python3
"""
週次X(Twitter)投稿コンテンツ自動生成スクリプト (GitHub Models版・完全無料)

GitHub Actions の cron で毎週金曜21:00 UTC(JST土曜6:00)に実行され、
来週月〜日の14本(1日2本)のツイートドラフトを生成して
projects/rakuda-sensei/sns/weekly/{week_start}-x-posts.md に保存する。

【無料化の仕組み】
GitHub Models (https://docs.github.com/models) を使用。
GitHub Actions の GITHUB_TOKEN で認証 = 追加設定・追加課金一切なし。
万一GitHub Modelsが有料化した場合は、課金前にAPI呼び出しがエラーで止まる設計。

人間は土日に内容をレビューして、X native scheduler または Buffer無料プランへ転載。
月100分の手間でX運用が回る。

ローカルテスト(オプション):
    export GITHUB_TOKEN=ghp_...  # personal access token
    python projects/rakuda-sensei/automation/generate_weekly_x.py
"""

import datetime
import os
import sys
from pathlib import Path

from openai import OpenAI  # GitHub Models は OpenAI 互換エンドポイントを提供

ROOT = Path(__file__).resolve().parents[3]  # /home/user/Workspace
PERSONA_PATH = ROOT / "knowledge" / "persona.md"
PLAYBOOK_PATH = ROOT / "knowledge" / "sns-playbook.md"
OUTPUT_DIR = ROOT / "projects" / "rakuda-sensei" / "sns" / "weekly"
REPORTS_DIR = ROOT / "projects" / "rakuda-sensei" / "reports"

# GitHub Models 設定 (無料・GITHUB_TOKEN で認証)
GH_MODELS_ENDPOINT = "https://models.github.ai/inference"
MODEL = "openai/gpt-4o-mini"  # 日本語OK・無料枠十分・速い
MAX_TOKENS = 4096


def next_monday(today: datetime.date) -> datetime.date:
    delta = (7 - today.weekday()) % 7 or 7
    return today + datetime.timedelta(days=delta)


def latest_pdca_insights() -> str:
    """直近のPDCAレポートから生成プロンプトに渡すインサイトを抽出"""
    import re
    if not REPORTS_DIR.exists():
        return "（PDCAレポートなし。初回生成）"
    files = sorted(REPORTS_DIR.glob("*-pdca.md"), reverse=True)
    if not files:
        return "（PDCAレポートなし。初回生成）"
    text = files[0].read_text(encoding="utf-8")
    action = re.search(r"##\s*Action.*?\n(.+?)(?=\n##|\Z)", text, re.DOTALL)
    good = re.search(r"###\s*良かった点.*?\n(.+?)(?=\n###|\n##|\Z)", text, re.DOTALL)
    parts = []
    if good:
        parts.append(f"**前月の良かった点:**\n{good.group(1).strip()[:400]}")
    if action:
        parts.append(f"**今月のアクション方針:**\n{action.group(1).strip()[:400]}")
    return "\n\n".join(parts) if parts else "（前回データから読み取れず）"


def build_prompt(persona: str, playbook: str, week_start: datetime.date, insights: str = "") -> str:
    week_end = week_start + datetime.timedelta(days=6)
    return f"""あなたは「残業嫌いのらくだ先生🐪」(中学校国語教員)のX(Twitter)発信を担当しています。

{week_start:%Y年%-m月%-d日}(月)〜{week_end:%-m月%-d日}(日)の7日間、
**1日3本×7日=21本**のツイートドラフトを生成してください。(2026-06-01 戦略変更)

==== 🔥 最重要: 「注目される」ツイートの鉄則（これを最優先で守る）====
今までの投稿は「いいこと言ってるのに誰にも刺さらない優等生ツイート」だった。
これを卒業し、スクロールを止めさせる。以下を全ツイートに徹底する:

1. **1行目(フック)でスクロールを止める**。次のいずれかで始める:
   - 具体的な数字（例「丸つけ3時間→20分になった」）
   - 意外性・逆張り（例「NISA、実は"満額"がベストじゃない」）
   - 失敗告白（例「株で50万溶かして学んだこと」）
   - 痛みの言語化（例「日曜の夜、明日の授業準備でため息出てない？」）
2. **抽象を具体に**。「時短できる」ではなく「何が・どれだけ・どうなった」を数字で。
3. **1ツイート1メッセージ**。詰め込まない。1つの実感だけ濃く。
4. **優等生の締めを禁止**。「〜しよう！」「試してみてね！」「頑張ろう」で終わらせない。
   代わりに、言い切る/問いを投げる/続きが気になる余韻で終える。
5. **説明せず、見せる**。ビフォーアフター・実際の場面・生々しい数字で。
6. きれいにまとめない。教科書的な正論より、1つの本音・実体験。

【Before(凡庸・禁止例)】
「校務時短に役立つExcelマクロ、みんな使ってる？IF関数を駆使して評価計算を一瞬で。試してみてね！」
【After(合格例)】
「成績処理、去年まで日曜まるつぶれだった。IF関数ひとつ覚えたら"3時間→15分"。浮いた時間で副業の記事書いてる。関数コピペ用に貼っとくね↓」

上のBeforeのような当たり障りない投稿は1本も混ぜないこと。

==== ペルソナ ====
{persona}

==== SNSプレイブック ====
{playbook}

==== 前月のPDCAインサイト（必ず反映） ====
{insights}

==== 制約 ====
- 各ツイート 140〜160字 (140字オーバー厳禁)
- **1日3本: 朝(7:00 JST) / 昼(12:30 JST・休み時間) / 夜(21:00 JST) の3スロット**
- 3本柱の配分(週21本):
  - 柱A (ICT・AI活用で校務時短): 週7本程度
  - 柱B (公務員×資産形成・節約): 週7本程度
  - 柱C (教育ゲーム制作・バイブコーディング): 週4本程度
  - クロスオーバー (3柱を横断): 週3本程度
- 曜日×時間帯×柱の推奨配分 (1日3スロット):
  - 月: 朝=柱A(ICT時短) / 昼=柱B(節約Tips短文) / 夜=柱B(投資)
  - 火: 朝=柱A(AI活用) / 昼=共感系(教員あるある) / 夜=柱B(つみたてNISA)
  - 水: 朝=柱A(校務効率) / 昼=柱C(コード断片公開) / 夜=クロスオーバー
  - 木: 朝=柱A(ICT時短) / 昼=柱B(節税ネタ) / 夜=柱B(公務員制度)
  - 金: 朝=柱C(教育ゲーム) / 昼=柱A(週末作業の段取り) / 夜=柱B(週末投資レビュー)
  - 土: 朝=柱C(バイブコーディング) / 昼=ライト(雑談・趣味) / 夜=柱C(制作プロセス)
  - 日: 朝=クロスオーバー / 昼=共感(教員の月曜憂鬱緩和) / 夜=週次振り返り
- 投稿型 (共感/ノウハウ/商品宣伝/プロセス公開/ライト) は柱を横断して使う
- ハッシュタグ各2-3個まで、柱に応じて使い分け
  - 柱A: #教員のバトン #働き方改革 #ChatGPT活用 #生成AI #校務効率化
  - 柱B: #公務員 #資産形成 #つみたてNISA #節約 #FIRE #セミリタイア
  - 柱C: #教育ゲーム #バイブコーディング #ClaudeCode #ICT教育
- 🐪は1日1回まで
- ペルソナのNGリスト厳守(本名・地域・学校・生徒の固有エピソード禁止)
- 柱Bの金融商品取引法対策: 「絶対上がる」「ノーリスク」「○○証券おすすめ」NG。実体験ベースで中立的に。
- 1ツイート内で「ぼく/らくだ」混在禁止(統一する)

==== 出力フォーマット ====
## 週次テーマ
{{今週通じて伝えたい1行}}

## {week_start:%-m/%-d}(月)
### 朝
- 型: 共感/ノウハウ/商品宣伝/プロセス/ライト
- 柱: A (ICT時短) / B (資産形成) / C (バイブコーディング) / X (クロスオーバー)
- 本文:
{{140-160字のツイート}}
- タグ: #tag1 #tag2

### 昼
- 型: (適切なもの)
- 柱: (適切なもの)
- 本文:
{{...・休み時間にスマホで読まれる軽め文章推奨}}
- タグ: ...

### 夜
- 型: ノウハウ
- 柱: B
- 本文:
{{...}}
- タグ: ...

(以下、火曜〜日曜まで同形式)

## 投稿運用メモ
- レビューポイント
- 3本柱バランス確認
"""


def main() -> int:
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        print("ERROR: GITHUB_TOKEN が設定されていません", file=sys.stderr)
        print("GitHub Actions では自動付与されます。ローカル実行時は personal access token を渡してください。", file=sys.stderr)
        return 1

    if not PERSONA_PATH.exists():
        print(f"ERROR: {PERSONA_PATH} がありません", file=sys.stderr)
        return 1

    persona = PERSONA_PATH.read_text(encoding="utf-8")
    playbook = PLAYBOOK_PATH.read_text(encoding="utf-8")

    today = datetime.date.today()
    # WEEK_OFFSET: 1=来week（デフォルト・通常運用）, 0=今週（取りこぼし救済用）
    week_offset = int(os.environ.get("WEEK_OFFSET", "1"))
    if week_offset <= 0:
        # 今週の月曜（今日を含む週）から数えてオフセット
        this_monday = today - datetime.timedelta(days=today.weekday())
        week_start = this_monday + datetime.timedelta(weeks=week_offset)
    else:
        week_start = next_monday(today) + datetime.timedelta(weeks=week_offset - 1)

    print(f"📅 生成対象週: {week_start} 〜 {week_start + datetime.timedelta(days=6)}")
    print(f"🤖 モデル: {MODEL} (GitHub Models・無料)")

    insights = latest_pdca_insights()

    client = OpenAI(base_url=GH_MODELS_ENDPOINT, api_key=token)
    response = client.chat.completions.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        temperature=0.8,
        messages=[
            {"role": "user", "content": build_prompt(persona, playbook, week_start, insights)},
        ],
    )

    body = response.choices[0].message.content or ""
    usage = response.usage

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / f"{week_start.isoformat()}-x-posts.md"

    header = (
        f"# X投稿ドラフト {week_start:%Y/%-m/%-d}(月)〜{(week_start + datetime.timedelta(days=6)):%-m/%-d}(日)\n\n"
        f"- 生成日時: {datetime.datetime.now().isoformat(timespec='seconds')}\n"
        f"- モデル: {MODEL} (GitHub Models・無料)\n"
        f"- input tokens: {usage.prompt_tokens if usage else 'unknown'}\n"
        f"- output tokens: {usage.completion_tokens if usage else 'unknown'}\n\n"
        f"> ⚠️ AI生成のドラフトです。土日にレビューしてX native schedulerまたはBuffer無料プランに月曜朝までにセット。\n"
        f"> NGリスト違反・誤字・らくだ/ぼく混在は必ず修正。\n\n"
        f"---\n\n"
    )
    out_path.write_text(header + body, encoding="utf-8")
    print(f"✅ 生成完了: {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
