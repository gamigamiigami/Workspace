# Meta Graph API セットアップガイド（Threads / Instagram）

ThreadsとInstagramへの自動投稿に必要なAPIアクセストークンを取得する手順。
**所要時間: 約30〜45分（1回のみ）**
**費用: ¥0（Meta公式API、商用利用も無料）**

---

## なぜAPIを使うのか

XのようにPlaywrightでログインさせるとアカウントロックリスクがあります。
ThreadsとInstagramにはMeta公式の無料APIがあり、これを使えば：

- ✅ アカウントロックリスクなし（公式に認められた方法）
- ✅ 安定（UIが変わっても壊れない）
- ✅ 完全無料

代わりに**初回設定が約30分かかります**。一度設定すれば60日間有効、その後トークン更新だけで継続。

---

## 前提条件

- Instagramのアカウントを **「ビジネス」または「クリエイター」アカウント** に切り替える（無料・設定→アカウント→プロアカウントに切り替える）
- Facebookページを1つ持っている（無料・なければ作る）
- InstagramアカウントをFacebookページとリンクする（Instagramアプリ→設定→アカウントセンター）

---

## STEP 1: Meta Developer App 作成

1. <https://developers.facebook.com/> にアクセス
2. 右上「マイアプリ」→「アプリを作成」
3. ユースケース：**「その他」** を選択 → 次へ
4. アプリタイプ：**「ビジネス」** を選択 → 次へ
5. アプリ名：`rakuda-sensei-poster`（任意）
6. メール・ビジネスアカウント：自分のを選択
7. 「アプリを作成」

---

## STEP 2: Threads APIの有効化

1. 作成したアプリのダッシュボード左メニュー「製品を追加」
2. **「Threads API」** を見つけて「設定」
3. 「使用を開始」をクリック
4. 設定画面で：
   - **Threads User ID** を確認・控える（数字の羅列）
   - **Access Token** を生成・控える（長い文字列）

---

## STEP 3: Instagram Graph APIの有効化

1. 同じアプリで「製品を追加」→ **「Instagram」**
2. 「設定」をクリック
3. 「Instagram API setup with Instagram Login」を選択
4. Facebookページを接続
5. Instagramビジネスアカウントを接続
6. 設定画面で：
   - **Instagram User ID** を確認・控える
   - **Access Token** を生成・控える（Threadsとは別物）

---

## STEP 4: 長期トークンに変換（重要）

デフォルトのトークンは1時間で切れます。60日有効な長期トークンに変換：

```
https://graph.facebook.com/v21.0/oauth/access_token?
  grant_type=fb_exchange_token&
  client_id={app_id}&
  client_secret={app_secret}&
  fb_exchange_token={short_lived_token}
```

ブラウザのアドレスバーに入れてアクセスすると、長期トークンが返ってきます。

- `app_id` / `app_secret`: アプリ設定 → 基本設定で確認
- `short_lived_token`: STEP 2 / STEP 3 で取得したトークン

---

## STEP 5: GitHub Secretsに登録

GitHubリポジトリ → **Settings** → **Secrets and variables** → **Actions** に以下を登録：

| Secret名 | 値 | 用途 |
|---|---|---|
| `THREADS_ACCESS_TOKEN` | Threads長期トークン | Threads投稿 |
| `THREADS_USER_ID` | Threads User ID | Threads投稿 |
| `META_ACCESS_TOKEN` | Instagram長期トークン | Instagram投稿 |
| `IG_USER_ID` | Instagram Business User ID | Instagram投稿 |

---

## STEP 6: 動作確認

### Threads
GitHub Actions → "Post to Threads" → Run workflow
- `text`: "テスト投稿です" などを入力
- `dry_run`: false
- Run workflow → 約30秒で投稿完了

### Instagram
1. 投稿用ファイルを作る: `projects/rakuda-sensei/sns/instagram/test.md`
   ```
   ---
   image: https://gamigamiigami.github.io/Workspace/projects/rakuda-sensei/assets/test-image.png
   status: draft
   ---
   テスト投稿です🐪
   #教員のバトン
   ```
2. 画像をGitHub Pagesでホストする（dashboardフォルダに置けば自動配信）
3. Actions → "Post to Instagram" → post_path を指定して実行

---

## トークン期限切れ時の対応

長期トークンは60日有効。期限切れになったら：

1. STEP 4 のURLを再実行（古いトークンを入れ直し）
2. 新しい長期トークンを取得
3. GitHub Secretを上書き

または、refresh tokenエンドポイントで延長：
```
https://graph.threads.net/v1.0/refresh_access_token?
  grant_type=th_refresh_token&
  access_token={current_token}
```

---

## トラブルシューティング

| エラー | 原因 / 対処 |
|---|---|
| `Container作成失敗 (400)` | トークン期限切れ → STEP 4再実行 |
| `User ID取得失敗` | ビジネスアカウントへの切替を確認 |
| `IG投稿でimage_url無効` | 画像URLが公開アクセス可能か確認（GitHub Pagesデプロイ後でないとアクセス不可） |
| `media_publish失敗` | Container作成後5秒以上待つ必要あり（コード内で対応済） |

---

## なぜこんなに複雑なのか

Metaは2018年のCambridge Analytica事件以降、APIアクセスを厳格化しました。
- アプリ登録は本人確認の意味あり
- 長期トークンも自動延長で本人確認継続
- 結果として初回設定は重いが、その後は安全に運用可能

**XのようにIPアドレスでロックされるリスクはありません。**Meta公式が認めた方法だからです。

---

## 完了後の運用フロー

セットアップが完了すると以下が全自動になります：

- **Threads**: 毎日 7:00 / 21:00 JST に X と同じスロットを自動投稿
- **Instagram**: 投稿用MDファイルを置いてActions実行（手動トリガー）

すべてダッシュボード（`projects/rakuda-sensei/dashboard/`）から操作可能。
