# らくだ先生 自動化パイプライン（完全無料縛り）

副業運用の自動化インフラ。
**CLAUDE.mdの「💰 お金のルール」に従い、有料サービスへの新規課金は一切しない。**

---

## アーキテクチャ（無料縛り版）

```
[Phase 1] AI週次X投稿生成 ← ✅ 実装済・稼働中
    GitHub Actions cron (毎週金曜21:00 UTC)
    └─ GitHub Models (gpt-4o-mini・無料) で14本生成 → auto-commit

[Phase 2] 投稿実行 ← ✅ 実装済（初回セットアップ5分が必要）
    ├─ note  → GitHub Actions + Playwright (workflow_dispatch)
    │          ※ NOTE_SESSION_COOKIE を GitHub Secret に登録後に使用可能
    ├─ BOOTH → GitHub Actions + Playwright (workflow_dispatch)
    │          ※ BOOTH_SESSION_COOKIE を GitHub Secret に登録後に使用可能
    ├─ X     → X native scheduler (手動15分/週・完全無料)
    └─ Kindle→ KDP手動 (APIなし・半年に1冊ペース)

[Phase 3] PDCA分析 ← ✅ 実装済
    毎月1日 09:00 UTC (JST 18:00) に自動実行
    ├─ 人間: 月初5分で各管理画面からCSV取得 → data/{YYYY-MM}/ にcommit
    └─ GitHub Models で分析 → reports/{YYYY-MM}-pdca.md に自動生成
```

**現実解: 「週25分（X scheduler設定）+ 月5分（CSV commit）の人間作業でAI自動運用」**

---

## 使用サービスと費用一覧（全部¥0）

| サービス | 用途 | 費用 | 認証方法 |
|---|---|---|---|
| GitHub Actions | 自動実行基盤 | ¥0（パブリックリポ無制限） | 自動 |
| GitHub Models | AI生成・分析 | ¥0（GITHUB_TOKEN使用） | 自動 |
| Playwright | ブラウザ自動化 | ¥0（MIT License） | クッキー認証 |
| note.com | 記事投稿 | ¥0（プラットフォーム側が無料） | セッションクッキー |
| BOOTH | 教材販売 | ¥0（成功報酬のみ） | セッションクッキー |
| X native scheduler | 予約投稿 | ¥0（X公式機能） | 手動 |
| **合計** | | **¥0** | |

---

## Phase 1: AI週次X投稿生成（実装済・完全無料）

### 動作

毎週金曜21:00 UTC（JST土曜6:00）にGitHub Actionsが起動：
1. GitHub Models（無料）の `gpt-4o-mini` でツイート14本を生成
2. `projects/rakuda-sensei/sns/weekly/{YYYY-MM-DD}-x-posts.md` に自動commit

入力：`knowledge/persona.md` + `knowledge/sns-playbook.md`

### 使い方

自動で動く（初回セットアップ不要）。

手動実行: GitHub > Actions > "Weekly X Content Generation" > "Run workflow"

---

## Phase 2: 記事・商品の自動投稿（初回5分セットアップ必要）

### 初回セットアップ（1回のみ・人間作業）

`setup/cookie-setup-guide.md` を参照。
要約：ローカルでPlaywrightを使いログイン → クッキーをGitHub Secretに登録。

### note記事を投稿する

1. GitHub > Actions > **"Post Article to note.com"**
2. **Run workflow** をクリック
3. `article_path` に記事ファイルパスを入力
   - 例: `projects/rakuda-sensei/articles/001-time-saving-routine.md`
4. Run workflow → 完了（約3分）

### BOOTH商品を出品する

1. GitHub > Actions > **"List Product on BOOTH"**
2. **Run workflow** をクリック
3. `product_path` に商品HTMLパスを入力
4. PDFファイルがある場合は `pdf_path` にも入力
5. Run workflow → 完了（約3分）

### X投稿（半自動・X native scheduler使用）

毎週土日に生成された `sns/weekly/` のファイルをレビューして、
月曜朝にX native schedulerに15分でセット。

---

## Phase 3: 月次PDCA分析（自動）

### フロー

毎月1日に自動実行。ただし売上データは人間が手動commitする必要あり。

**人間タスク（月初5分）:**
1. note/BOOTH/Kindleの管理画面から売上CSVをダウンロード
2. `projects/rakuda-sensei/data/{YYYY-MM}/` フォルダにcommit

**自動（0分）:**
- GitHub Actionsがデータを読み取り
- GitHub Modelsで分析
- `projects/rakuda-sensei/reports/{YYYY-MM}-pdca.md` に生成

手動実行: GitHub > Actions > "Monthly PDCA Report" > "Run workflow"

---

## ファイル構成

```
projects/rakuda-sensei/automation/
├── README.md                    # このファイル
├── requirements.txt             # Python依存 (openai + playwright)
├── generate_weekly_x.py         # Phase 1: X投稿生成
├── post_to_note.py              # Phase 2: note記事投稿
├── post_to_booth.py             # Phase 2: BOOTH商品出品
├── monthly_pdca.py              # Phase 3: PDCA分析
├── extract_cookies.py           # 初回セットアップ用クッキー抽出
└── setup/
    └── cookie-setup-guide.md   # 初回セットアップ手順（人間向け）

.github/workflows/
├── weekly-x-content.yml         # Phase 1: 毎週金曜cron
├── post-to-note.yml             # Phase 2: note投稿（手動トリガー）
├── post-to-booth.yml            # Phase 2: BOOTH出品（手動トリガー）
└── monthly-pdca.yml             # Phase 3: 毎月1日cron

projects/rakuda-sensei/data/
└── {YYYY-MM}/                   # 人間が月初にCSVをここにcommit

projects/rakuda-sensei/reports/
└── {YYYY-MM}-pdca.md            # AI生成PDCAレポート（自動）
```

---

## トラブルシューティング

### Phase 2でエラーになった場合

1. **`SESSION_COOKIE が設定されていません`** → `setup/cookie-setup-guide.md` を参照してSecretを登録
2. **`セッションクッキーが無効`** → クッキーの有効期限切れ。`extract_cookies.py` を再実行して再登録
3. **`入力欄が見つかりません`** → note.com/BOOTHのサイト構造変更の可能性。エラー時のスクリーンショットがActionsのArtifactsに保存されるので確認する

### note.com/BOOTHのUIが変わった場合

`post_to_note.py` / `post_to_booth.py` のセレクタ（`locator(...)` の引数）を
現在のページ構造に合わせて修正する。

---

## 有料化の誘惑への抵抗

実装中に「これだけ¥500/月払えば〜」と思った時の対応：

1. **絶対に勝手に有料化しない**
2. オーナーに「これは¥XX/月の有料サービスです。代替は◯◯」と必ず伝える
3. オーナーが明示OKしない限り無料縛りを維持
4. 無料の代替がない機能は「実装しない」「手動運用で代用」を選ぶ
