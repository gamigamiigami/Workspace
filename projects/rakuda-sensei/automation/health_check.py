#!/usr/bin/env python3
"""
週次ヘルスチェック (各プラットフォームの疎通確認)

毎週月曜 00:00 UTC に実行。
各プラットフォームに「投稿せずに」疎通確認だけ行い、
異常があればGitHub Issueを自動起票する。
"""

import datetime
import json
import os
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[3]
RESULTS_PATH = ROOT / "projects" / "rakuda-sensei" / "automation" / ".health-check.json"


def check_github_models() -> tuple[bool, str]:
    """GitHub Modelsの疎通確認"""
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        return False, "GITHUB_TOKEN未設定"
    try:
        r = requests.post(
            "https://models.github.ai/inference/chat/completions",
            headers={"Authorization": f"Bearer {token}"},
            json={"model": "openai/gpt-4o-mini", "messages": [{"role": "user", "content": "ping"}], "max_tokens": 5},
            timeout=15,
        )
        if r.status_code == 200:
            return True, "OK"
        return False, f"HTTP {r.status_code}: {r.text[:100]}"
    except Exception as e:
        return False, f"通信失敗: {e}"


def check_threads() -> tuple[bool, str]:
    """Threads APIの疎通確認"""
    token = os.environ.get("THREADS_ACCESS_TOKEN")
    user_id = os.environ.get("THREADS_USER_ID")
    if not token or not user_id:
        return True, "未設定（スキップ）"
    try:
        r = requests.get(
            f"https://graph.threads.net/v1.0/{user_id}",
            params={"fields": "id,username", "access_token": token},
            timeout=15,
        )
        if r.status_code == 200:
            data = r.json()
            return True, f"OK (@{data.get('username', '?')})"
        return False, f"HTTP {r.status_code}: {r.text[:100]}"
    except Exception as e:
        return False, f"通信失敗: {e}"


def check_instagram() -> tuple[bool, str]:
    """Instagram Graph APIの疎通確認"""
    token = os.environ.get("META_ACCESS_TOKEN")
    user_id = os.environ.get("IG_USER_ID")
    if not token or not user_id:
        return True, "未設定（スキップ）"
    try:
        r = requests.get(
            f"https://graph.facebook.com/v21.0/{user_id}",
            params={"fields": "id,username", "access_token": token},
            timeout=15,
        )
        if r.status_code == 200:
            data = r.json()
            return True, f"OK (@{data.get('username', '?')})"
        return False, f"HTTP {r.status_code}: {r.text[:100]}"
    except Exception as e:
        return False, f"通信失敗: {e}"


def check_note_reachable() -> tuple[bool, str]:
    """note.com 到達性確認"""
    try:
        r = requests.get("https://note.com/", timeout=15, allow_redirects=True)
        return (r.status_code == 200, f"HTTP {r.status_code}")
    except Exception as e:
        return False, f"通信失敗: {e}"


def check_booth_reachable() -> tuple[bool, str]:
    """BOOTH 到達性確認"""
    try:
        r = requests.get("https://booth.pm/", timeout=15, allow_redirects=True)
        return (r.status_code == 200, f"HTTP {r.status_code}")
    except Exception as e:
        return False, f"通信失敗: {e}"


def check_x_reachable() -> tuple[bool, str]:
    """X(Twitter) 到達性確認"""
    try:
        r = requests.get("https://x.com/robots.txt", timeout=15)
        return (r.status_code in (200, 301, 302), f"HTTP {r.status_code}")
    except Exception as e:
        return False, f"通信失敗: {e}"


def main() -> int:
    print(f"🩺 {datetime.datetime.utcnow().isoformat()} ヘルスチェック開始\n")

    checks = [
        ("GitHub Models", check_github_models),
        ("Threads API", check_threads),
        ("Instagram API", check_instagram),
        ("note.com 到達性", check_note_reachable),
        ("BOOTH 到達性", check_booth_reachable),
        ("X 到達性", check_x_reachable),
    ]

    results = []
    failures = []

    for name, fn in checks:
        ok, msg = fn()
        status = "✅" if ok else "❌"
        line = f"{status} {name}: {msg}"
        print(line)
        results.append({"check": name, "ok": ok, "message": msg})
        if not ok:
            failures.append(f"- **{name}**: {msg}")

    # 結果をJSONに保存
    RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    RESULTS_PATH.write_text(
        json.dumps(
            {
                "timestamp": datetime.datetime.utcnow().isoformat(),
                "results": results,
                "failure_count": len(failures),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    # GitHub Actions Step Summary に出力
    if "GITHUB_STEP_SUMMARY" in os.environ:
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as f:
            f.write("# 🩺 ヘルスチェック結果\n\n")
            for r in results:
                f.write(f"- {'✅' if r['ok'] else '❌'} **{r['check']}**: {r['message']}\n")

    # GITHUB_OUTPUT に失敗情報を渡す（Issue起票用）
    if "GITHUB_OUTPUT" in os.environ:
        with open(os.environ["GITHUB_OUTPUT"], "a") as f:
            f.write(f"failure_count={len(failures)}\n")
            if failures:
                # 複数行を1行に圧縮（GH Actions output制約）
                f.write("failure_summary<<EOF\n")
                f.write("\n".join(failures))
                f.write("\nEOF\n")

    print(f"\n📊 結果: 成功 {len(results) - len(failures)} / 失敗 {len(failures)}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
