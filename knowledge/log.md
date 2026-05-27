# 作業ログ（全プロジェクト横断）

新しいエントリは **先頭に追加** する。

---

## テンプレート

```
### [YYYY-MM-DD] プロジェクト名

**作業内容：**
- 箇条書きで具体的に

**結果：** 成功 / 部分完了 / 失敗

**成果物：** `projects/{name}/ファイル名.html`

**気づき・メモ：**
- 次回に活かせること
```

---

## ログ

### [2026-05-27 最終セッション] sticky-todo — launch.bat ウィンドウサイズ微調整

**作業内容：**
- launch.bat の初期ウィンドウサイズを 760×540 → 380×270 に微調整
- ウィンドウリサイズ記憶機能実装済みのため、launch.bat は最小サイズを指定
- ユーザーが起動後にリサイズして好みのサイズを保存できるデザイン

**変更点：**
- `projects/sticky-todo/launch.bat` — ウィンドウサイズパラメータを `380,270` に変更

**結果：** 成功 / launch.bat 初期サイズ調整完了

**成果物：** 
- `projects/sticky-todo/launch.bat`（ウィンドウサイズ変更）

**気づき・メモ：**
- ウィンドウサイズ記憶機能があるため、launch.bat の初期サイズは最小値で良い
- ユーザー体験の観点では、まずコンパクトなUIで起動し、使いながらサイズ調整できる方が柔軟
- localStorage キー `todo-window-size` でサイズ管理されている
- リセット時の対応：`Ctrl+Shift+I` → Application → Local Storage → `todo-window-size` 削除

---

### [2026-05-27 セッション終盤・最終調整] sticky-todo — UIサイズ最適化・ウィンドウリサイズ記憶機能

**作業内容：**
- ウィンドウサイズを960×680 → 760×540にさらに縮小
- タイトルバー高さ：42px → 36px（-14%）
- カード幅：220px → 190px（-13%）
- 全体レイアウトをさらに詰めて密度を向上
- ウィンドウサイズ保存機能を実装（localStorage使用、リサイズ後のサイズを記憶・次回復元）
- 変更をcommit・push完了

**変更点：**
- `projects/sticky-todo/todo.html` — CSS スタイル全数値再調整 + JavaScript ウィンドウリサイズ保存処理を追加

**結果：** 成功 / UIサイズ最適化完了、ウィンドウリサイズ記憶機能実装

**成果物：** 
- `projects/sticky-todo/todo.html`（CSS・JavaScript修正）

**気づき・メモ：**
- localStorage を活用することでウィンドウサイズ保存が簡単に実装できる
- ユーザーが好みのサイズにカスタマイズ可能なUX設計がデスクトップアプリの利点
- ウィンドウリサイズ記憶機能パターンをpatterns.mdに昇華した

---

### [2026-05-27 最終セッション] sticky-todo — UIコンパクト化調整

**作業内容：**
- ウィンドウサイズを1280×820 → 960×680に縮小
- タイトルバー高さ：52px → 42px（-20%）
- フォントサイズ全般：1〜2px削減（タイトル15px→13px、その他12px→11px）
- カード最小幅：280px → 220px（-21%）
- カード間隔：14px → 10px（-28%）
- パディング・マージン・border-radiusなど全要素の一括調整
- 全変更を一括commit（"style: UIをコンパクト化・ウィンドウサイズを960x680に縮小"）

**変更点：**
- `projects/sticky-todo/todo.html` — CSS スタイル内の全数値調整

**結果：** 成功 / UIコンパクト化完了、視認性を保ちながらサイズ縮小を実現

**成果物：** 
- `projects/sticky-todo/todo.html`（CSS修正）

**気づき・メモ：**
- 複数セッションにわたるUI微調整パターンをpatterns.mdに昇華した
- 「小さい」という要望は数値ベースで調整するのが効率的
- CSS変数とデザインシステムの重要性が確認できた

---

### [2026-05-27 セッション終盤] sticky-todo — UI完全リデザイン（Windows 11 付箋風）

**作業内容：**
- タイトルバー：黒背景＋SVGアイコン＋Windowsアプリ風フォント実装
- カード背景：カテゴリ別カラー＋色帯（付箋風）実装
- 優先度表示：色付きドット●バッジに変更
- モーダル効果：背景ぼかし（backdrop-filter）＋スライドインアニメーション
- 空の状態表示：ノートSVGイラスト追加
- SVGアイコン作成：オレンジ角丸＋白い○＋チェックマーク（ブラウザタブ・タスクバー表示）
- ツールバー：より締まったWindows風デザインに刷新
- 全ファイル修正・commit・push完了

