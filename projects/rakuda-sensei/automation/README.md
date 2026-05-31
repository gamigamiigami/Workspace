# らくだ先生 自動化パイプライン（完全無料・全自動・マルチプラットフォーム）

副業運用の完全自動化インフラ。**5プラットフォーム + ダッシュボードUI**を統合管理。
**CLAUDE.mdの「💰 お金のルール」に従い、有料サービスへの新規課金は一切しない。**

## 🤖 完全自動化パイプライン（2026-05-31追加）

毎週日曜21:00 UTC（JST月曜6:00）に **weekly-content-pipeline.yml** が起動：

1. **X週次14本AI生成**（3本柱ローテ: ICT時短/資産形成/バイブコーディング）
2. **note記事1本AI生成** → 翌日11時に自動投稿
3. **BOOTH教材1本AI生成**（隔週） → 翌日に自動出品
4. 1日2回（7:00/21:00 JST）X & Threadsに自動投稿
5. 毎月1日にPDCA分析 → インサイトを翌週の生成プロンプトに自動反映

**人間の手入れゼロで月100本超のコンテンツが回り続ける。**

---

## 🎯 ダッシュボード（投稿管理UI）

GitHub Pagesでホストされた統合ダッシュボードから全プラットフォームを操作：

**URL**: `https://gamigamiigami.github.io/Workspace/`
（初回プッシュ後、GitHub > Settings > Pages > Source: "GitHub Actions"を選択すると有効化）

機能：
- 📅 今週のSNS投稿（X/Threads/Instagram）を一覧表示
- 🚀 ワンクリック投稿（複数プラットフォーム同時可）
- 📝 note記事ドラフト一覧 → ワンクリック公開
- 🛒 BOOTH商品一覧 → ワンクリック出品
- 📊 直近の自動化実行ログ確認

## 📡 対応プラットフォーム（全部¥0）

| プラットフォーム | 認証方式 | 自動化方法 | リスク |
|---|---|---|---|
| X (Twitter) | メール/パスワード | Playwright | 🟡 アカウントロックリスクあり |
| **Threads** | Meta公式API | Graph API | 🟢 公式認可・安全 |
| **Instagram** | Meta公式API | Graph API | 🟢 公式認可・安全（画像必須） |
| note | メール/パスワード | Playwright | 🟢 比較的安全 |
| BOOTH | pixivメール/パスワード | Playwright | 🟢 比較的安全 |

---

## アーキテクチャ

```
[Phase 1] AI週次X投稿生成 ← ✅ 自動
    GitHub Actions cron (金 21:00 UTC)
    └─ GitHub Models (gpt-4o-mini・無料) で14本生成 → auto-commit

[Phase 2A] X 1日2回自動投稿 ← ✅ 自動
    GitHub Actions cron (毎日 7:00 / 21:00 JST)
    └─ Playwright で自動ログイン → 該当スロットのツイートを投稿

[Phase 2B] note 記事投稿 ← ✅ ワンクリック自動
    GitHub Actions workflow_dispatch
    └─ Playwright で自動ログイン → 記事自動入力 → 公開

[Phase 2C] BOOTH 商品出品 ← ✅ ワンクリック自動
    GitHub Actions workflow_dispatch
    └─ Playwright で自動ログイン → 商品登録 → 出品

[Phase 3] 月次PDCA分析 ← ✅ 自動
    GitHub Actions cron (毎月1日 09:00 UTC)
    ├─ 人間: 月初5分で各管理画面からCSV取得 → data/{YYYY-MM}/ にcommit
    └─ GitHub Models で分析 → reports/{YYYY-MM}-pdca.md に自動生成
```

**初回セットアップ: 6個のSecretを登録するだけ（2分）**
**以降の人間作業: 月5分（CSV commit）+ 記事/商品制作時間のみ**

---

## 使用サービスと費用一覧（全部¥0）

