# コーディング規約・設計原則

最終更新：2026-05-23

---

## 基本規約

| 項目 | 規則 |
|------|------|
| 文字コード | UTF-8（`<meta charset="UTF-8">`を必ず記載） |
| インデント | スペース2つ |
| ファイル名 | kebab-case（例：`word-game.html`、`quiz-result.html`） |
| コメント言語 | 日本語OK |
| 外部ライブラリ | 極力使わない（vanilla JS / CSS のみで実装を目指す） |

---

## レスポンシブ・デバイス対応

- **スマホ対応を前提**にする（モバイルファーストで設計）
- `<meta name="viewport" content="width=device-width, initial-scale=1.0">` を必ず記載
- タップ領域は最低 44px × 44px 以上確保する
- フォントサイズはモバイルで `16px` 以上を基本とする
- 印刷を想定する場合は `@media print` スタイルを追加し、プロジェクトREADMEに記載する

---

## UI・UX設計

- 操作説明は **画面内に必ず表示**（別ページや外部文書に逃がさない）
- 中学生が直感的に使えるUIを目指す：
  - ボタンは大きく、ラベルは具体的に（「次へ」より「次の問題へ」）
  - ページ内のナビゲーションは常に見える位置に配置
- 正解・不正解のフィードバックは **視覚的に明示**：
  - 正解：緑系の色 + ✓マークまたはポジティブなメッセージ
  - 不正解：赤系の色 + ✗マークまたは正解の提示
  - 色だけに頼らず、形・テキストでも区別する（色覚対応）

---

## HTMLテンプレート

新規HTMLファイルはこのテンプレートをベースにする：

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>タイトル</title>
  <style>
    /* ===== リセット・基本スタイル ===== */
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: sans-serif;
      font-size: 16px;
      line-height: 1.6;
      padding: 16px;
      max-width: 600px;
      margin: 0 auto;
    }

    /* ===== ボタン共通 ===== */
    button {
      padding: 12px 24px;
      font-size: 16px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      min-width: 44px;
      min-height: 44px;
    }

    /* ===== フィードバック ===== */
    .correct   { background: #d4edda; color: #155724; border: 2px solid #28a745; }
    .incorrect { background: #f8d7da; color: #721c24; border: 2px solid #dc3545; }
  </style>
</head>
<body>

  <!-- ===== メインコンテンツ ===== -->
  <main id="app">
    <!-- ここにコンテンツを記述 -->
  </main>

  <script>
    // ===== 定数・設定 =====

    // ===== 状態管理 =====

    // ===== 初期化 =====
    function init() {

    }

    // ===== メイン処理 =====

    // ===== UI更新 =====
    function render() {

    }

    // ===== 起動 =====
    init();
  </script>

</body>
</html>
```

---

## JavaScriptスタイル

- `var` は使わない → `const` / `let` を使う
- DOM操作は `getElementById` より `querySelector` を優先
- イベントリスナーは `addEventListener` を使う（`onclick=` 属性に直書きしない）
- 関数名は動詞から始める（`showResult()`, `checkAnswer()`, `updateScore()`）

---

## 関連リンク

- 成功パターン集 → [patterns.md](./patterns.md)
- 失敗・注意点 → [failures.md](./failures.md)
- UIコンポーネント → [ui-components.md](./ui-components.md)
