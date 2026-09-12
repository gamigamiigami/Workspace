#!/bin/bash
# knowledge/details/*.md から、目次（索引）ファイル knowledge/*.md を作り直す。
# 詳細ファイルに追記したら必ずこれを実行する：  bash knowledge/details/build-index.sh
cd "$(dirname "$0")/../.." || exit 1
python3 - <<'PY'
import re, os
titles = {
  "patterns": ("成功パターン集", "うまくいった実装パターン。実装方針を決める前に見る。"),
  "failures": ("失敗・ハマりポイント集", "同じハマり方をしないための記録。実装前とデバッグ時に見る。"),
  "ui-components": ("再利用可能UIコンポーネント集", "コピペで使えるUI部品。"),
}
for name,(title,desc) in titles.items():
    src = f"knowledge/details/{name}.md"
    lines = open(src, encoding="utf-8").read().split("\n")
    heads = [(i+1, re.sub(r"^#{2,3}\s+", "", l).strip())
             for i, l in enumerate(lines) if re.match(r"^#{2,3}\s+\S", l)]
    out = [f"# {title}（索引）", "", desc, "",
           f"**全文は `{src}`（{len(lines)}行）。全文は読まないこと。**",
           "必要な項目だけ行番号で読む：`sed -n '120,160p' " + src + "`",
           "キーワードで探す：`grep -n \"キーワード\" " + src + "`", "",
           "追記したら索引を作り直す：`bash knowledge/details/build-index.sh`", "",
           "---", ""]
    for idx,(ln,t) in enumerate(heads):
        end = heads[idx+1][0]-1 if idx+1 < len(heads) else len(lines)
        out.append(f"- `{ln}-{end}` {t}")
    out.append("")
    open(f"knowledge/{name}.md","w",encoding="utf-8").write("\n".join(out))
    print(f"{name}.md 索引: {len(heads)}項目 / 詳細 {len(lines)}行")
PY
