#!/usr/bin/env python3
"""
既存note記事の自動改善スクリプト

voice-and-style.md や sales-playbook.md に新情報が追加された時、
過去に書かれた記事をその新情報で再生成し、改善版があれば {name}-v2.md として保存。

【ワークフロー】
1. articles/ 配下の AI 生成記事（{date}-pillar*-*.md）を全部スキャン
2. それぞれを「現在の voice/sales/persona」で再生成
3. 旧版とトークン数や情報密度を比較
4. 改善幅が閾値超なら {name}-v2.md として保存
5. summary.md に「どれが改善されたか」を出力

【無料化】
GitHub Models (gpt-4o-mini) を GITHUB_TOKEN で使用。完全¥0。
"""

import datetime
import os
import re
import sys
from pathlib import Path

from openai import OpenAI

sys.path.insert(0, str(Path(__file__).parent))

ROOT = Path(__file__).resolve().parents[3]
PERSONA_PATH = ROOT / "knowledge" / "persona.md"
PLAYBOOK_PATH = ROOT / "knowledge" / "sns-playbook.md"
VOICE_PATH = ROOT / "knowledge" / "voice-and-style.md"
SALES_PATH = ROOT / "knowledge" / "sales-playbook.md"
NOTE_SKILL = ROOT / ".claude" / "skills" / "note-writer" / "SKILL.md"
ARTICLES_DIR = ROOT / "projects" / "rakuda-sensei" / "articles"
SUMMARY_PATH = ARTICLES_DIR / ".improvement-summary.md"

GH_MODELS_ENDPOINT = "https://models.github.ai/inference"
MODEL = "openai/gpt-4o-mini"
MAX_TOKENS = 8192

# 改善と判定する閾値
IMPROVEMENT_MIN_CHAR_DIFF = 500  # 字数差500以上で実質改善とみなす最低ライン
PILLAR_RE = re.compile(r"pillar([ABC])")


def read_or_empty(p: Path) -> str:
    return p.read_text(encoding="utf-8") if p.exists() else ""


def existing_article_files() -> list[Path]:
    """AI生成記事のみを対象（v2やバックアップは除外）"""
    if not ARTICLES_DIR.exists():
        return []
    files = []
    for f in ARTICLES_DIR.glob("*.md"):
        if f.name.startswith("."):
            continue
        if f.name.endswith("-v2.md") or f.name.endswith("-v3.md"):
            continue
        # v2を既に持っている記事はスキップ（v3, v4と無限増殖を防ぐ）
        v2 = f.with_name(f.stem + "-v2.md")
        if v2.exists():
            continue
        # 初期の手書き記事（001-time-saving-routine.md 等）も対象に
        files.append(f)
    return files


def extract_meta(text: str) -> dict:
    """記事から既存メタ情報（タイトル・価格・タグ等）を抽出"""
    meta = {"title": "", "price": 0, "tags": "", "pillar": "B", "topic": ""}

    title_m = re.search(r"\|\s*\*\*タイトル\*\*\s*\|\s*(.+?)\s*\|", text)
    if title_m:
        meta["title"] = title_m.group(1).strip()
        meta["topic"] = meta["title"]

    price_m = re.search(r"\|\s*\*\*価格\*\*\s*\|\s*¥?([\d,]+)", text)
    if price_m:
        meta["price"] = int(price_m.group(1).replace(",", ""))

    pillar_m = PILLAR_RE.search(text)
    if pillar_m:
        meta["pillar"] = pillar_m.group(1)

    return meta


def build_improvement_prompt(old_text: str, meta: dict, voice: str, sales: str,
                              persona: str, playbook: str, note_skill: str) -> str:
    return f"""あなたは「残業嫌いのらくだ先生🐪」のnote記事を**改善**します。

**🚨 最重要: AI生成と気付かれない、伊神さんが書いた風の記事に磨き上げる 🚨**

==== 最優先参照1: 伊神さんの実際の口調・人物情報 ====
{voice}

==== 最優先参照2: 売れる記事の戦略 ====
{sales}

==== ペルソナ基本 ====
{persona[:2000]}

==== SNS基本 ====
{playbook[:1500]}

==== noteノウハウ ====
{note_skill[:3000]}

==== 改善対象の旧記事 ====
タイトル: {meta['title']}
価格: ¥{meta['price']}
柱: {meta['pillar']}

旧本文:
---
{old_text[:6000]}
---

==== あなたの改善タスク ====
旧記事を以下の観点で**全面的に書き直す**:

1. **タイトル**: voice-and-style + sales-playbook の鉄則で「数字・対比・具体性」を入れて32字以内に
2. **書き出し500字**: 失敗・葛藤・本音から始める（「皆さんこんにちは」NG）
3. **無料部分**: 3,500〜4,000字。物語と試行錯誤、伊神さんの具体エピソード（席替え時短、-50万デイトレ、80/15/5配分など）を実体験ベースで
4. **ペイウォール手前**: 「ここから先は『どうやるか』」と明示
5. **有料部分**: 2,500〜3,000字。コピペできるテンプレ・手順・チェックリスト・具体数値表
6. **口調**: voice-and-style の特徴（「〜だよね」「〜かな」、消極的本音）を再現
7. **NG**: 「結論から言うと」「いかがでしたか」等の典型AI表現は絶対使わない

==== 出力フォーマット ====
旧記事と同じフォーマット（投稿メタデータ表 + 記事本文 + ペイウォール）。
タイトルは新しいものに更新。
"""


