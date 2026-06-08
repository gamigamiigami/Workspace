# 🚀 Instagram / Threads 自動投稿を有効化する 30分タスク

最終更新: 2026-06-08
状態: **コード側は全部準備済。あとは Meta API のトークンを GitHub Secrets に置くだけ。**

---

## 設定後に得られるもの

| ボリューム | 今 | 設定後 |
|---|---|---|
| X 自動投稿 | **20本/週** ✅ | 20本/週 |
| Threads 自動投稿 | 0 | **20本/週** 🆕 |
| Instagram 自動投稿 | 0 | **7本/週** 🆕 |
| note 公開後の Threads 告知 | スキップ | **自動投稿** 🆕 |
| 合計：週あたり SNS 露出 | 20 | **47** |

設定30分の対価として、 **同じコンテンツで露出が約2.4倍** になります。

---

## チェックリスト（順番通りにやる）

### [ ] ① Instagram をプロアカウントに切替（3分）
- アプリ → プロフィール → 三本線 → 設定 → アカウントの種類 → プロアカウント
- カテゴリ: 「教育」または「個人ブログ」 → クリエイター選択

### [ ] ② Facebookページ作成 & Instagram と連携（5分）
1. <https://www.facebook.com/pages/create> でページ作成
   - ページ名: 残業嫌いのらくだ先生
   - カテゴリ: 教育者・ブロガー
2. Instagram アプリで「Facebookページにリンク」 → 作ったページを選択

### [ ] ③ Meta Developer App 登録（10分）
1. <https://developers.facebook.com/> ログイン
2. マイアプリ → アプリを作成
   - ユースケース: その他
   - アプリタイプ: ビジネス
   - アプリ名: `rakuda-sensei-bot`

### [ ] ④ Threads API + Instagram Graph API を有効化（10分）
作成したアプリで：
1. 製品を追加 → **Threads API** → 使用を開始
   - **Threads User ID** をメモ（数字列）
   - **Threads アクセストークン** をメモ
2. 製品を追加 → **Instagram** → Instagram API setup with Instagram Login
   - Facebookページ接続 → Instagramビジネスアカウント接続
   - **Instagram User ID** をメモ
   - **Instagram アクセストークン** をメモ

### [ ] ⑤ トークンを長期化（必須・5分）
発行直後のトークンは1時間で切れます。ブラウザに以下を貼って60日有効に変換：
```
https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id={APP_ID}&client_secret={APP_SECRET}&fb_exchange_token={SHORT_TOKEN}
```
返ってきた JSON の `access_token` が長期トークン。これを Secret に登録する値。

### [ ] ⑥ GitHub Secrets に5個登録（2分）
<https://github.com/gamigamiigami/Workspace/settings/secrets/actions> で **New repository secret** を5回繰り返し：

| Name | 中身 |
|---|---|
| `THREADS_ACCESS_TOKEN` | Threads 長期トークン |
| `THREADS_USER_ID` | Threads User ID（数字） |
| `META_ACCESS_TOKEN` | Instagram 長期トークン |
| `IG_USER_ID` | Instagram User ID（数字） |
| `GH_PAT` | GitHub Personal Access Token（自動延長用・[作成手順](https://github.com/settings/tokens/new) で `repo` + `workflow` 権限を付ける） |

---

## 設定完了後の自動稼働スケジュール

| ワークフロー | 起動タイミング | 内容 |
|---|---|---|
| `post-to-threads.yml` | 朝07:00 / 昼12:30 / 夜21:00 JST | X週次ファイルから同じスロットの本文を Threads に投稿 |
| `daily-instagram.yml` | 毎日19:00 JST | X週次の朝スロット本文を1280×1280px画像化 → Instagram投稿 |
| `post-note-promo.yml` | note publish 完了直後（連鎖） | Threads に告知本文を投稿 |
| `refresh-tokens.yml` | 1日 / 15日 03:00 UTC | Meta長期トークンを自動延長（永久有効化） |

設定さえ終われば、 **何もしなくても永久に投稿が続きます**。

---

## トークン自動延長について

`refresh-tokens.yml` が月2回トークンを延長します。実装は `refresh_meta_tokens.py`。
**1度設定が終わればトークン期限切れの心配はゼロ。**

---

## トラブル時の自己診断

| 症状 | 確認 |
|---|---|
| Threads 投稿 400 エラー | トークン期限切れ → 手順⑤を再実行 |
| IG 投稿 image_url 無効 | raw.githubusercontent.com の URL が正しいか確認 |
| User ID 取得失敗 | プロアカウント切替を確認 |
| refresh-tokens 失敗 | `GH_PAT` の権限を確認（repo + workflow） |

---

## 動作テスト

### Threads
<https://github.com/gamigamiigami/Workspace/actions/workflows/post-to-threads.yml>
→ **Run workflow** → `text`: 「テスト🐪」 → Run

### Instagram
<https://github.com/gamigamiigami/Workspace/actions/workflows/post-to-instagram.yml>
→ **Run workflow** → 既に生成済の `sns/instagram/2026-06-08.md` を使う

両方緑なら完了。あとは自動運用。