| サービス | 用途 | 費用 | 認証方法 |
|---|---|---|---|
| GitHub Actions | 自動実行基盤 | ¥0（パブリックリポ無制限） | 自動 |
| GitHub Models | AI生成・分析 | ¥0（GITHUB_TOKEN使用） | 自動 |
| Playwright | ブラウザ自動化 | ¥0（MIT License） | メール/パスワード |
| note.com | 記事投稿 | ¥0 | NOTE_EMAIL / NOTE_PASSWORD |
| BOOTH | 教材販売 | ¥0（成功報酬のみ） | PIXIV_EMAIL / PIXIV_PASSWORD |
| X (Twitter) | SNS発信 | ¥0（公式API不使用） | X_USERNAME / X_PASSWORD |
| **合計** | | **¥0** | |

---

## セットアップ

### 必須：基本Secret登録（2分）
`setup/secrets-setup.md` 参照。GitHubのSettings > Secrets and variables > Actions に登録：

| Secret名 | 値 |
|---|---|
| `NOTE_EMAIL` / `NOTE_PASSWORD` | noteログイン情報 |
| `PIXIV_EMAIL` / `PIXIV_PASSWORD` | pixiv（BOOTH用） |
| `X_USERNAME` / `X_PASSWORD` | Xログイン情報 |

### オプション：Meta API（Threads/Instagram用・30分）
`setup/meta-api-setup.md` 参照。**Threads/Instagramを使う場合のみ必要**。

| Secret名 | 値 |
|---|---|
| `THREADS_ACCESS_TOKEN` | Threads長期トークン |
| `THREADS_USER_ID` | Threads User ID |
| `META_ACCESS_TOKEN` | Instagram長期トークン |
| `IG_USER_ID` | Instagram Business User ID |

---

## Phase別の動作

### Phase 1: AI週次X投稿生成

- **トリガー**: 毎週金曜21:00 UTC（JST土曜6:00）
- **動作**: `knowledge/persona.md` + `knowledge/sns-playbook.md` を入力にGitHub Modelsで14本生成
- **出力**: `projects/rakuda-sensei/sns/weekly/{YYYY-MM-DD}-x-posts.md`
- **手動実行**: Actions > "Weekly X Content Generation" > Run workflow

### Phase 2A: X 自動投稿

- **トリガー**: 毎日 22:00 UTC (翌7:00 JST朝スロット) と 12:00 UTC (21:00 JST夜スロット)
- **動作**: 該当日のweeklyファイルを読み、該当スロットのツイートを投稿
- **状態管理**: `projects/rakuda-sensei/sns/.x-posted.log` に投稿済みスロットを記録（二重投稿防止）
- **手動実行**: Actions > "Post Tweet to X" > Run workflow

### Phase 2B: note 記事投稿

- **トリガー**: 手動（workflow_dispatch）
- **使い方**:
  1. Actions > "Post Article to note.com" > Run workflow
  2. `article_path` に記事ファイルパスを入力
  3. Run workflow → 約3分で投稿完了
- **記事フォーマット**: `projects/rakuda-sensei/articles/001-time-saving-routine.md` を参考に
  - 投稿メタデータ表（タイトル/価格/タグ）はスクリプトが自動解析
  - 本文中の `────────── ペイウォール ──────────` 行で無料/有料を分離

### Phase 2C: BOOTH 商品出品

- **トリガー**: 手動（workflow_dispatch）
- **使い方**:
  1. Actions > "List Product on BOOTH" > Run workflow
  2. `product_path` に商品HTMLパス、`pdf_path` にPDFパスを入力
  3. Run workflow → 約3分で出品完了
- **商品フォーマット**: HTMLコメントにメタ情報を埋め込む
  ```html
  <!-- BOOTH_TITLE: 商品名 -->
  <!-- BOOTH_PRICE: 300 -->
  <!-- BOOTH_DESC: 商品説明文 -->
  <!-- BOOTH_TAGS: タグ1,タグ2,タグ3 -->
  ```