**変更点：**
- `projects/sticky-todo/index.html` — icon link, favicon 追加＋HTML構造微調整
- `projects/sticky-todo/style.css` — CSS変数・グラデーション・アニメーション・backdrop-filter 等
- `projects/sticky-todo/script.js` — SVGアイコン・ノートイラスト・スライドイン処理追加

**結果：** 成功 / UI完全リデザイン完了、Windowsアプリ風外観を実現

**成果物：** 
- `projects/sticky-todo/index.html`
- `projects/sticky-todo/style.css`
- `projects/sticky-todo/script.js`

**気づき・メモ：**
- SVG埋め込みで `text-anchor="middle"` を使うと中央配置が確実
- CSS変数でカテゴリカラー管理すると、新カテゴリ追加時の修正が最小限で済む
- `backdrop-filter: blur()` と `animation` の組み合わせで、Windowsアプリ風モーダルが実現可能
- 色帯＋SVGアイコン＋アニメーションの3要素がWindows付箋風デザインの鍵

---

### [2026-05-27 夜遅・深夜] sticky-todo — launch.bat 日本語フォルダ名URLエンコード対応

**作業内容：**
- ERR_FILE_NOT_FOUNDエラーの原因特定：フォルダ名「とどまる」の日本語文字がURLエンコードされていなかった
- PowerShellの `[uri]` クラスを活用して自動URLエンコード実装
- `launch.bat` を修正：Batch から PowerShell を呼び出し、ファイルパスを絶対URIに変換

**変更点：**
- `projects/sticky-todo/launch.bat` — PowerShell 統合版に刷新
  - 従来：Batch で直接 `file://パス` を生成（日本語エンコードなし）
  - 修正後：PowerShell で `[uri]` クラスを使用（自動エンコード）

**結果：** 成功 / 本質的な問題を解決

**成果物：** `projects/sticky-todo/launch.bat` (PowerShell統合版)

**気づき・メモ：**
- Batch スクリプトは日本語などの非ASCII文字を自動エンコードしない
- PowerShell `[uri]` クラスで `AbsoluteUri` プロパティを使うと、URLエンコード済みのURIスキーム形式が得られる
- 「とどまる」は `%E3%81%A8%E3%81%A9%E3%81%BE%E3%82%8B` へ自動変換される
- Batch と PowerShell の連携時、二重引用符のエスケープに注意

---

### [2026-05-27 夜遅] sticky-todo — UI最終調整（アプリ名・日付・提出先表示）

**作業内容：**
- アプリ名を「ToDo丸」に変更
- カードに提出先「📤 教頭先生」を表示
- カード下部に「作成 5/27」として作成日を常時表示
- launch.bat の Edge パス最終確認・修正（正式パス指定）

**変更点：**
- `projects/sticky-todo/todo.html` — テキスト・UI更新
- `projects/sticky-todo/launch.bat` — Edge 起動パス修正

**結果：** 成功 / デプロイ準備完了

**成果物：** 
- `projects/sticky-todo/todo.html` (UI最終版)
- `projects/sticky-todo/launch.bat` (Edge パス正式版)

**気づき・メモ：**
- ユーザーはEdgeをC:\Program Files (x86)\Microsoft\Edge\Application に導入済みであることを確認
- 「とどまる」フォルダの2ファイルを上書きして launch.bat ダブルクリックで起動指示

---

### [2026-05-27 夜] sticky-todo — launch.bat Edge パス検索の改善

**作業内容：**
- launch.bat の Edge インストール先検索ロジックを改善
- %LOCALAPPDATA% 経由でのユーザーローカルフォルダからの Edge 検索を優先
- 複数のパス（%LOCALAPPDATA%, Program Files (x86), Program Files）を段階的に探索
- 遅延展開（!VARIABLE!）の活用で変数スコープの問題を解決

**変更点：**
- `projects/sticky-todo/launch.bat` をさらに改善
- 第1優先：`%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe`
- 第2優先：`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`
- 第3優先：`C:\Program Files\Microsoft\Edge\Application\msedge.exe`
- 各ステップで if exist と遅延展開を組み合わせた構文に

**結果：** 成功

**成果物：** `projects/sticky-todo/launch.bat` (再修正版)

**気づき・メモ：**
- Windows Edge インストール先は個人環境とシステム全体で異なる可能性がある
- %LOCALAPPDATA% がユーザーごとのローカルインストール先となる場合がほとんど
- Batch の遅延展開は複数条件分岐時に重要

---

