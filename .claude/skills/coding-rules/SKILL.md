# coding-rules Skill

## Overview
HTMLゲーム・ツール制作時のコーディング規約とテンプレート。
コード作業を開始する前にこのスキルを参照すること。

## When to use
- HTML / CSS / JavaScript を書くとき
- 新規プロジェクトを開始するとき
- 既存コードをレビュー・修正するとき

## 基本規約

| 項目 | 規則 |
|------|------|
| 文字コード | UTF-8（`<meta charset="UTF-8">` 必須） |
| インデント | スペース2つ |
| ファイル名 | kebab-case |
| 外部ライブラリ | 使わない（vanilla JS / CSS のみ） |
| フォント | system-ui（外部CDN不可の環境） |

## デバイス対応

- `<meta name="viewport" content="width=device-width, initial-scale=1.0">` 必須
- タップ領域: 最低 44px × 44px
- フォントサイズ: モバイルで 16px 以上
- **iPad縦持ち（768px）での表示を優先確認**

## JavaScriptスタイル

- `var` 禁止 → `const` / `let` を使う
- イベント: `addEventListener` を使う（`onclick=` 属性は使わない）
- 関数名: 動詞から始める（`showResult()`, `checkAnswer()`, `updateScore()`）
- DOM操作: `querySelector` 優先

## 新規プロジェクト開始前に確認すること

1. 対象学年・用途
2. PC / スマホ / iPad どれで使うか
3. 印刷の必要があるか
4. 既存プロジェクトとの共通部分があるか

## HTMLテンプレート

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>タイトル</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, sans-serif;
      font-size: 16px;
      line-height: 1.6;
      padding: 16px;
      max-width: 600px;
      margin: 0 auto;
    }
    button {
      padding: 12px 24px;
      font-size: 16px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      min-width: 44px;
      min-height: 44px;
    }
    .correct   { background: #d4edda; color: #155724; border: 2px solid #28a745; }
    .incorrect { background: #f8d7da; color: #721c24; border: 2px solid #dc3545; }
    .screen { display: none; }
    .screen.active { display: block; }
  </style>
</head>
<body>
  <!-- ===== メインコンテンツ ===== -->
  <main id="app">
    <section id="screen-start" class="screen active"><!-- スタート画面 --></section>
    <section id="screen-main"  class="screen"><!-- メイン画面 --></section>
    <section id="screen-result" class="screen"><!-- 結果画面 --></section>
  </main>

  <script>
    // ===== 定数・問題データ =====

    // ===== 状態管理 =====

    // ===== 初期化 =====
    function init() {}

    // ===== 画面切り替え =====
    function showScreen(id) {
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      document.getElementById(id).classList.add('active');
    }

    // ===== UI更新 =====
    function render() {}

    init();
  </script>
</body>
</html>
```

## 関連スキル
- UIコンポーネントが必要: `ui-components` スキル
- 過去の成功パターン: `patterns` スキル
- ハマりポイント確認: `failures` スキル