### Phase 3: 月次PDCA分析

- **トリガー**: 毎月1日 09:00 UTC（JST18:00）
- **人間タスク（月初5分）**:
  1. note/BOOTH/Kindleの管理画面から売上CSVをダウンロード
  2. `projects/rakuda-sensei/data/{YYYY-MM}/` にcommit
- **自動**: GitHub Actionsがデータ読み取り → GitHub Modelsで分析 → レポート生成
- **出力**: `projects/rakuda-sensei/reports/{YYYY-MM}-pdca.md`

---

## ファイル構成

```
projects/rakuda-sensei/automation/
├── README.md                    # このファイル
├── requirements.txt             # openai + playwright
├── generate_weekly_x.py         # Phase 1: 週次X生成
├── post_to_x.py                 # Phase 2A: X自動投稿
├── post_to_note.py              # Phase 2B: note記事投稿
├── post_to_booth.py             # Phase 2C: BOOTH出品
├── monthly_pdca.py              # Phase 3: PDCA分析
└── setup/
    └── secrets-setup.md         # 初回Secret登録手順

.github/workflows/
├── weekly-x-content.yml         # Phase 1: 毎週金曜
├── post-to-x.yml                # Phase 2A: 毎日朝夜
├── post-to-note.yml             # Phase 2B: 手動
├── post-to-booth.yml            # Phase 2C: 手動
└── monthly-pdca.yml             # Phase 3: 毎月1日

projects/rakuda-sensei/
├── sns/
│   ├── weekly/{YYYY-MM-DD}-x-posts.md   # 週次生成ファイル
│   └── .x-posted.log                    # X投稿済み記録
├── articles/                            # note記事
├── products/                            # BOOTH商品（HTML）
├── data/{YYYY-MM}/                      # 月次売上CSV（人間commit）
└── reports/{YYYY-MM}-pdca.md            # AI生成PDCAレポート
```

---

## トラブルシューティング

### 共通：ログイン失敗

- パスワードが正しいかGitHub Secretsで確認
- 2段階認証が有効な場合は一時無効化または App Password を使用
- エラー時のスクリーンショットはActions実行詳細のArtifactsからダウンロード可能

### Xの自動投稿が失敗する場合

Xは自動化を厳しく検出します。失敗時の対処：

1. **追加認証要求 → メール認証コード**: 手動でXにログイン → 認証 → 再実行
2. **アカウント一時ロック**: Xに手動ログイン → ロック解除 → 24h待ってから再実行
3. **完全に避けたい**: X native scheduler（公式機能）に切り替え可能

代替: Phase 1の出力ファイル `sns/weekly/*.md` を人間が見て、X native schedulerに15分でセット
（こちらは100%安全だが手作業）

### note / BOOTHでサイト構造が変わった場合

`post_to_note.py` / `post_to_booth.py` のlocatorセレクタを更新する必要あり。
スクリーンショットを見て該当要素のセレクタを特定 → スクリプト修正 → コミット。

---

## 有料化禁止ルール（CLAUDE.md準拠）

このパイプラインに何かを追加するとき：

1. **絶対に勝手に有料化しない**
2. オーナーに「これは¥XX/月の有料サービスです。代替は◯◯」と必ず伝える
3. オーナーが明示OKしない限り無料縛りを維持
4. 無料の代替がない機能は「実装しない」「手動運用で代用」を選ぶ

過去の判断例:
- ❌ Anthropic API ($X/M tokens) → ✅ GitHub Models (¥0)
- ❌ Buffer Pro ($6/月) → ✅ Playwright on Actions (¥0)
- ❌ Browser Use SaaS ($30/月) → ✅ Playwright on Actions (¥0)
- ❌ X API Basic ($100/月) → ✅ Playwright auto-login (¥0、リスクあり)
- ❌ VPS ($5/月) → ✅ GitHub Actions runners (¥0)
