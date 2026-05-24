#!/usr/bin/env python3
"""
週次X(Twitter)投稿コンテンツ自動生成スクリプト。

GitHub Actions の cron で毎週金曜21:00 UTC(JST土曜6:00)に実行され、
来週月〜日の14本(1日2本)のツイートドラフトを生成して
projects/rakuda-sensei/sns/weekly/{week_start}-x-posts.md に保存する。

人間は土日に内容をレビューしてBufferへ転載。月25分の手間でX運用が回る。

ローカルテスト:
    export ANTHROPIC_API_KEY=sk-ant-...
    python projects/rakuda-sensei/automation/generate_weekly_x.py
"""

import datetime
import os
import sys
from pathlib import Path

from anthropic import Anthropic

ROOT = Path(__file__).resolve().parents[3]  # /home/user/Workspace
PERSONA_PATH = ROOT / "knowledge" / "persona.md"
PLAYBOOK_PATH = ROOT / "knowledge" / "sns-playbook.md"
OUTPUT_DIR = ROOT / "projects" / "rakuda-sensei" / "sns" / "weekly"

MODEL = "claude-sonnet-4-6"
MAX_TOKENS = 8192


def next_monday(today: datetime.date) -> datetime.date:
    """次の月曜日。今日が月曜ならその次の月曜。"""
    delta = (7 - today.weekday()) % 7 or 7
    return today + datetime.timedelta(days=delta)


def build_prompt(persona: str, playbook: str, week_start: datetime.date) -> str:
    week_end = week_start + datetime.timedelta(days=6)
    return f"""あなたは「残業嫌いのらくだ先生🐪」(中学校国語教員) のX(Twitter)発信を担当しています。

{week_start:%Y年%-m月%-d日}(月)〜{week_end:%-m月%-d日}(日)の7日間、
1日2本×7日=14本のツイートドラフトを生成してください。

==== ペルソナ ====
{persona}

==== SNSプレイブック ====
{playbook}

==== 制約 ====
- 各ツイート 140〜160字 (140字オーバー厳禁、URLは20字でカウント)
- 1日2本: 朝(7時前) / 夜(21時以降) の2スロット
- 7日間の構成バランス目安:
  - 共感型(教員あるある・働き方共感): 5本
  - ノウハウ型(時短・授業・採点): 4本
  - 商品宣伝型(note記事/BOOTH教材紹介): 2本
  - プロセス公開型(制作中・需要調査): 2本
  - ライト型(気づき・コーヒー・短いつぶやき): 1本
- ハッシュタグ各2-3個まで
- 🐪は1日1回まで(多用しない)
- ペルソナのNGリスト厳守(本名・地域・学校・生徒の固有エピソード禁止)
- 1ツイート内で「ぼく/らくだ」混在禁止(統一する)
- 「ですます」「フランク」のバランスはペルソナ準拠

==== 出力フォーマット(厳守) ====
## 週次テーマ
{{今週通じて伝えたい1行}}

## {week_start:%-m/%-d}(月)
### 朝
- 型: 共感
- 本文:
{{140-160字のツイート}}
- タグ: #tag1 #tag2

### 夜
- 型: ノウハウ
- 本文:
{{...}}
- タグ: ...

## {(week_start + datetime.timedelta(days=1)):%-m/%-d}(火)
(以下同形式で日曜まで)

## 投稿運用メモ
- レビューポイント (例: タグの被り、らくだ/ぼく統一、宣伝過多になっていないか)
- Bufferセット時の注意点
"""


def main() -> int:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("ERROR: ANTHROPIC_API_KEY が設定されていません", file=sys.stderr)
        return 1

    if not PERSONA_PATH.exists():
        print(f"ERROR: {PERSONA_PATH} がありません", file=sys.stderr)
        return 1

    persona = PERSONA_PATH.read_text(encoding="utf-8")
    playbook = PLAYBOOK_PATH.read_text(encoding="utf-8")

    today = datetime.date.today()
    week_start = next_monday(today)

    print(f"📅 生成対象週: {week_start} 〜 {week_start + datetime.timedelta(days=6)}")
    print(f"🤖 モデル: {MODEL}")

    client = Anthropic()
    msg = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        messages=[{"role": "user", "content": build_prompt(persona, playbook, week_start)}],
    )

    body = msg.content[0].text

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / f"{week_start.isoformat()}-x-posts.md"

    header = (
        f"# X投稿ドラフト {week_start:%Y/%-m/%-d}(月)〜{(week_start + datetime.timedelta(days=6)):%-m/%-d}(日)\n\n"
        f"- 生成日時: {datetime.datetime.now().isoformat(timespec='seconds')}\n"
        f"- モデル: {MODEL}\n"
        f"- input tokens: {msg.usage.input_tokens}\n"
        f"- output tokens: {msg.usage.output_tokens}\n\n"
        f"> ⚠️ AI生成のドラフトです。土日にレビューしてBufferに月曜朝までにセット。\n"
        f"> NGリスト違反・誤字・らくだ/ぼく混在は必ず修正。\n\n"
        f"---\n\n"
    )
    out_path.write_text(header + body, encoding="utf-8")
    print(f"✅ 生成完了: {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