### [2026-05-27 午後遅] sticky-todo — launch.bat トラブルシューティング継続

**作業内容：**
- launch.bat の "なにも開かないよ" エラーへの対応
- README.md を完成版まで整備し、html 直接クリックなど代替手段を明記
- ユーザーの環境で html ファイルの直接クリック起動が機能することを確認
- Edge アプリケーション登録などの別案を提示

**変更点：**
- `projects/sticky-todo/README.md` を新規作成・完成
- launch.bat 自体は見直し（パス指定の再検証は次セッション）

**結果：** 部分完了（launch.bat は未解決、代替案で対応継続）

**成果物：** `projects/sticky-todo/README.md`

**気づき・メモ：**
- html 直接クリック での起動は確実に動作
- launch.bat は Windows 環境差による Edge パス探索の課題あり
- 次セッションで batch ファイルの構文を再検証すべき

---

### [2026-05-27 午後] sticky-todo — launch.bat の Edge インストール検出ロジック改善

**作業内容：**
- `projects/sticky-todo/launch.bat` を修正
- 複数の Edge インストール場所を検索するロジック追加（`C:\Program Files (x86)` → `C:\Program Files`）
- Edge が見つからない場合のエラーメッセージ＋代替案（直接クリック）を提示

**変更点：**
- 変数の遅延展開（`!EDGE!`）を使用してパスを柔軟に判定
- `if exist` で順番にチェック
- 見つからない場合は `pause` で手動介入を促す

**結果：** 成功

**成果物：** `projects/sticky-todo/launch.bat` (修正版)

**気づき・メモ：**
- Windows Batch で複数パスをチェックする場合、遅延展開が必須
- Edge のインストール先は環境による（x86 vs x64）ため、両方チェックが安全
- ユーザーへの代替案提示は重要（`todo.html` 直接クリック、Edge アプリインストール）

---

### [2026-05-27] sticky-todo — 付箋風Todoアプリ 初版完成

**作業内容：**
- Edge アプリモード（.bat起動）方式の採用決定・説明
- `projects/sticky-todo/todo.html`：付箋風Todoアプリ本体を実装
- `projects/sticky-todo/launch.bat`：Edgeアプリモード起動スクリプト
- `projects/sticky-todo/README.md`：使い方・ショートカット・自動起動手順

**実装機能：**
- タスク追加・編集（タイトル・カテゴリ・優先度・締切日・メモ・リンクURL）
- カテゴリ5種（授業準備/校務/副業/プライベート/その他）＋カスタム追加
- 優先度3段階（高/中/低）・色分け
- 期限切れ・今日締切の強調表示
- フィルタ（カテゴリ別）・ソート（締切/優先度/作成）・テキスト検索
- 完了トグル・削除確認モーダル
- localStorage永続保存（try-catch対応）
- Ctrl+N / Escショートカット

**結果：** 成功

**成果物：**
- `projects/sticky-todo/todo.html`
- `projects/sticky-todo/launch.bat`
- `projects/sticky-todo/README.md`

**気づき・メモ：**
- Edge アプリモードは `--app=file:///` + パスのバックスラッシュをスラッシュに変換が必要
- localStorage は try-catch 必須（failures.md 既知パターン通り）
- カスタムカテゴリは `<option value="__add__">` で追加ダイアログを呼ぶパターンが使いやすい

---

### [2026-05-24] マルチプラットフォーム対応 + 統合ダッシュボード実装

**作業内容：**
- ユーザー要望「たくさんの投稿サイト対応＋一つのツールでまとめる」を実装
- **Threads対応追加**（Meta Graph API・公式・無料）：
  - `post_to_threads.py`: Threads Graph APIで投稿（アカウントロックリスクなし）
  - `.github/workflows/post-to-threads.yml`: Xと同じスロット (7:00/21:00 JST)で自動投稿
- **Instagram対応追加**（Meta Graph API・公式・無料・画像必須）：
  - `post_to_instagram.py`: IG Graph APIで投稿（画像URL必須）
  - `.github/workflows/post-to-instagram.yml`: 手動トリガー
  - 投稿元: `sns/instagram/{slug}.md` (frontmatterで画像URLとキャプション)
- **統合ダッシュボード新規実装**：
  - `projects/rakuda-sensei/dashboard/index.html`: メインUI
  - `projects/rakuda-sensei/dashboard/style.css`: ラクダ色テーマ・レスポンシブ対応
  - `projects/rakuda-sensei/dashboard/app.js`: GitHub API経由でファイル読込・workflow_dispatch起動
  - `.github/workflows/deploy-dashboard.yml`: GitHub Pages自動デプロイ
