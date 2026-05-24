# ui-components Skill

## Overview
コピペで使える再利用UIコンポーネント集。
実装前にこのスキルで使えるパーツを確認すること。

## When to use
- UIパーツを実装するとき
- 既存コンポーネントを流用できるか確認したいとき

## コンポーネント一覧

詳細なコードは `knowledge/ui-components.md` を読むこと。

| コンポーネント | 用途 | キーワード |
|---|---|---|
| モーダルダイアログ | 説明表示・確認ダイアログ | `openModal()` / `closeModal()` |
| タイマー表示 | 制限時間の表示・カウントダウン | `startTimer()` / `stopTimer()` |
| 選択肢ボタン | クイズの4択表示 | `renderChoices()` / `.choice-btn` |
| トースト通知 | 画面上部への一時メッセージ | `showToast()` |

## 使用手順

1. `knowledge/ui-components.md` を読む
2. 必要なコンポーネントのコードをコピー
3. HTML・CSS・JSをそれぞれ対応箇所に貼り付け

## 追加ルール

- 新しいUIパーツができたら `knowledge/ui-components.md` に追記する
- コンポーネントは独立して動作するよう設計する（他に依存しない）
