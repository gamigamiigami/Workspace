# GitHub Secrets セットアップ（初回のみ2分）

自動投稿のために、ログイン情報をGitHub Secretに登録します。
**Secretsは暗号化されて保存されるので、他人には見えません。**

---

## 登録手順（全プラットフォーム共通）

1. GitHubでこのリポジトリを開く
2. **Settings** → **Secrets and variables** → **Actions** をクリック
3. **New repository secret** をクリック
4. Name と Secret を入力 → **Add secret**

---

## 登録するSecret一覧

| プラットフォーム | Secret名 | 値 |
|---|---|---|
| note | `NOTE_EMAIL` | noteログインメールアドレス |
| note | `NOTE_PASSWORD` | noteログインパスワード |
| BOOTH | `PIXIV_EMAIL` | pixivログインメールアドレス（BOOTHはpixivで認証） |
| BOOTH | `PIXIV_PASSWORD` | pixivログインパスワード |
| X | `X_USERNAME` | Xのユーザー名（@は不要）またはメール |
| X | `X_PASSWORD` | Xログインパスワード |

**合計6個。一度登録すれば以後は触らなくてOK。**

---

## セットアップ完了後の自動化フロー

| プラットフォーム | トリガー | 動作 |
|---|---|---|
| 週次X生成 | 金曜21:00 UTC (土6:00 JST) cron | AI生成 → Git commit |
| X投稿 | 毎日 7:00 / 21:00 JST cron | 該当スロットを自動投稿 |
| note記事投稿 | Actions手動トリガー | 指定記事を投稿 |
| BOOTH出品 | Actions手動トリガー | 指定商品を出品 |
| 月次PDCA | 毎月1日 18:00 JST cron | 売上分析 → レポート生成 |

---

## セキュリティについて

- GitHub Secretsは暗号化され、リポジトリ管理者のみアクセス可能
- ワークフロー実行時にのみ復号され、ログには出力されない
- 第三者には絶対に見えない（GitHubの公式仕様）

詳細: <https://docs.github.com/ja/actions/security-guides/using-secrets-in-github-actions>

---

## 既知のリスク

### X (Twitter) について

Xは自動化を検出すると以下のいずれかが起こる可能性があります：

1. **追加認証の要求**: メールでの本人確認コード入力
2. **一時的なアカウントロック**: 数時間〜数日の制限
3. **「不審なログイン」通知**: メールに警告が届く

**回避策:**
- 初回ログインは通常のブラウザで行ってから自動化を開始
- ロック時はXに手動ログインしてロック解除
- 完全に避けたい場合は X native scheduler（Xの予約投稿機能・無料）を使う

### note / BOOTH について

- 比較的安定だがメンテナンス等でセレクタが変わる可能性あり
- 失敗時はActions実行ログのArtifactにスクリーンショットが残るので確認

---

## トラブルシューティング

| エラー | 対処 |
|---|---|
| `*_EMAIL / *_PASSWORD が設定されていません` | 上記手順でSecretを登録 |
| `ログイン失敗` | パスワード再確認。2段階認証が有効な場合は一時無効化が必要 |
| `Xが認証コードを要求しています` | 手動でXにログインして本人確認後、再実行 |
| `入力欄が見つかりません` | サイト構造変更の可能性。Actionsログのスクショで確認 |
