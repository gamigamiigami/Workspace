# patterns Skill

## Overview
過去に有効だった実装パターン集（100項目）。実装方針を決める前に見て、車輪の再発明を防ぐ。

## 使い方（トークン節約・この順で）
1. 索引 `knowledge/patterns.md`（約110行）を読む
2. 使えそうな項目だけ行番号で読む → `sed -n '120,160p' knowledge/details/patterns.md`
3. 索引に無さそうなら → `grep -n "キーワード" knowledge/details/patterns.md`

**`knowledge/details/patterns.md`（3,500行）を全文読まないこと。**

## 追記するとき
1. `knowledge/details/patterns.md` の先頭に追記（`### [分類] 見出し — プロジェクト名`）
2. `bash knowledge/details/build-index.sh` を実行して索引を作り直す
3. 複数プロジェクトで使えるものには `[汎用]` タグを付ける
