#!/usr/bin/env python3
"""
記事品質チェック & 自動研磨スクリプト

generate_note_article.py が生成した記事を受け取り、以下を実施:

1. NG表現スキャン (典型的なAI表現を検出 → 置換 or 削除)
2. 実体験密度チェック (伊神さんの鉄板素材が何回出てくるか)
3. 段落バランス調整 (500字超の段落を自動分割)
4. 重要キーワード太字化 (数字・固有名詞)
5. 品質スコア算出 (0-100点)

返り値: (改善版テキスト, スコア, 問題リスト)

スコアが閾値以下なら呼び出し側で再生成可能。
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]

# ===== 1. NG表現リスト (AI生成感を出す典型) =====
AI_NG_PATTERNS: list[tuple[str, str]] = [
    # (検出パターン, 置換候補 or 空文字)
    (r"結論から(言う|申し上げ)と[、。]?", ""),
    (r"いかがでしたか[？?]", ""),
    (r"いかがでしょうか[？?]", ""),
    (r"皆さん[、。]?", ""),
    (r"皆様[、。]?", ""),
    (r"今回は[^。]+について(?:お話し|ご紹介)します", ""),
    (r"〜することができます", "〜できます"),
    (r"〜することができる", "〜できる"),
    (r"〜することが可能", "〜できる"),
    (r"\b素晴らしい\b", "いい"),
    (r"\bぜひ\b(?=お)", ""),
    (r"非常に", "とても"),
    (r"極めて", "すごく"),
    (r"〜と言えるでしょう", ""),
    (r"〜なのです[。]?", "〜です。"),
    (r"〜なのですよ", "〜です"),
    (r"〜と思います", "〜と感じてます"),  # 思います→感じてます で人間味
    (r"〜なのではないでしょうか", "〜じゃないかな"),
    (r"まず最初に", "まず"),
    (r"事前に", "先に"),
    # 過剰な箇条書き構文
    (r"^[\s]*[123]つのポイント", "1. ポイント"),
    (r"^([0-9]+)つの理由", r"\1つの理由"),
]

# ===== 2. 伊神さんの鉄板素材 (voice-and-style.md 由来・実体験キーワード) =====
EPISODE_KEYWORDS = {
    "時短系": ["席替え", "2時間→30分", "テスト解答用紙", "提出物入力", "学級編成", "ChatGPT", "Claude"],
    "資産形成系": ["-50万", "デイトレ", "オルカン", "S&P500", "ナスダック", "FANG+", "5年で2000万", "つみたてNISA", "iDeCoはやってない"],
    "教員系": ["中学校", "国語", "残業", "定時退勤", "教員のバトン", "公務員"],
    "ライフ系": ["実家暮らし", "婚約者", "保育士", "バリスタファイア", "サウナ", "ボードゲーム"],
    "コンテンツ系": ["教育ゲーム", "IOgames", "バイブコーディング", "HTML", "JS"],
}

# ===== 3. 太字化対象パターン =====
BOLD_PATTERNS = [
    r"(\d+[時分秒万円％%]\s*[→]\s*\d+[時分秒万円％%])",  # 例: 2時間→30分
    r"(月\s*\d+万円?)",  # 月10万
    r"(年\s*\d+万円?)",  # 年100万
    r"(\d+年で\d+万円?)",  # 5年で2000万
    r"(-?\d+万円)",  # -50万
    r"(オルカン|S&P500|NASDAQ100|ナスダック|FANG\+|つみたてNISA|iDeCo)",
    r"(席替え|デイトレ|定時退勤|残業ゼロ)",
]

# ===== 4. 段落バランス調整 =====
PARAGRAPH_MAX_CHARS = 500
SENTENCE_END_RE = re.compile(r"(?<=[。！？])(?=[^」』\n])")


@dataclass
class QualityReport:
    """品質チェック結果"""
    score: int
    ng_phrase_hits: int
    episode_density: int
    paragraphs_split: int
    bold_applied: int
    issues: list[str]


def scan_and_replace_ng(text: str) -> tuple[str, int]:
    """AI 典型表現の検出&置換"""
    hits = 0
    out = text
    for pattern, replacement in AI_NG_PATTERNS:
        matches = re.findall(pattern, out, re.MULTILINE)
        if matches:
            hits += len(matches)
            out = re.sub(pattern, replacement, out, flags=re.MULTILINE)
    # クリーンアップ
    out = re.sub(r"\n{3,}", "\n\n", out)
    out = re.sub(r"。\s*。+", "。", out)  # 重複句点
    out = re.sub(r"、\s*、+", "、", out)  # 重複読点
    out = re.sub(r"^[\s、。]+", "", out, flags=re.MULTILINE)  # 行頭の孤立句読点
    out = re.sub(r"\s+([。、])", r"\1", out)  # 句読点前の余分な空白
    return out, hits


def measure_episode_density(text: str) -> tuple[int, dict[str, int]]:
    """実体験キーワードの出現回数 (カテゴリ別)"""
    breakdown: dict[str, int] = {}
    total = 0
    for category, keywords in EPISODE_KEYWORDS.items():
        cnt = sum(text.count(kw) for kw in keywords)
        breakdown[category] = cnt
        total += cnt
    return total, breakdown


def apply_bold(text: str) -> tuple[str, int]:
    """重要キーワードを太字化 (既に**で囲まれていたらスキップ)"""
    applied = 0

    def replace(m: re.Match) -> str:
        nonlocal applied
        token = m.group(0)
        # 既にmarkdown bold/italic装飾の中ならスキップ
        if "**" in token:
            return token
        applied += 1
        return f"**{token}**"

    out = text
    for pattern in BOLD_PATTERNS:
        out = re.sub(pattern, replace, out)
    return out, applied


def split_long_paragraphs(text: str) -> tuple[str, int]:
    """500字超の段落を文単位で適切に分割"""
    split_count = 0
    paragraphs = text.split("\n\n")
    result: list[str] = []
    for para in paragraphs:
        if len(para) <= PARAGRAPH_MAX_CHARS or para.startswith("#"):
            result.append(para)
            continue
        # 文単位で分割
        sentences = SENTENCE_END_RE.split(para)
        chunk: list[str] = []
        chunk_len = 0
        for s in sentences:
            if chunk_len + len(s) > PARAGRAPH_MAX_CHARS and chunk:
                result.append("".join(chunk).strip())
                split_count += 1
                chunk = [s]
                chunk_len = len(s)
            else:
                chunk.append(s)
                chunk_len += len(s)
        if chunk:
            result.append("".join(chunk).strip())
    return "\n\n".join(result), split_count


def compute_score(report_dict: dict) -> int:
    """0-100点の品質スコア
    減点:
    - NG表現1個につき -3点 (max -30)
    - 実体験密度 < 5 → -20点, < 10 → -10点
    加点:
    - 太字適用 1個につき +1点 (max +10)
    """
    score = 100
    ng = min(report_dict["ng_phrase_hits"], 10)
    score -= ng * 3
    density = report_dict["episode_density"]
    if density < 5:
        score -= 20
    elif density < 10:
        score -= 10
    bold = min(report_dict["bold_applied"], 10)
    score += bold * 1
    return max(0, min(100, score))


def polish(text: str) -> tuple[str, QualityReport]:
    """記事を研磨して品質レポートを返す"""
    issues: list[str] = []

    # 1. NG表現スキャン&置換
    text, ng_hits = scan_and_replace_ng(text)
    if ng_hits > 5:
        issues.append(f"AI典型表現が{ng_hits}個検出→置換済み")

    # 2. 実体験密度測定
    density, breakdown = measure_episode_density(text)
    if density < 5:
        issues.append(f"実体験キーワードが{density}個しかない (推奨10個以上)")
    for cat, cnt in breakdown.items():
        if cnt == 0:
            issues.append(f"カテゴリ「{cat}」のキーワード0件")

    # 3. 段落分割
    text, split_count = split_long_paragraphs(text)
    if split_count > 0:
        issues.append(f"長すぎる段落を{split_count}箇所分割した")

    # 4. 太字化
    text, bold_count = apply_bold(text)

    report_dict = {
        "ng_phrase_hits": ng_hits,
        "episode_density": density,
        "paragraphs_split": split_count,
        "bold_applied": bold_count,
    }
    score = compute_score(report_dict)

    return text, QualityReport(
        score=score,
        ng_phrase_hits=ng_hits,
        episode_density=density,
        paragraphs_split=split_count,
        bold_applied=bold_count,
        issues=issues,
    )


def report_to_markdown(report: QualityReport) -> str:
    """品質レポートをMarkdownで整形"""
    lines = [
        f"## 品質チェックレポート",
        f"",
        f"- **スコア**: {report.score}/100",
        f"- NG表現検出: {report.ng_phrase_hits}件 (置換済み)",
        f"- 実体験密度: {report.episode_density}件 (推奨: 10件以上)",
        f"- 長段落分割: {report.paragraphs_split}箇所",
        f"- 太字適用: {report.bold_applied}箇所",
    ]
    if report.issues:
        lines.append("")
        lines.append("### 要注意")
        for i in report.issues:
            lines.append(f"- {i}")
    return "\n".join(lines)


if __name__ == "__main__":
    # CLI: ファイル渡されたら polish して上書き
    if len(sys.argv) < 2:
        print("Usage: quality_check_article.py <article.md> [--write]", file=sys.stderr)
        sys.exit(1)
    article_path = Path(sys.argv[1])
    if not article_path.exists():
        print(f"ERROR: {article_path} がありません", file=sys.stderr)
        sys.exit(1)

    text = article_path.read_text(encoding="utf-8")
    polished, report = polish(text)

    print(report_to_markdown(report))

    if "--write" in sys.argv:
        article_path.write_text(polished, encoding="utf-8")
        print(f"\n✅ 研磨済み内容で上書き: {article_path}")
    else:
        print("\n(--write をつけると上書き)")
