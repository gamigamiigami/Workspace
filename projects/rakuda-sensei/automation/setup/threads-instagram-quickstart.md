# Threads / Instagram 自動投稿 30分セットアップ

完全無料。Meta公式API使用（reCAPTCHA・アカウントロックリスクなし）。

---

## 全体の流れ

```
[1] Instagram をビジネス/クリエイターアカウントに切替 (3分)
  ↓
[2] Facebookページ作成 + Instagram と紐付け (5分)
  ↓
[3] Meta Developer App 登録 (10分)
  ↓
[4] Threads / Instagram API を有効化 + トークン取得 (10分)
  ↓
[5] GitHub Secrets に 4個登録 (2分)
  ↓
[6] 動作確認 (Run workflow)
```

---

## STEP 1: Instagram をプロアカウントに切替（3分）

1. Instagram アプリを開く
2. 自分のプロフィール → 右上 三本線 → **設定とアクティビティ**
3. **アカウントの種類とツール** → **プロアカウントに切り替える**
4. カテゴリ: 「**個人ブログ**」or「**教育**」を選択
5. 「クリエイター」または「ビジネス」を選択 → 完了

---

## STEP 2: Facebook ページ作成 & 連携（5分）

1. <https://www.facebook.com/pages/create> でページ作成
   - ページ名: 「残業嫌いのらくだ先生」
   - カテゴリ: 教育者・ブロガー
2. 作成完了後、Instagram の設定で **「Facebookページにリンク」**
3. 自分の Facebook で作ったページを選択

---

## STEP 3: Meta Developer App 登録（10分）

1. <https://developers.facebook.com/> でログイン（Facebook アカウントで）
2. 右上 **マイアプリ** → **アプリを作成**
3. ユースケース: **「その他」** を選択
4. アプリタイプ: **「ビジネス」** を選択
5. アプリ名: `rakuda-sensei-bot`（任意）
6. メールアドレス・ビジネスアカウント選択 → **アプリを作成**

---

## STEP 4: Threads API & Instagram Graph API 有効化（10分）

### Threads API
1. 作成したアプリのダッシュボード左メニュー **「製品を追加」**
2. **「Threads API」** を見つけて **設定**
3. **使用を開始** をクリック
4. Threads 認証 → アクセストークン発行
   - **Threads User ID** を控える（数字列）
   - **Threads アクセストークン** を控える

### Instagram Graph API
1. 同じアプリで **「製品を追加」** → **「Instagram」**
2. **Instagram API setup with Instagram Login** を選択
3. Facebookページを接続 → Instagramビジネスアカウントを接続
4. **Instagram User ID** を控える
5. **Instagram アクセストークン** を控える

### 長期トークン化（重要・必須）
発行直後のトークンは1時間で切れます。60日有効に変換：

ブラウザのアドレスバーに以下を貼り付け（{}部分は置換）：
```
https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id={APP_ID}&client_secret={APP_SECRET}&fb_exchange_token={SHORT_TOKEN}
```

返ってきたJSONの `access_token` が長期トークン。これを Secret に使う。

---

## STEP 5: GitHub Secrets に登録（2分）

<https://github.com/gamigamiigami/Workspace/settings/secrets/actions> で **New repository secret** を4回繰り返し：

| Name | 中身 |
|---|---|
| `THREADS_ACCESS_TOKEN` | Threads 長期トークン |
| `THREADS_USER_ID` | Threads User ID (数字) |
| `META_ACCESS_TOKEN` | Instagram 長期トークン |
| `IG_USER_ID` | Instagram User ID (数字) |

---

## STEP 6: 動作確認

### Threads
<https://github.com/gamigamiigami/Workspace/actions/workflows/post-to-threads.yml>
→ **Run workflow** → `text`: 「テスト投稿です🐪」 → Run

### Instagram
Instagram 投稿には**画像が必須**。先に画像ファイルを準備：
1. `projects/rakuda-sensei/assets/brand/icon-400.png` （既に生成済み）を使う
2. 別途投稿用 MD ファイルを作る (`sns/instagram/test.md`)
3. <https://github.com/gamigamiigami/Workspace/actions/workflows/post-to-instagram.yml> → Run

---

## トークン自動延長（既に仕込み済）

`refresh-tokens.yml` が月2回（1日・15日）自動で長期トークンを延長します。
**最初のセットアップが終われば、その後は何もしなくても永久に有効。**

---

## トラブル時の自己診断

| 症状 | 確認 |
|---|---|
| `Container作成失敗 (400)` | トークン期限切れ → STEP 4 の長期化を再実行 |
| `User ID 取得失敗` | プロアカウント切替を確認 |
| `IG投稿でimage_url無効` | GitHub Pages 経由で配信されてるか確認 |

---

## なぜこの設定が必要？

X (Playwright) と違って、Meta は **公式APIを無料提供**してます。
公式API経由なので：
- ✅ reCAPTCHA に弾かれない
- ✅ アカウントロックリスクゼロ
- ✅ 規約違反になりにくい
- ✅ 安定動作

代わりに**初回設定が30分かかる**だけ。その後は永久。