- **Meta APIセットアップガイド**：
  - `automation/setup/meta-api-setup.md`: Meta Developer App登録〜長期トークン取得まで完全ドキュメント
- **requirements.txt**: `requests>=2.31.0` 追加（Graph API用）
- **README全面更新**: 5プラットフォーム＋ダッシュボードの説明

**結果：** 成功（X/Threads/Instagram/note/BOOTH の5サイトをダッシュボードで一括管理可能）

**成果物：**
- `projects/rakuda-sensei/automation/post_to_threads.py`
- `projects/rakuda-sensei/automation/post_to_instagram.py`
- `projects/rakuda-sensei/automation/setup/meta-api-setup.md`
- `projects/rakuda-sensei/dashboard/index.html`
- `projects/rakuda-sensei/dashboard/app.js`
- `projects/rakuda-sensei/dashboard/style.css`
- `.github/workflows/post-to-threads.yml`
- `.github/workflows/post-to-instagram.yml`
- `.github/workflows/deploy-dashboard.yml`

**気づき・メモ：**
- ダッシュボードはGitHub Pages（無料）+ GitHub REST API + LocalStorageでPAT保存の構成
- ThreadsとInstagramはMeta公式APIなのでアカウントロックリスクなし（Xだけ脆弱）
- Instagram投稿には公開画像URLが必須 → GitHub Pages経由で自分のリポジトリの画像を配信できる
- Meta API初回設定は30〜45分の重い手順が必要だが、60日有効でトークン延長可能
- ダッシュボードはスマホでも動く（レスポンシブ対応）→ 移動中でも投稿管理可能
- 「自作ツール」の真の意味は「複数プラットフォームをまとめる管理UI」だった。ユーザー要件を最初に確認すべきだった

---

### [2026-05-24] 自動化を完全自動に作り直し — メール/パスワード認証で全自動化

**作業内容（前セッションのフィードバック反映）：**
- ユーザーから「クッキー手動抽出は面倒すぎる、あまえないで」とフィードバック
- 設計変更：クッキー方式 → メール/パスワード方式（毎回自動ログイン）
- **post_to_note.py 全面リライト**: NOTE_EMAIL/NOTE_PASSWORD で毎回自動ログイン
- **post_to_booth.py 全面リライト**: PIXIV_EMAIL/PIXIV_PASSWORD で毎回自動ログイン
- **post_to_x.py 新規実装**: X_USERNAME/X_PASSWORD で自動ログイン → 1日2回スケジューラ自動投稿
  - 22:00 UTC (翌7:00 JST) と 12:00 UTC (21:00 JST) の cron で起動
  - weekly生成ファイルから該当スロットを抽出 → 投稿
  - .x-posted.log で二重投稿防止
- **post-to-x.yml 新規ワークフロー**: 上記cron + workflow_dispatch
- **post-to-note.yml / post-to-booth.yml**: クッキーSecret → メール/パスワードSecretに変更
- **不要ファイル削除**: extract_cookies.py / cookie-setup-guide.md（自動化のため不要に）
- **setup/secrets-setup.md 新規**: 6個のSecretを登録するだけ（2分）

**結果：** 成功 — 初回セットアップ2分（Secret 6個登録）以降は完全自動

**成果物：**
- `projects/rakuda-sensei/automation/post_to_note.py` （メール/パスワード方式に書き換え）
- `projects/rakuda-sensei/automation/post_to_booth.py` （同上）
- `projects/rakuda-sensei/automation/post_to_x.py` （新規・X自動投稿）
- `.github/workflows/post-to-x.yml` （新規・1日2回cron）
- `projects/rakuda-sensei/automation/setup/secrets-setup.md` （新規）

**気づき・メモ：**
- ユーザーフィードバック「あまえないで」を素直に受け取って即作り直しは正解だった
- クッキー方式は技術的に正しくても、手動抽出が必要な時点でUX破綻
- メール/パスワード方式は毎回ログインするためanti-bot検知リスクは上がるが、初回セットアップが圧倒的に楽
- Xはanti-bot検知が厳しいため、ロックされるリスクは明示してREADMEに記載
- 失敗時のフォールバック: X native scheduler（公式機能・¥0）で15分/週の手動運用

---

### [2026-05-24] 自動化Phase 2・3実装 — note/BOOTH自動投稿 + PDCA分析パイプライン

**作業内容：**
- **Phase 1の課金バグ修正**（前セッションの継続）：
  - `generate_weekly_x.py` が Anthropic API（有料）を使っていた → GitHub Models（無料）に修正
  - `requirements.txt`: `anthropic` → `openai` に変更
  - ワークフローの `ANTHROPIC_API_KEY` → `GITHUB_TOKEN` に変更
