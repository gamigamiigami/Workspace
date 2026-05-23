# 失敗・ハマりポイント集

最終更新：2026-05-23

新しいエントリは **先頭に追加** する。プロジェクト名を必ず記載。

---

## テンプレート

```
### [YYYY-MM-DD] プロジェクト名 — タイトル

**状況：** どういう実装をしようとしていたか

**問題：** 何が起きたか

**原因：** なぜ起きたか

**解決策：** どう直したか

**再発防止：** 次回から気をつけること

**タグ：** #css #javascript #ios など
```

---

## 既知の注意事項（初期登録）

### [2026-05-23] 共通 — 日本語フォントの縦書き指定はブラウザ依存に注意

**状況：** CSS `writing-mode: vertical-rl` で縦書きレイアウトを実装

**問題：** ブラウザ・OS によって文字の向きや行間が異なる表示になる

**原因：** 縦書きのフォントレンダリングはブラウザ実装差が大きい

**解決策：** 縦書きを使う場合は Chrome / Firefox / Safari / iOS Safari の4環境で確認する

**再発防止：** 縦書きレイアウトが必要かどうか事前にユーザーに確認し、代替として横書き＋回転を検討する

**タグ：** #css #font #cross-browser

---

### [2026-05-23] 共通 — iOSでのtouchイベントはpassive:trueが必要な場合あり

**状況：** スクロール中のタッチ操作を `touchstart` / `touchmove` で制御しようとした

**問題：** iOS Safari でスクロールがカクつく、または警告が出る

**原因：** iOS はデフォルトでパッシブイベントを期待しており、`preventDefault()` を呼ぶと競合する

**解決策：**
```javascript
// passiveを明示する
element.addEventListener('touchstart', handler, { passive: true });

// preventDefault()が必要な場合はpassive:falseを明示
element.addEventListener('touchmove', handler, { passive: false });
```

**再発防止：** タッチイベントを使う際は最初から `passive` オプションを意識する

**タグ：** #javascript #ios #touch #performance

---

### [2026-05-23] 共通 — localStorageはプライベートモードで動作しない

**状況：** スコアや進捗を `localStorage` に保存する実装をした

**問題：** プライベート（シークレット）ブラウジングモードでエラーが発生し、ゲームが動かなくなる

**原因：** プライベートモードでは `localStorage` へのアクセスが制限・禁止される場合がある

**解決策：**
```javascript
// localStorage使用前にtry-catchで保護する
function saveData(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // プライベートモードや容量超過の場合は無視して続行
    console.warn('保存できませんでした:', e);
  }
}

function loadData(key, defaultValue) {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch (e) {
    return defaultValue;
  }
}
```

**再発防止：** `localStorage` を使う場合は必ず try-catch で囲む

**タグ：** #javascript #localstorage #private-mode

---

## 関連リンク

- 成功パターン集 → [patterns.md](./patterns.md)
- コーディング規約 → [rules.md](./rules.md)
