# defuddle Skill

## Overview
Webページのナビゲーションやフッターなどノイズを除去し、本文だけをクリーンなMarkdownに変換するCLIツール。
トークン消費を抑えながら外部URLの内容を参照するために使う。

## When to use
- 外部URLの内容を参照・要約するとき
- WebFetchで取得すると情報量が多すぎる通常のWebページ

## When NOT to use
- `.md` ファイルの直接URL（WebFetchで十分）
- ローカルファイルの読み込み

## インストール

```bash
npm install -g defuddle-cli
```

インストール済みか確認: `defuddle --version`

## 基本コマンド

```bash
# URLの本文をMarkdownで取得（基本形）
defuddle parse <url> --md

# ファイルに保存する場合
defuddle parse <url> --md -o output.md

# タイトルだけ取得
defuddle parse <url> -p title

# JSON形式（HTML+Markdown両方含む）
defuddle parse <url> --json
```

## Workflow

1. 通常のWebページURLを受け取る
2. `defuddle parse <url> --md` を実行
3. 出力されたMarkdownを参照・要約する
4. ファイルに保存する場合は `-o` オプションを使う

## 注意

defuddleが使えない場合（未インストール等）はWebFetchで代替する。