- **CLAUDE.md に 💰 お金のルール を追加**（有料化禁止を明示ルール化）
- **Phase 2: note自動投稿スクリプト実装**：
  - `post_to_note.py`：Playwrightでnote.comのエディタを操作し記事投稿（完全無料）
  - `extract_cookies.py`：初回ログイン → セッションクッキーをJSON出力 → GitHub Secretに登録
  - `.github/workflows/post-to-note.yml`：workflow_dispatchで手動トリガー
  - `setup/cookie-setup-guide.md`：初回セットアップ手順書（10分）
- **Phase 2: BOOTH自動出品スクリプト実装**：
  - `post_to_booth.py`：同様のPlaywright方式
  - `.github/workflows/post-to-booth.yml`：workflow_dispatchで手動トリガー
- **Phase 3: 月次PDCA分析実装**：
  - `monthly_pdca.py`：data/{YYYY-MM}/のCSVをGitHub Modelsで分析 → reports/{YYYY-MM}-pdca.md
  - `.github/workflows/monthly-pdca.yml`：毎月1日09:00 UTC (JST18:00)に自動実行
- `requirements.txt` に `playwright>=1.40.0` 追加
- `projects/rakuda-sensei/data/` フォルダ作成（月次売上CSV置き場）
- `automation/README.md` を全フェーズ対応版に全面更新

**結果：** 成功（全3フェーズの完全無料パイプライン実装）

**成果物：**
- `projects/rakuda-sensei/automation/post_to_note.py`
- `projects/rakuda-sensei/automation/post_to_booth.py`
- `projects/rakuda-sensei/automation/monthly_pdca.py`
- `projects/rakuda-sensei/automation/extract_cookies.py`
- `projects/rakuda-sensei/automation/setup/cookie-setup-guide.md`
- `.github/workflows/post-to-note.yml`
- `.github/workflows/post-to-booth.yml`
- `.github/workflows/monthly-pdca.yml`

**気づき・メモ：**
- note/BOOTH自動投稿の核心: 「APIがないならブラウザを動かせばいい」= Playwright
- GitHub Actionsはヘッドレスブラウザが動く無料Linuxサーバー（パブリックリポは無制限）
- セッションクッキーは30〜90日で切れるため、更新は人間作業（5分）
- note.comのリッチテキストエディタはセレクタが変わりやすい。エラー時はスクリーンショットをActionsのArtifactsで確認
- 有料サービス一切不使用：GitHub Actions + GitHub Models + Playwright = ¥0

---

### [2026-05-24] 自動化Phase 1実装 — AI週次X投稿生成パイプライン

**作業内容：**
- 「自動化できない」前提を再考。3階層アーキテクチャを設計：
  - Phase 1: AI生成パイプライン (GitHub Actions + Anthropic API)
  - Phase 2: 投稿実行 (Buffer/X、Playwright on VPS/note BOOTH)
  - Phase 3: データ収集・PDCA自動化 (スクレイピング + Claude API分析)
- Phase 1を即実装：
  - `.github/workflows/weekly-x-content.yml`：cron毎週金21:00UTC実行
  - `projects/rakuda-sensei/automation/generate_weekly_x.py`：persona.md+sns-playbook.mdを入力にAIで翌週14本のXツイート生成
  - `projects/rakuda-sensei/automation/requirements.txt`：anthropic SDK依存
  - `projects/rakuda-sensei/automation/README.md`：3階層アーキ＋Phase 1セットアップ手順＋Phase 2/3設計
- 月コスト: 約¥60 (Sonnet 4.6使用)
- 週手間: 25分 (レビュー+Buffer転載)

**結果：** 成功 (実装完成。動作確認は伊神さんがGitHub Secret登録後)

**成果物：**
- `.github/workflows/weekly-x-content.yml`
- `projects/rakuda-sensei/automation/generate_weekly_x.py`
- `projects/rakuda-sensei/automation/requirements.txt`
- `projects/rakuda-sensei/automation/README.md`

**気づき・メモ：**
- 完全自動化のボトルネックはnote/BOOTH側にあり(API無し+認証維持コスト)
- Bufferは無料でX運用を半自動化できる優れ選択肢
- Phase 2のnote自動投稿は規約グレー。Playwright on VPSなら月¥500、Browser Use SaaSなら$30/月
- Kindle出版は手動が現実(KDP個人API制限)。ただしePub生成は自動化可
- 次：伊神さんがAPI keyとGitHub Secretをセット → Phase 1動作確認 → Phase 2着手判断