def char_count(text: str) -> int:
    """ペイウォール除いた実質文字数"""
    body = re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)
    return len(body)


def is_meaningful_improvement(old: str, new: str) -> tuple[bool, str]:
    """新版が旧版より実質的に改善されているか判定"""
    if not new or len(new) < 1000:
        return False, "新版が短すぎる"

    old_count = char_count(old)
    new_count = char_count(new)
    diff = new_count - old_count

    # 大幅増加: 確実に改善
    if diff >= IMPROVEMENT_MIN_CHAR_DIFF:
        return True, f"字数増加 ({old_count}→{new_count}, +{diff})"

    # 字数同等でも、voice-and-style の鉄板素材が新しく入っていれば改善とみなす
    key_phrases = [
        "−50万", "-50万", "デイトレ",
        "席替え", "2時間", "30分",
        "オルカン", "S&P500", "ナスダック",
        "FANG+", "ゴールド",
        "実家", "バリスタファイア",
        "サウナ", "ボードゲーム",
    ]
    old_hits = sum(1 for p in key_phrases if p in old)
    new_hits = sum(1 for p in key_phrases if p in new)

    if new_hits >= old_hits + 3:
        return True, f"voice素材が増えた ({old_hits}→{new_hits} ヒット)"

    return False, f"差分小（旧{old_count}字/{old_hits}素材、新{new_count}字/{new_hits}素材）"


def improve_article(path: Path, client: OpenAI, knowledge: dict) -> tuple[bool, str]:
    """1記事の改善を試行。Trueなら新ファイル保存済み。"""
    old_text = path.read_text(encoding="utf-8")
    meta = extract_meta(old_text)

    print(f"  → 改善試行: {path.name}（柱{meta['pillar']} ¥{meta['price']}）")

    if not meta["title"]:
        return False, "タイトル不明・スキップ"

    prompt = build_improvement_prompt(
        old_text, meta,
        voice=knowledge["voice"],
        sales=knowledge["sales"],
        persona=knowledge["persona"],
        playbook=knowledge["playbook"],
        note_skill=knowledge["note_skill"],
    )

    try:
        response = client.chat.completions.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            temperature=0.8,
            messages=[{"role": "user", "content": prompt}],
        )
        new_body = response.choices[0].message.content or ""
    except Exception as e:
        return False, f"API失敗: {e}"

    # 品質研磨
    quality_note = ""
    try:
        from quality_check_article import polish
        new_body, q = polish(new_body)
        quality_note = f" / 品質スコア {q.score}"
    except Exception:
        pass

    ok, reason = is_meaningful_improvement(old_text, new_body)
    if not ok:
        return False, reason

    # v2 保存
    v2_path = path.with_name(path.stem + "-v2.md")
    header = (
        f"<!-- IMPROVED-FROM: {path.name} at {datetime.datetime.now().isoformat(timespec='seconds')} -->\n"
        f"<!-- 旧版を voice-and-style + sales-playbook の最新情報で再生成 + quality_check_article で研磨 -->\n"
        f"<!-- 改善判定: {reason}{quality_note} -->\n\n"
    )
    v2_path.write_text(header + new_body, encoding="utf-8")
    return True, f"保存: {v2_path.name}（{reason}{quality_note}）"


def main() -> int:
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        print("ERROR: GITHUB_TOKEN 未設定", file=sys.stderr)
        return 1

    files = existing_article_files()
    if not files:
        print("⏭ 改善対象の記事なし")
        return 0

    print(f"📚 改善対象: {len(files)}記事")

    knowledge = {
        "voice": read_or_empty(VOICE_PATH),
        "sales": read_or_empty(SALES_PATH),
        "persona": read_or_empty(PERSONA_PATH),
        "playbook": read_or_empty(PLAYBOOK_PATH),
        "note_skill": read_or_empty(NOTE_SKILL),
    }

    if not knowledge["voice"]:
        print("⚠️ voice-and-style.md なし。改善ロジックは弱くなる")

    client = OpenAI(base_url=GH_MODELS_ENDPOINT, api_key=token)

    results = []
    for f in files:
        ok, msg = improve_article(f, client, knowledge)
        status = "✅" if ok else "⏭"
        line = f"{status} {f.name}: {msg}"
        print(line)
        results.append((ok, f.name, msg))

    # サマリー出力
    SUMMARY_PATH.parent.mkdir(parents=True, exist_ok=True)
    summary = ["# 既存記事 自動改善サマリー", ""]
    summary.append(f"実行日時: {datetime.datetime.now().isoformat(timespec='seconds')}")
    summary.append(f"対象: {len(results)}記事 / 改善: {sum(1 for r in results if r[0])}記事")
    summary.append("")
    summary.append("## 詳細")
    for ok, name, msg in results:
        summary.append(f"- {'✅' if ok else '⏭'} `{name}`: {msg}")
    SUMMARY_PATH.write_text("\n".join(summary), encoding="utf-8")

    improved_count = sum(1 for r in results if r[0])
    print(f"\n📊 {improved_count}/{len(results)} 記事を改善")

    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as f:
            f.write(f"improved_count={improved_count}\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())
