# らくだ先生 自動化パイプライン

副業運用の自動化インフラ。3階層構成で段階的に実装する。

---

## アーキテクチャ概要

```
[Trigger] cron / Claude Code Scheduled
    ↓
[Phase 1] AI生成パイプライン  ← ✅ 実装済
    ├─ 週次X投稿14本ドラフト生成
    ├─ (将来) 月次note記事ドラフト生成
    └─ (将来) BOOTH教材アイデア生成
    ↓
[Phase 2] 投稿実行  ← ⏳ 設計済・未実装
    ├─ X     → Buffer連携 or X API
    ├─ note  → Playwright on VPS / Browser Use
    └─ BOOTH → Playwright on VPS
    ↓
[Phase 3] データ収集・PDCA  ← ⏳ 設計済・未実装
    ├─ 売上スクレイピング
    ├─ Claude APIで月次レポート生成
    └─ Slack/Discord通知
```

---

## Phase 1: AI週次X投稿生成（実装済）

### 動作

毎週金曜21:00 UTC（JST土曜6:00）にGitHub Actionsが起動し、
来週月〜日の14本（1日2本）のツイートドラフトをAIが生成。
`projects/rakuda-sensei/sns/weekly/{YYYY-MM-DD}-x-posts.md` に自動commit。

入力：`knowledge/persona.md` + `knowledge/sns-playbook.md`
出力：1週間分のツイート14本（型・本文・タグ）

### 初回セットアップ（10分・1回のみ）

#### 1. Anthropic API キー取得
- https://console.anthropic.com/settings/keys にログイン
  - Claude Codeを使っていれば同じアカウントで入れる
- 「Create Key」→ ワークスペース選択 → キーをコピー（`sk-ant-...`）

#### 2. GitHub Secret 登録
- リポジトリ https://github.com/gamigamiigami/Workspace
- Settings → Secrets and variables → Actions → New repository secret
- Name: `ANTHROPIC_API_KEY`
- Secret: ペースト → Add secret

#### 3. Workflow permissions 設定
- Settings → Actions → General → Workflow permissions
- 「Read and write permissions」を選択 → Save

#### 4. 動作確認
- Actions タブ → "Weekly X Content Generation" → "Run workflow"
- 1〜2分待つ → `projects/rakuda-sensei/sns/weekly/` に新ファイルができたらOK

### 運用フロー（週次）

| 曜日 | 担当 | アクション | 所要 |
|------|------|----------|------|
| 金 21:00 UTC（土 6:00 JST） | 🤖 自動 | AI が翌週14本生成 → Git commit | 1分 |
| 土 or 日 | 👤 人間 | 生成ファイルをレビュー、誤字・違和感修正 | 10分 |
| 月 朝 | 👤 人間 | Buffer (https://buffer.com) に14本セット | 15分 |
| 月〜日 | 🤖 Buffer | 自動予約投稿 | 0分 |

→ **週合計25分 / 月100分の人間作業でX運用が永続化**

### コスト

- GitHub Actions: 無料枠内（月使用は数分）
- Anthropic API (claude-sonnet-4-6): 週$0.10〜$0.15
- **合計: 月約¥60〜¥100**

### トラブルシュート

- 「ANTHROPIC_API_KEY が設定されていません」→ Step 2の登録を確認
- 「permission denied」on git push → Step 3 の Workflow permissions
- 生成内容がペルソナと違う → `knowledge/persona.md` を編集（次回から反映される）

---

## Phase 2: 投稿実行の自動化（設計）

各チャネルの自動投稿の選択肢：

### X (Twitter)
**推奨: Buffer (無料プラン)**
- 月1回30分で1ヶ月分の予約投稿セット
- API直叩きより安全・規約変動の影響を受けにくい
- 完全無人化したい場合は Buffer API + GitHub Actions で月初に一括登録も可

### note
**選択肢A: Playwright on VPS (¥500/月)**
- Sakura/ConoHa等の最安VPS + Playwright
- ログインCookie保存 → 定期実行
- 規約：bot明示禁止ではないが、頻繁な自動化はリスク
- 投稿頻度を抑えれば（週2-3本）検知されにくい

**選択肢B: Browser Use SaaS ($30/月〜)**
- https://browser-use.com/ など
- LLMがブラウザ操作（人間っぽい動き）
- 認証情報の管理が必要

**選択肢C: 半自動（推奨スタート）**
- AI生成 → Markdown → 人間が5分でnoteエディタにコピペ
- スクリプト不要・規約完全クリア・月25分

### BOOTH
- 出品 → Playwright on VPS（noteと相乗り）
- 本人確認・銀行口座登録は完全手動
- 商品PDFは GitHub Actions で `worksheet.html → PDF` 変換可能（Puppeteer）

### Kindle (KDP)
- KDP Publisher API は個人向け制限あり
- ePub変換は `pandoc` で自動化可能（GitHub Actions）
- 出版操作（カバー設定・カテゴリ選択・価格設定）は手動が現実的

### 推奨実装順
1. **X Buffer連携** (1日)
2. **note Playwright** (1週間)
3. **BOOTH Playwright** (3日・noteの仕組み流用)
4. **Kindle ePub自動化** (1日・出版は手動継続)

---

## Phase 3: データ収集・PDCA自動化（設計）

### 構成
```
[Cron 月初] → Playwright各管理画面ログイン → 売上・PV取得
              ↓
         SQLite に蓄積
              ↓
         Claude API: 月次PDCAレポート生成
              ↓
         Slack/Discord webhook通知
```

### 実装規模
- スクレイピングスクリプト各1日（4チャネル）
- PDCAレポート生成: 1日
- 通知設定: 半日

### KPI連動
`knowledge/pdca-kpi.md` の判断ルールをスクリプトに埋め込み、
- 撤退ライン下回り → 警告通知
- 健康ライン2倍超え → 拡大提案通知
- 目標達成 → お祝い通知

---

## ファイル構成

```
projects/rakuda-sensei/automation/
├── README.md                    # このファイル(アーキ&セットアップ)
├── requirements.txt             # Python依存
├── generate_weekly_x.py         # Phase 1: X投稿生成
├── (将来) post_to_note.py       # Phase 2: note自動投稿
├── (将来) collect_analytics.py  # Phase 3: データ収集
└── (将来) monthly_pdca.py       # Phase 3: 月次レポート

.github/workflows/
├── weekly-x-content.yml         # Phase 1: cron実装済
├── (将来) auto-post-note.yml
└── (将来) monthly-pdca.yml
```

---

## Phase 2-3の実装着手

Phase 1の動作確認後、伊神さんが方針OKを出したら着手する。
特に Phase 2 の note 自動投稿は「VPS or Browser Use SaaS or 半自動継続」の方針判断が必要。