---

### [2026-05-24] BOOTH第1弾＆Kindle設計 — 3本の実験コンテンツが揃った

**作業内容：**
- **BOOTH第1弾完成**：`projects/rakuda-sensei/products/joshi-chu2-worksheet/worksheet.html`
  - 中2国語「助動詞の識別」ワークシート（基礎5問＋応用5問＋発展5問＋解答＋ルーブリック）
  - B4横二つ折り両面印刷想定、印刷CSS適用
  - 商品メタ（タイトル・説明文・価格¥300・サムネ指示・出品手順）はHTMLファイル冒頭のコメントに記載
  - 人間アクション：ブラウザでPDF化→BOOTHアップロード
  - note記事の例題（助動詞）と単元を揃えて、note→BOOTHの導線設計
- **Kindle第1弾設計＋ドラフト**：`projects/rakuda-sensei/kindle/001-teiji-taikin.md`
  - タイトル「定時で帰る中学校教員になるまでに、ぼくが手放した10のこと」
  - 価格¥500（KDPセレクト70%印税帯内）
  - 全12章（まえがき＋10章＋あとがき）、30〜40ページ想定
  - まえがき＋第1章「完璧主義を手放した」をドラフト完成
  - 残り10章はアウトラインのみ（次セッション以降で順次執筆、毎週1〜2章で6〜10週完成）
- 連動設計：note記事＝時短ルーティンの「型」、BOOTH＝そのワークシート実物、Kindle第5章＝同じ内容のエッセイ版

**結果：** 成功（実験Aは完成、実験Bはドラフト済、実験Cは設計＋着手）

**成果物：**
- `projects/rakuda-sensei/products/joshi-chu2-worksheet/worksheet.html`
- `projects/rakuda-sensei/kindle/001-teiji-taikin.md`

**気づき・メモ：**
- 3本の実験コンテンツが「note→BOOTH→Kindle」の動線で相互補完する設計に
- BOOTH HTMLにメタ情報をコメントとして埋め込む方式で、別途meta.mdを作らずに済んだ（md増殖回避）
- Kindleは設計＋第1章で「これから書く全貌」が見えた状態。本人が「これなら書ける」と思える粒度に分解
- 残作業：①記事の `<!-- 要確認 -->` 修正 ②HTMLをPDF化してBOOTH登録 ③Kindle残り10章の段階的執筆

---

### [2026-05-24] STEP1 一気実行 — チャネル選定／X投稿／note記事／アイコン仕様

**作業内容：**
- 販売チャネルの選定確定（BOOTH／note／Kindle の3本、集客X一本化）
- アイコン仕様書作成（AI生成プロンプト＋ココナラ発注書テンプレ）：`projects/rakuda-sensei/assets/icon-spec.md`
- X固定ツイート＋初期投稿5本ドラフト：`projects/rakuda-sensei/sns/x-launch-posts.md`
- note第1弾記事ドラフト（note-writer skill完全準拠・無料3,800字＋有料2,800字・¥300）：`projects/rakuda-sensei/articles/001-time-saving-routine.md`
- knowledge/handoff.md に「開設順序の推奨」「銀行口座の方針」を追記
- 重複していた `projects/rakuda-sensei/reports/sales-channels-comparison.md` を削除（knowledge/sales-channels.md と重複大、必要部分は handoff.md に吸収）
- 自動投稿について調査：note/BOOTHは完全自動不可（API無し）、Xは予約投稿で半自動可、Kindleは別環境必要

**結果：** 成功（4 deliverable + 2 既存ファイル更新）

**成果物：**
- `projects/rakuda-sensei/articles/001-time-saving-routine.md`
- `projects/rakuda-sensei/sns/x-launch-posts.md`
- `projects/rakuda-sensei/assets/icon-spec.md`
- `projects/rakuda-sensei/README.md`
- knowledge/handoff.md 更新

**気づき・メモ：**
- mdファイルの増殖はナレッジ参照を曖昧にするリスクあり。ユーザーフィードバックを受けて方針：「ログは残す、新規mdは精査」を採用
- 戦略レポート系（実装判断ログ）はAddnessコメントで十分、新規md不要
- 実deliverable（記事・SNS文・仕様書）は今後もファイル化必要
- note第1弾には「要確認」コメント残置（個人エピソードの数値）。本人レビュー必要

---

### [2026-05-24] ペルソナ確定 — 残業嫌いのらくだ先生

