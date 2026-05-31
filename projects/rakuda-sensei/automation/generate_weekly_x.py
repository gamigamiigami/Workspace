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

# GitHub Models 設定 (無料・GITHUB_TOKEN で認証)
GH_MODELS_ENDPOINT = "https://models.github.ai/inference"
MODEL = "openai/gpt-4o-mini"  # 日本語OK・無料枠十分・速い
MAX_TOKENS = 4096


def next_monday(today: datetime.date) -> datetime.date:
    delta = (7 - today.weekday()) % 7 or 7
    return today + datetime.timedelta(days=delta)


def build_prompt(persona: str, playbook: str, week_start: datetime.date) -> str:
    week_end = week_start + datetime.timedelta(days=6)
    return f"""あなたは「残業嫌いのらくだ先生🐪」(中学校国語教員)のX(Twitter)発信を担当しています。

{week_start:%Y年%-m月%-d日}(月)〜{week_end:%-m月%-d日}(日)の7日間、
1日2本×7日=14本のツイートドラフトを生成してください。

==== ペルソナ ====
{persona}

==== SNSプレイブック ====
{playbook}

==== 制約 ====
- 各ツイート 140〜160字 (140字オーバー厳禁)
- 1日2本: 朝(7時前) / 夜(21時以降) の2スロット
- 3本柱の配分(2026-05-31更新):
  - 柱A (ICT・AI活用で校務時短): 月10本 → 週2-3本
  - 柱B (公務員×資産形成・節約): 月10本 → 週2-3本
  - 柱C (教育ゲーム制作・バイブコーディング): 月6本 → 週1-2本
  - クロスオーバー (3柱を横断): 月4本 → 週1本
- 曜日×時間帯×柱の推奨配分:
  - 月朝: 柱A (ICT時短) / 月夜: 柱B (節約)
  - 火朝: 柱A (AI活用) / 火夜: 柱B (投資)
  - 水朝: 柱A (校務効率) / 水夜: クロスオーバー
  - 木朝: 柱A (ICT時短) / 木夜: 柱B (公務員制度)
  - 金朝: 柱C (教育ゲーム) / 金夜: 柱B (投資)
  - 土朝: 柱C (バイブコーディング) / 土夜: 柱C (制作プロセス)
  - 日朝: クロスオーバー / 日夜: 共感・週次振り返り
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
    week_start = next_monday(today)

    print(f"📅 生成対象週: {week_start} 〜 {week_start + datetime.timedelta(days=6)}")
    print(f"🤖 モデル: {MODEL} (GitHub Models・無料)")

    client = OpenAI(base_url=GH_MODELS_ENDPOINT, api_key=token)
    response = client.chat.completions.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        temperature=0.8,
        messages=[
            {"role": "user", "content": build_prompt(persona, playbook, week_start)},
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
