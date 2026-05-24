# failures Skill

## Overview
過去にハマった失敗・注意点の集約。
実装開始前に確認して、同じ失敗を繰り返さない。

## When to use
- 実装を開始する前（特にCSS・JavaScript）
- 不具合が起きたとき（原因の手がかりとして）

## 主要な注意点（必ず確認）

詳細は `knowledge/failures.md` を読むこと。

| 問題 | 場面 | 対処 |
|---|---|---|
| 日本語フォント縦書きのブラウザ差異 | `writing-mode: vertical-rl` 使用時 | 4ブラウザで確認。代替で横書き＋回転を検討 |
| iOSでのtouchイベント | `touchstart` / `touchmove` 使用時 | `{ passive: true }` または `false` を明示 |
| localStorage in private mode | localStorage使用時 | 必ず try-catch で囲む |

## localStorage の定型コード

```javascript
function saveData(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
}
function loadData(key, defaultValue) {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch (e) { return defaultValue; }
}
```

## 追加ルール

- 新しいハマりポイントが出たら `knowledge/failures.md` に追記する