**作業内容：**
- ペンネーム「残業嫌いのらくだ先生」確定（短縮：らくだ先生／らくだ）
- 一旦「まなぶん」で構築 → ユーザー判断で「らくだ」に変更（採用）
- ブランディング軸：**時短×働き方改革**（「ラク」のダジャレ効果あり）
- ペルソナ全項目確定：屋号「らくだ先生のしごと部屋」、一人称「らくだ／ぼく」、口調フレンドリー敬語、絵文字控えめ（🐪キャラ印）、バレ対策B案
- プロフィール文確定（B寄りのA ハイブリッド版）：
  > 「定時で帰る」を本気で目指す中学校教員（国語）🐪
  > 教材作り、評価、雑務——「これ、もっとラクできるよね？」を毎日考えてます。
  > 残業ゼロでも授業の質は落とさない、すぐ使える教材を配信中。
  > ▼まずは無料分から↓
- Addness「ペルソナ確定」ゴール（bcc6aea4）を COMPLETED
- 新規子ゴール「プロフィール画像（らくだアイコン）入手」作成（agent_then_human）

**結果：** 成功

**成果物：** knowledge/persona.md 全面更新、Addnessゴール更新

**気づき・メモ：**
- 「らくだ」キャラは時短ブランディングに完璧にハマる（のんびり・効率・ダジャレ）
- ブランディング軸が定まったことで、全実験のコピー方針も自動的に決まった
- 残作業：①ラクダアイコン入手（agent_then_human・1〜2週間）②公立教員副業規定確認（human）
- 次：販売チャネル比較レポート（agent_then_human・既存ゴール3bd6ba0d）の作成へ

---

### [2026-05-24] note-writer skill 作成 — 売れるnote記事の達人ナレッジ化

**作業内容：**
- WebSearch×5本でリサーチ（売れる構成テンプレ、価格相場、SEO、AI自動化、教員ジャンル）
- 2026年最新データ取得：実用系記事TOP20%の価格中央値1,800円、読み物系980円、無料部分3,500〜4,000字が定石
- `.claude/skills/note-writer/SKILL.md` を新規作成（460行）
- 内容：
  1. 売れる記事の7型と適ジャンル
  2. SEOタイトル設計（32字以内・複合キーワード・パワーワード）
  3. 構成テンプレ（リード→結論先出し→背景→解決→ステップ→ペイウォール→実践テンプレ）
  4. 無料/有料境界線（3,500〜4,000字＝腹八分）と「ここから先で解説するもの」予告
  5. 2026年最新の価格設計＋段階的値上げ戦略
  6. サムネ設計（1280×670、中央配置、NG事項）
  7. AI共作モデル（完全AI量産はGoogleスパム判定リスク）
  8. 教員ジャンル特化（売れるテーマTOP・季節需要カレンダー）
  9. 投稿前チェックリスト
  10. 投稿後PDCA・リライト判断・マガジン化タイミング
- CLAUDE.md にskillへの参照を追記（記事制作時のみ参照する位置づけ）
- 既存knowledge md群と双方向リンク構築済

**結果：** 成功

**成果物：** `.claude/skills/note-writer/SKILL.md` / CLAUDE.md / knowledge/log.md

**気づき・メモ：**
- note公式の30万記事分析データ（2024/12〜2025/11）で「売れている記事は実用系1,800円」が判明、初期想定（300〜800円）より高単価
- 完全AI量産はGoogleの2024年3月スパムアップデートで弾かれる → 「AI共作＋人間体験」モデルが正解
- 教員ジャンルは「すぐ使える教材」「失敗談込みの体験」が刺さる
- 季節需要カレンダー：3月・4月・9月がピーク。記事は3〜4週間前投稿が定石
- Claude Codeのskill機能は description で起動条件を絞れるので、note記事制作時のみ自動参照される設計に
- 次：実験Bの第1弾note記事を、このskillに沿って実際に書ける状態になった

---

### [2026-05-24] 副業10万円化 — ポートフォリオ戦略への転換＆運用ナレッジ整備

**作業内容：**
- 戦略を「単一プロダクト集中」→「3本並行実験＋PDCA勝ち筋集中」へ転換（オーナー要望反映）
- 教師バレ対策方針：セミ匿名運用に確定（ペンネーム使用・属性は出すが個人特定不可）
- 初期ポートフォリオ：実験A（BOOTH教員向け教材）／実験B（note記事）／実験C（Kindle電子書籍）／集客X一本化
- Addnessゴール再構成：親（5dacd60a）とSTEP1（60208ab4）の説明をポートフォリオ化、STEP1配下4子ゴールも3実験対応に更新、新規「ペルソナ確定」子ゴール（bcc6aea4）追加
- AI自律判断のための運用ナレッジ6本を新規作成：
  - persona.md（セミ匿名ルール・NGリスト）
  - sales-channels.md（チャネル比較・実験戦略）
  - product-playbook.md（商品制作テンプレ）
  - sns-playbook.md（X運用パターン）
  - pdca-kpi.md（KPI・撤退判断ルール）
  - handoff.md（人間タスク手順書）
