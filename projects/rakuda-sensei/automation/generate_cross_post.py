#!/usr/bin/env python3
"""
note記事を各SNS向けに自動最適化 → 集客動線を作る

入力: note記事のmarkdownパス
出力: sns/cross-posts/{date}-{slug}/ に下記を保存
  - x-variants.md      X用ツイート3パターン (140字以内)
  - threads.md         Threads用 (500字)
  - instagram.md       IG用キャプション + 推奨ハッシュタグ
  - promo-meta.json    投稿時に使うメタ情報

GitHub Models (gpt-4o-mini) 使用・完全無料。

【使い方】
python generate_cross_post.py projects/rakuda-sensei/articles/2026-06-01-pillarB-xxx.md
"""

import datetime
import json
import os
import re
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

from openai import OpenAI

sys.path.insert(0, str(Path(__file__).parent))

ROOT = Path(__file__).resolve().parents[3]
CROSSPOST_DIR = ROOT / "projects" / "rakuda-sensei" / "sns" / "cross-posts"
VOICE_PATH = ROOT / "knowledge" / "voice-and-style.md"

GH_MODELS_ENDPOINT = "https://models.github.ai/inference"
MODEL = "openai/gpt-4o-mini"
JST = ZoneInfo("Asia/Tokyo")


def extract_meta(text: str) -> dict:
    """記事からタイトル・無料部分の核を抽出"""
    meta = {"title": "", "summary_seed": "", "tags": []}
    title_m = re.search(r"\|\s*\*\*タイトル\*\*\s*\|\s*(.+?)\s*\|", text)
    if title_m:
        meta["title"] = title_m.group(1).strip()
    elif (m := re.search(r"^#\s+(.+?)$", text, re.MULTILINE)):
        meta["title"] = m.group(1).strip()
    # 本文最初の300字 (LLMに渡すコンテキスト)
    body = re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)
    body = re.sub(r"^#.+?$", "", body, flags=re.MULTILINE)
    meta["summary_seed"] = body.strip()[:600]
    # タグ抽出
    tag_m = re.search(r"推奨タグ.*?(`#[^`]+`(?:\s*`#[^`]+`)*)", text)
    if tag_m:
        meta["tags"] = re.findall(r"`#([^`]+)`", tag_m.group(1))
    return meta


def build_prompt(meta: dict, voice: str, article_url: str) -> str:
    return f"""あなたは note記事を SNS で拡散するコピーライター。
「残業嫌いのらくだ先生🐪」名義で、3 つのプラットフォームに最適化した告知文を作る。

==== 記事情報 ====
タイトル: {meta['title']}
記事URL: {article_url or '(未公開・公開後に挿入)'}
タグ: {', '.join(meta['tags'])}

==== 本文冒頭 ====
{meta['summary_seed']}

==== 口調 (絶対準拠) ====
{voice[:3500]}

==== 生成タスク ====
1. **X (Twitter) 用ツイート 3 パターン**
   - 各 130-138 字 (URL の 23 字を引いて余裕を見て)
   - パターンA: 失敗談から始める (例:「日本株デイトレで-50万出した時〜」)
   - パターンB: 数字インパクト (例:「席替えを2時間→30分にした方法」)
   - パターンC: 問いかけ (例:「教員でも定時退勤、できると思う？」)
   - 末尾に「↓詳しくは note 記事」 + URL
   - ハッシュタグ 2-3 個

2. **Threads 用 1 本**
   - 380-450 字 (X より長く、読者と対話する感覚で)
   - 物語性高め、読者の感情に訴える
   - 末尾に URL + ハッシュタグ 1-2 個

3. **Instagram キャプション 1 本**
   - 700-900 字
   - 改行多めで縦に長く読ませる
   - 末尾に「プロフのリンクから記事へ」誘導 (IGはURL貼れないため)
   - ハッシュタグ 10-15 個 (#教員のバトン #公務員 #FIRE #つみたてNISA など)

==== 出力フォーマット (厳守) ====
```
===X-A===
{{X用ツイート パターンA・140字以内}}

===X-B===
{{X用ツイート パターンB・140字以内}}

===X-C===
{{X用ツイート パターンC・140字以内}}

===THREADS===
{{Threads用 380-450字}}

===INSTAGRAM===
{{Instagram用キャプション 700-900字}}
```

==== 絶対ルール ====
- 伊神さんの実体験キーワード必須 (席替え/-50万/オルカン/S&P500/2000万 等)
- 「いかがでしたか」「結論から言うと」「皆さん」等の AI 表現NG
- すべて伊神さんの口調 (〜だよね/〜かな/〜って感じ を混ぜる)
- バイアス無し・大げさNG・実体験ベース
"""


