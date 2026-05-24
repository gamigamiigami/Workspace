# 🐪 らくだ先生 副業自動化 — オーナー作業手順書

**自動化システム実装は完了済み。あなたの手で5分〜45分の初回設定をすれば全自動稼働します。**

---

## ステップ1: GitHub Pages有効化（1分・必須）

ダッシュボード（投稿管理UI）をWebで開くために必要。

1. GitHubリポジトリを開く: <https://github.com/gamigamiigami/Workspace>
2. **Settings** タブをクリック
3. 左メニューの **Pages** をクリック
4. **Source** で **「GitHub Actions」** を選択
5. （自動で保存される）

完了したらしばらく待つと、以下のURLでダッシュボードが開きます：
**<https://gamigamiigami.github.io/Workspace/>**

---

## ステップ2: 基本Secrets登録（2分・必須）

note・BOOTH・X自動投稿の認証情報を登録。

1. GitHub > Settings > **Secrets and variables** > **Actions**
2. **New repository secret** を6回繰り返し、以下を登録：

| Name | Secret（中身） |
|---|---|
| `NOTE_EMAIL` | note.com ログインメール |
| `NOTE_PASSWORD` | note.com ログインパスワード |
| `PIXIV_EMAIL` | pixiv（BOOTHログイン）メール |
| `PIXIV_PASSWORD` | pixiv ログインパスワード |
| `X_USERNAME` | Xユーザー名（@は不要）またはメール |
| `X_PASSWORD` | X ログインパスワード |

> ⚠️ 2段階認証が有効な場合、自動ログインが失敗するため一時的に無効化が必要

---

## ステップ3: GitHub Personal Access Token作成（2分・必須）

ダッシュボードからActionsを起動するために必要。

1. GitHub右上のアバター → **Settings**
2. 左下 **Developer settings** → **Personal access tokens** → **Tokens (classic)**
3. **Generate new token (classic)** をクリック
4. 設定:
   - Note: `rakuda-dashboard`（任意）
   - Expiration: `No expiration` または `1 year`
   - スコープ: **`repo`** と **`workflow`** にチェック
5. **Generate token** をクリック
6. 表示されたトークン（`ghp_xxxxxx...`）をコピー
7. ダッシュボードを開いてトークンを貼り付け（ブラウザに自動保存される）

---

## ステップ4: ダッシュボード接続確認（1分）

1. <https://gamigamiigami.github.io/Workspace/> を開く
2. PATを入力 → **接続**
3. 「✅ 接続成功」が出ればOK
4. 「📅 今週のSNS投稿」「📝 note記事」「🛒 BOOTH商品」が表示される

---

## ステップ5（オプション）: Threads/Instagram対応（30〜45分）

X以外のSNSにも投稿したい場合のみ実施。
**詳細は <https://github.com/gamigamiigami/Workspace/blob/main/projects/rakuda-sensei/automation/setup/meta-api-setup.md> を参照。**

簡略版：
1. Instagramを「ビジネス」または「クリエイター」アカウントに切替（IGアプリ内・無料）
2. Facebookページと連携
3. <https://developers.facebook.com/> でMeta Developer App登録
4. Threads API / Instagram Graph API を有効化
5. 長期アクセストークン取得
6. GitHub Secretsに4個登録：
   - `THREADS_ACCESS_TOKEN`
   - `THREADS_USER_ID`
   - `META_ACCESS_TOKEN`
   - `IG_USER_ID`

---

## 動作確認テスト

### A. X週次投稿の自動生成
- GitHub > Actions > **"Weekly X Content Generation"** > **Run workflow**
- 1〜2分後に `projects/rakuda-sensei/sns/weekly/{date}-x-posts.md` が新規commitされていればOK
- ダッシュボードを更新すると今週分のツイート14本が表示される

### B. X投稿テスト
- ダッシュボードで「📅 今週のSNS投稿」から1つ選び「🚀 投稿」
- 約30秒後にXに投稿されていればOK
- **失敗時はScreenshot付きで Actions実行ログに残る**

### C. note記事投稿テスト
- ダッシュボードで「📝 note 記事」から `001-time-saving-routine.md` を選び「🚀 noteに投稿」
- 約2分後にnote下書きに作成されていればOK

### D. BOOTH出品テスト
- ダッシュボードで「🛒 BOOTH 商品」から `joshi-chu2-worksheet` を選び「🚀 BOOTHに出品」
- PDFパスを聞かれるので空欄でEnter（または `projects/rakuda-sensei/products/joshi-chu2-worksheet/worksheet.pdf` 等）
- 約2分後にBOOTH管理画面に下書き作成されていればOK

---

## トラブル時の対応

| 症状 | 対処 |
|---|---|
| ダッシュボードで「接続失敗」 | PATスコープに `repo` と `workflow` があるか確認 |
| 「ログイン失敗」エラー | 2段階認証を一時無効化、またはアプリパスワード使用 |
| Xで「認証コード要求」エラー | 手動でXにログインして本人確認 → 再実行 |
| Pages有効化したのに404 | Actions > "Deploy Dashboard" を手動Run → 数分待つ |

---

## 完成後の運用フロー

| 頻度 | あなたの作業 | 自動でやること |
|---|---|---|
| 毎日 | なし | 7:00 / 21:00 JST に X & Threads 自動投稿 |
| 毎週 金 | なし | 21:00 UTC に翌週X投稿14本AI生成 |
| 毎週 土日 | 生成された14本をダッシュボードで一覧確認、不要なら手動で除外 | - |
| 月1回 | note記事執筆 → ダッシュボードからワンクリック投稿 | - |
| 月1回 | BOOTH教材作成 → ダッシュボードからワンクリック出品 | - |
| 月1回 | 各管理画面からCSVをダウンロードしてcommit | 翌月1日にAI分析レポート自動生成 |

**人間作業: 月60〜120分**（記事執筆・教材制作の時間込み）
**費用: ¥0**

---

## 最終チェックリスト

セットアップ完了したらここをチェック：

- [ ] GitHub Pages有効化済み（ダッシュボードURL開ける）
- [ ] 基本Secrets 6個登録済み
- [ ] PAT作成済み、ダッシュボードで「接続成功」表示
- [ ] Actions > "Weekly X Content Generation" 手動Run → 成功
- [ ] ダッシュボードに今週分のツイートが表示される
- [ ] （Threads/IG使う場合）Meta API設定完了、Secret 4個登録済み

すべてチェックついたら、月10万円目標に向けて稼働開始🐪