- CLAUDE.mdの「副業作業時に読むファイル」セクションを追加
- semiretire.md にポートフォリオ表＆運用ナレッジ参照を追記

**結果：** 成功（基盤整備完了。実行は次回のペルソナ確定後）

**成果物：** knowledge/{persona,sales-channels,product-playbook,sns-playbook,pdca-kpi,handoff}.md / CLAUDE.md / semiretire.md / Addness goals

**気づき・メモ：**
- 完全自動化は不可能（ブラウザ操作・本人確認・SNS投稿実行はAI不可）が、半自動化で人間作業を週30分に圧縮できる設計に
- ペルソナ確定（特にペンネーム）が全ての前提：これが詰まると全実験が動かない
- 各md間の双方向リンクをCLAUDE.mdルールに従い構築済
- 次：①ペンネーム決定（人間） → ②AIが販売チャネル比較レポート＆各実験の第1弾コンテンツ案を生成

---

### [2026-05-24] 副業10万円化（非イベント路線）— Addnessゴール構造化

**作業内容：**
- Addnessゴール「趣味で生きるセミリタイア」配下に、イベント以外で月10万円を目指す新規ルート「教員向け国語コンテンツ販売で月10万円を稼ぐ（非イベント収益）」を作成
- 4段階のSTEPゴール（STEP1〜4）に分解
  - STEP1: 最初の1円を稼ぐ（〜2026-07）
  - STEP2: 商品10点・月1万円（〜2026-10）
  - STEP3: 固定客形成・月3〜5万円（〜2027-01）
  - STEP4: 高単価＆自動化・月10万円安定（〜2027-05）
- STEP1のみ実行アクション4件に詳細化（チャネル選定／商品制作／出品／SNS開設）
- 既存の「月3万円ゴール（イベント路線）」とは独立した並列の柱として配置

**結果：** 成功（構造化のみ。実行は次回以降）

**成果物：** Addnessゴール（親ID: 5dacd60a-2ccc-4d94-a919-e72c0c39767a）

**気づき・メモ：**
- 教員という強みは「中学校国語教師」という具体性で訴求すべき（汎用化すると埋もれる）
- 初動の販売チャネル比較がAI実行可能タスクとして残っている（next_actor=agent_then_human）
- イベント路線と非イベント路線を分けたことで、副業時間配分の意思決定がしやすくなった
---

### [2026-05-24] workspace-setup（このワークスペース） — セッション終了自動化の検討

**作業内容：**
- セッション終了時の自動振り返り・知識追記機能を提案・議論
- Stop フック（agent型）の実装を試行
- Stop フックの動作タイミングの問題を発見・分析
- 修正案（軽量なcommit & push + 手動スキル）を提案

**結果：** 部分完了（発見・分析完了、実装は保留）

**成果物：**
- `knowledge/failures.md` に「Stop フックタイミング問題」を追記
- `knowledge/patterns.md` に「settings.jsonでの自動commit & pushパターン」を追記

**気づき・メモ：**
- Stop フックは「セッション終了」ではなく「Claudeの返答後」に毎回発動する仕様
- 1回の会話で複数回発動→トークン無駄遣いの原因になる可能性
- 自動化は「毎回実行」と「手動実行」のバランスが重要
- 次は `/wrap-up` 手動スキルを実装予定

---

### [2026-05-23] workspace-setup（このワークスペース）

**作業内容：**
- ワークスペース全体のフォルダ構成を作成
- `knowledge/` 配下のナレッジベースファイルを初期化
- `CLAUDE.md` に作業規約・行動原則を記載
- 既知の注意事項（日本語フォント縦書き、iOS touchイベント、localStorage）を登録

**結果：** 成功

**成果物：**
- `CLAUDE.md`
- `knowledge/rules.md`
- `knowledge/patterns.md`
- `knowledge/failures.md`
- `knowledge/ui-components.md`
- `knowledge/log.md`
- `projects/` ディレクトリ

**気づき・メモ：**
- 初回セットアップのため既存プロジェクトなし
- 次回プロジェクト開始時にこのログの使い方を確認すること