def parse_response(text: str) -> dict:
    """LLM応答を分解"""
    sections = {}
    keys = ["X-A", "X-B", "X-C", "THREADS", "INSTAGRAM"]
    for i, key in enumerate(keys):
        next_key = keys[i + 1] if i + 1 < len(keys) else None
        pattern = (
            rf"===\s*{re.escape(key)}\s*===\s*\n(.*?)(?=\n\s*===\s*{re.escape(next_key)}|$)"
            if next_key
            else rf"===\s*{re.escape(key)}\s*===\s*\n(.*?)$"
        )
        m = re.search(pattern, text, re.DOTALL)
        if m:
            sections[key] = m.group(1).strip().strip("`").strip()
    return sections


def slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9-]", "", s.lower())[:30] or "post"


def main(article_path: str, article_url: str = "") -> int:
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        print("ERROR: GITHUB_TOKEN 未設定", file=sys.stderr)
        return 1

    md_path = ROOT / article_path
    if not md_path.exists():
        print(f"ERROR: {md_path} がありません", file=sys.stderr)
        return 1

    text = md_path.read_text(encoding="utf-8")
    meta = extract_meta(text)
    voice = VOICE_PATH.read_text(encoding="utf-8") if VOICE_PATH.exists() else ""

    print(f"📄 元記事: {meta['title']}")
    print(f"🤖 モデル: {MODEL} (GitHub Models・無料)")

    client = OpenAI(base_url=GH_MODELS_ENDPOINT, api_key=token)
    response = client.chat.completions.create(
        model=MODEL,
        max_tokens=4000,
        temperature=0.85,
        messages=[{"role": "user", "content": build_prompt(meta, voice, article_url)}],
    )
    raw = response.choices[0].message.content or ""
    sections = parse_response(raw)

    if len(sections) < 3:
        print(f"WARNING: 出力が不完全 ({len(sections)}/5セクション)", file=sys.stderr)
        print("--- 生応答 ---")
        print(raw[:1000])

    # 品質研磨を各セクションに適用
    try:
        from quality_check_article import polish
        for k in list(sections.keys()):
            polished, _ = polish(sections[k])
            sections[k] = polished
    except Exception:
        pass

    # 保存
    today = datetime.datetime.now(JST).date()
    slug = slugify(meta["title"][:30])
    out_dir = CROSSPOST_DIR / f"{today.isoformat()}-{slug}"
    out_dir.mkdir(parents=True, exist_ok=True)

    # X variants
    x_md = (
        f"# X クロスポスト候補 ({today})\n\n"
        f"元記事: {meta['title']}\n"
        f"URL: {article_url or '(未公開)'}\n\n"
        f"## パターンA (失敗談入り)\n\n{sections.get('X-A', '(未生成)')}\n\n"
        f"## パターンB (数字インパクト)\n\n{sections.get('X-B', '(未生成)')}\n\n"
        f"## パターンC (問いかけ)\n\n{sections.get('X-C', '(未生成)')}\n"
    )
    (out_dir / "x-variants.md").write_text(x_md, encoding="utf-8")

    # Threads
    threads_md = (
        f"# Threads クロスポスト ({today})\n\n"
        f"元記事: {meta['title']}\n\n"
        f"---\n\n{sections.get('THREADS', '(未生成)')}\n"
    )
    (out_dir / "threads.md").write_text(threads_md, encoding="utf-8")

    # Instagram
    ig_md = (
        f"---\nimage: ./image.png\nstatus: draft\n---\n\n"
        f"{sections.get('INSTAGRAM', '(未生成)')}\n"
    )
    (out_dir / "instagram.md").write_text(ig_md, encoding="utf-8")

    # promo-meta.json
    promo_meta = {
        "generated_at": datetime.datetime.now(JST).isoformat(timespec="seconds"),
        "source_article": str(article_path),
        "source_title": meta["title"],
        "article_url": article_url,
        "platforms": list(sections.keys()),
        "model": MODEL,
    }
    (out_dir / "promo-meta.json").write_text(
        json.dumps(promo_meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"✅ クロスポスト生成完了: {out_dir}")
    for k in sections:
        print(f"   - {k}: {len(sections[k])}字")

    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as f:
            f.write(f"crosspost_dir={out_dir.relative_to(ROOT)}\n")
            f.write(f"x_a={sections.get('X-A', '')[:200]}\n")

    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: generate_cross_post.py <article_md_path> [article_url]", file=sys.stderr)
        sys.exit(1)
    article_path = sys.argv[1]
    article_url = sys.argv[2] if len(sys.argv) >= 3 else ""
    sys.exit(main(article_path, article_url))
