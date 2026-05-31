# 🍪 セッションクッキー取得ガイド（reCAPTCHA回避）

**所要時間: 5分 / 費用: ¥0 / 頻度: 30〜90日に1回**

## なぜクッキーが必要？

note.com・BOOTHは「自動化された端末」からのログインを reCAPTCHA でブロックします。
**既にログインしたブラウザのクッキー**を使えば、ログインをスキップできて reCAPTCHA に当たりません。

---

## 🔧 ステップ1: Cookie-Editor 拡張機能をインストール

Chrome / Edge: <https://chromewebstore.google.com/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm>

→ 「Chromeに追加」をクリック

---

## 🔧 ステップ2: note.com のクッキー取得

1. **note.com にログイン**（普通にメール/パスワードで・1回だけ・reCAPTCHA来ても解決OK）
2. ログインできたらそのページを開いたまま、ブラウザ右上の **Cookie-Editor アイコン** をクリック
3. 右下の **Export** ボタンをクリック → **「Export as JSON」**
4. クリップボードに自動コピーされる

### GitHub Secret に登録

<https://github.com/gamigamiigami/Workspace/settings/secrets/actions> を開く

→ **New repository secret** をクリック
- Name: `NOTE_SESSION_COOKIE`
- Secret: 先ほどコピーしたJSONをそのまま貼り付け

---

## 🔧 ステップ3: BOOTH のクッキー取得

1. **BOOTH (manage.booth.pm) にログイン**
2. <https://manage.booth.pm/> を開いた状態で **Cookie-Editor** クリック → Export → Export as JSON
3. GitHub Secret に登録
   - Name: `BOOTH_SESSION_COOKIE`
   - Secret: コピーしたJSON

---

## ✅ 動作確認

両方登録したら、ワークフローを手動Run：

- **note**: <https://github.com/gamigamiigami/Workspace/actions/workflows/post-to-note.yml>
  → Run workflow → article_path に既存記事のパスを入力
- **BOOTH**: <https://github.com/gamigamiigami/Workspace/actions/workflows/post-to-booth.yml>
  → Run workflow → product_path を入力

ログで `🍪 クッキー認証 (N個のクッキー)` `✅ クッキーログインOK` が出れば成功。

---

## 🔄 クッキーが切れたら

エラーIssueが自動で立つので、その時にもう一度この手順を繰り返してください（5分）。

note: 通常30〜90日有効  
BOOTH: 通常30〜90日有効  

---

## 💡 Tip: Cookie-Editor が表示するJSON例

```json
[
  {
    "domain": ".note.com",
    "expirationDate": 1764000000,
    "hostOnly": false,
    "httpOnly": true,
    "name": "_note_session_v5",
    "path": "/",
    "sameSite": "lax",
    "secure": true,
    "session": false,
    "value": "abc123..."
  },
  ...
]
```

このような形式がそのまま使えます。**改変せずに全文コピペでOK**。
