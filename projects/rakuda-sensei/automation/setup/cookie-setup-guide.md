# セッションクッキー初回セットアップガイド

**所要時間: 約10分（note + BOOTH合計）**
**費用: ¥0**
**頻度: 初回のみ（クッキー期限が切れたら再実行）**

---

## なぜクッキーが必要なのか

note.comもBOOTHも「ログインして操作する」という仕組みでしか投稿できません。
自動化ツールがあなたの代わりにブラウザを操作するために、「ログイン済み状態」を
クッキー（一時的な認証情報）として保存しておく必要があります。

GitHubのSecretは暗号化されているので、他の人には見えません。

---

## ステップ1: Playwrightをローカルにインストール

あなたのパソコンでターミナル（Windowsはコマンドプロンプト）を開いて実行：

```bash
pip install playwright
playwright install chromium
```

---

## ステップ2: noteクッキーを取得

```bash
# Workspaceフォルダで実行
python projects/rakuda-sensei/automation/extract_cookies.py note
```

1. ブラウザが自動で開きます
2. **note.comにログインしてください**（普段通りのメール・パスワードで）
3. ログイン完了後、ターミナルに戻ってEnterを押す
4. JSONが表示されるのでコピーする

---

## ステップ3: noteクッキーをGitHub Secretに登録

1. GitHubでこのリポジトリを開く
2. **Settings** > **Secrets and variables** > **Actions** をクリック
3. **New repository secret** をクリック
4. 入力:
   - **Name**: `NOTE_SESSION_COOKIE`
   - **Secret**: ステップ2でコピーしたJSON
5. **Add secret** をクリック

---

## ステップ4: BOOTHクッキーを取得

```bash
python projects/rakuda-sensei/automation/extract_cookies.py booth
```

1. ブラウザが開くので**BOOTHにログインする**（pixivアカウントで）
2. ログイン後、Enterを押す
3. JSONをコピーする

---

## ステップ5: BOOTHクッキーをGitHub Secretに登録

ステップ3と同じ手順で：
- **Name**: `BOOTH_SESSION_COOKIE`
- **Secret**: ステップ4でコピーしたJSON

---

## セットアップ完了！自動投稿の使い方

### note記事を投稿する

1. GitHubで **Actions** タブを開く
2. **Post Article to note.com** をクリック
3. **Run workflow** をクリック
4. `article_path` に記事ファイルのパスを入力
   - 例: `projects/rakuda-sensei/articles/001-time-saving-routine.md`
5. **Run workflow** をクリック

### BOOTH商品を出品する

1. GitHubで **Actions** タブを開く
2. **List Product on BOOTH** をクリック
3. **Run workflow** をクリック
4. 必要事項を入力して **Run workflow** をクリック

---

## クッキーの有効期限について

クッキーには有効期限があります（通常30〜90日）。
期限切れになるとエラーが出るので、その場合はステップ2〜5を再実行してください。

---

## よくある問題

| エラーメッセージ | 対処法 |
|---|---|
| `NOTE_SESSION_COOKIE が設定されていません` | ステップ3を実施してください |
| `セッションクッキーが無効または期限切れです` | ステップ2〜3を再実施してください |
| `タイトル入力欄が見つかりませんでした` | note.comのサイト構造が変わった可能性あり。Issueを立ててください |
| `ファイルアップロードに失敗` | PDFファイルパスを確認してください |
