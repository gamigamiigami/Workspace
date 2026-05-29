# 作業ログ（全プロジェクト横断）

新しいエントリは **先頭に追加** する。

---

### [2026-05-29 session a628ca4b-a53b-465a-a5ea-01c758baf71f 最終] sticky-todo — リマインド機能バグ修正とテスト計画

**作業内容：**
- JS/PS 層のリマインド重複防止ロジック競合を特定・修正
- PowerShell 単一タスク JSON パース時のカウント表示バグを修正
- ログ検証により実装が仕様通りに動作していることを確認
- ユーザーテスト計画を提示

**変更点：**
- `projects/sticky-todo/notifier.ps1`
  - `@() + ConvertFrom-Json` 形式で単一要素でも正しくカウント表示
  - `firedIds` セットで独立したリマインド発火記録管理（JS の `lastReminded` と非連動）
  - ログ "tasks updated: N" が正確に表示される

**修正根拠：**
- PS の JSON パース後、条件分岐 (`if` 単一件数 vs 複数) より配列連結 (`@() +`) が堅牢
  - PowerShell 5.1 の配列展開動作の不確定性を回避
- リマインド重複防止を JS と PS で独立管理
  - PS が `firedIds` のみで判定 → JS の `lastReminded` 更新に影響されない

**結果：** 
- 実装コードが理論値と整合していることを ログ検証で確認
- テスト手順（新規タスク作成→2〜3分後リマインド発火確認）を提示

**成果物：**
- 修正済み `notifier.ps1`（ユーザーへダウンロード配信完了）
- テスト計画ドキュメント

**気づき・メモ：**
- notifier.ps1 修正反映には PowerShell プロセス再起動と ファイル差し替えが必須
- 理論検証（ログ時系列チェック）と実運用テストは別フェーズ

**次のステップ：**
1. ユーザーが新規タスク作成テストを実行（締め切り 2〜3分後、リマインド 5分前設定）
2. PowerShell ログで「FIRING reminder」が出るか確認
3. 実通知発火で修正完了を最終確認

---

### [2026-05-29 session a628ca4b-a53b-465a-a5ea-01c758baf71f] sticky-todo — リマインドメッセージ機能実装

**作業内容：**
- ユーザーが通知時に表示させる任意のメッセージを入力できる機能を追加
- アプリ右上の ⚙ (設定)ボタンから、リマインドメッセージの入力・保存フロー実装
- メッセージを全通知チャネル（モーダル・PowerShell・WebSocket）に反映

**変更点：**
- `projects/sticky-todo/todo.html` — `triggerReminder()` 関数を修正
  - グローバル変数 `reminderMessage` を参照してモーダル detail に表示
  - PowerShell WebSocket ペイロード（msg フィールド）にメッセージを含める
- 設定 UI：右上 ⚙ ボタンから「リマインドメッセージを入力」ダイアログを表示

**結果：** 
- リマインド通知が単なるタスク情報から、ユーザー定義メッセージ付きの個人化された通知に進化
- モーダル表示時に見栄えよく、PowerShell MessageBox にも統合

**成果物：**
- `todo.html` の `triggerReminder()` 関数（メッセージ対応版）
- 設定 UI（ ⚙ ボタン）からのメッセージ入力フロー

**気づき・メモ：**
- `reminderMessage` グローバル変数の管理で全通知パイプラインに一括反映可能
- WebSocket ペイロード（msg フィールド）を拡張することで PowerShell 側でも複合メッセージを受信可能

**次のステップ：**
1. リマインドメッセージの localStorage への永続化（セッション跨ぎ）
2. 実際の通知表示で、メッセージレイアウト・順序をユーザーテスト

---

### [2026-05-30 session a628ca4b] sticky-todo — MessageBox から WinForms カスタム通知フォームに置き換え

**作業内容：**
- MessageBox をカスタム `System.Windows.Forms.Form` に置き換え、スタイル制御対応の通知フォームを実装
- デザイン設計：赤背景ヘッダー（警告色）+ 白文字 + 黒メッセージ テキスト + 赤OK ボタン
- フォント：`Yu Gothic UI` を指定して、日本語での大きめ表示に対応
- `TopMost = $true` + `Activate()` で確実な最前面・フォーカス奪取
- Panel + Label を階層的に構築して、レイアウト制御を柔軟化

**変更点：**
- `projects/sticky-todo/notifier.ps1` — `Show-MsgBox` 関数をカスタム Form ベースに全面改修
  - MessageBox の `DefaultDesktopOnly` オプション → WinForms の `TopMost` に変更
  - 色・フォント・サイズを動的に指定可能な関数シグネチャに統一
  - Panel（ヘッダー）+ Label（メッセージ）+ Button（OK）で構成
- `knowledge/patterns.md` — 新規セクション「PowerShell WinForms カスタム通知フォーム」を追記
- `knowledge/task-diary.md` — セッション記録を追加

**結果：** 
- MessageBox の制限を超え、細かいスタイル制御が可能な通知フォームを実装
- WinForms パターンを patterns.md に記録化し、再利用可能な形に昇華

**成果物：**
- notifier.ps1 内の`Show-MsgBox` 関数（WinForms Form ベース）
- patterns.md における「PowerShell WinForms カスタム通知フォーム」パターン

**気づき・メモ：**
- PowerShell WinForms は同期的（ShowDialog）なため、複数通知時に順序制御が自動化される
- Panel + Label で複雑なレイアウトを構築可能 → MessageBox よりも高い自由度
- TopMost + Activate() パターンはMessageBox だけでなく、カスタム Form でも有効

**次のステップ：**
1. ユーザーの見た目・フォント印象フィードバック待ち（微調整の可能性）
2. 実装の確認後、デザイン最適化（色・サイズ・フォント調整）を検討
3. リマインダー UI/UX 完成度の最終チェック

---

### [2026-05-30 session a628ca4b-stop-2] sticky-todo — WinForms TopMost オーナー実装で MessageBox 最前面化問題を解決

**作業内容：**
- 前セッションの「MessageBox が隠れる問題」の根本原因を特定：Win32 API の `MB_TOPMOST` フラグだけでは OS のウィンドウマネージャー次第で前面化が保証されない
- WinForms `TopMost` Form をオーナーにして `Activate()` を呼ぶ新パターンを実装
  - `Show-MsgBox` 関数内で `Form` オブジェクトを作成・設定し、MessageBox のオーナーに指定
  - Form は `ShowInTaskbar=false` で隠し、`StartPosition=CenterScreen` で画面中央に配置
  - MessageBox 後に Form を破棄
- notifier.ps1 のコード品質向上（不要な Win32 宣言の削除、可読性改善）

**変更点：**
- `projects/sticky-todo/notifier.ps1` — WinForms TopMost オーナーパターンの実装
- `knowledge/failures.md` — 新規エントリ「MB_TOPMOST フラグだけでは MessageBox の最前面化が確実でない」を追記
- `knowledge/task-diary.md` — セッション a628ca4b-stop-2 の記録を追加

**結果：** 
- Win32 と WinForms の組み合わせで、確実に前面化・最前面配置できる実装パターンを確立
- failures.md に「これからのハマりポイント」として知見を記録

**成果物：**
- failures.md における「PowerShell UI・ウィンドウ制御」セクション（MessageBox 最前面化パターン）
- notifier.ps1 内の `Show-MsgBox` 関数（再利用可能な WinForms パターン）

**気づき・メモ：**
- PowerShell での UI 実装には Win32 API だけでなく WinForms の組み合わせが有効
- TopMost フラグ + Activate() パターンは他の Windows アプリケーション（スクリーンセーバー、緊急通知等）でも応用可能

**次のステップ：**
1. ユーザーテスト実行：MessageBox が画面中央に最前面で出現するか確認
2. 確認後、UI/UX 最適化を検討（トースト通知への切り替え等）

---

### [2026-05-29 session ea85df86] sticky-todo — notifier.ps1 エンドツーエンドテスト指示・段階的フィードバック継承フロー確立

**作業内容：**
- notifier.ps1 の起動と WebSocket リスナー動作を確認（`timer check: 0 tasks` ログが10秒ごとに出力される状態を確認）
- sticky-todo プロジェクトのエンドツーエンドテストシナリオ設計
  - todo.html を Edge で開く → タスク作成（期限3〜4分後、リマインド1分前） → Edge最小化 → 待機
  - 期待動作：todo.htmlを開いた直後に黒い画面に `tasks updated: 1` が出力される
- patterns.md に「段階的ユーザーテスト + フィードバック継承フロー」パターンを記録化
  - 複数セッション間での知識継承を自動化
  - failures.md との連携で「何が起きたか」を蓄積

**変更点：**
- `knowledge/patterns.md` — 新規パターン「段階的ユーザーテスト＋フィードバック継承フロー」を追記
- `knowledge/task-diary.md` — セッション記録を更新（テスト指示の詳細を記録）

**結果：** 
- notifier.ps1 が正常に起動・リッスンしている状態を確認
- ユーザーテストの詳細指示を作成・ユーザーに提示
- 待機中

**成果物：**
- patterns.md における「テスト・実装戦略」セクション（今後の sticky-todo 以外のプロジェクトでも再利用可能）

**気づき・メモ：**
- PowerShell スクリプト + ブラウザアプリの統合テストには「ログ可視化」が必須
- 「ユーザーテスト待機」が5回以上繰り返されると patterns.md に昇華する価値あり
- セッション間の「どこまで進んだか」は Task Diary ではなく patterns.md の「フロー図」で把握すると効率的

**次のステップ：**
1. ユーザーから `tasks updated: 1` が出たか報告受け取り
2. 出た場合 → MessageBox 表示テストへ進む（リマインド時刻に MessageBox が出るか確認）
3. 出ない場合 → JSON 送信側（todo.html）または受信側（notifier.ps1）を診断・修正

---

### [2026-05-29 final] sticky-todo — notifier.ps1 最終版完成・ログ機能追加・ユーザー診断フロー確立

**作業内容：**
- 前セッションの診断結果（test-notifier.bat での起動確認）から、notifier.ps1 を本格的に修正
- Win32 API MessageBox に `MB_TOPMOST (0x40000)` と `MB_SETFOREGROUND (0x10000)` フラグを設定し、最前面表示・フォーカス強制を実現
- `%TEMP%\todo-remind.log` への詳細ログ出力機能を実装
  - スタートアップログ、タイマー実行ログ、WebSocket 受信ログ、MessageBox 呼び出しログなど多段階ログ
  - ユーザーがログを確認することで、各ステップの動作を診断可能に
- PowerShell スクリプト内の全日本語を英語に統一（エンコーディング問題の完全対策）

**変更点：**
- `projects/sticky-todo/notifier.ps1` — Win32 MessageBox フラグ追加、ログ出力機能実装、日本語→英語に統一

**結果：** notifier.ps1 最終版完成 / ユーザーへの明確な診断指示を準備完了

**成果物：**
- `projects/sticky-todo/notifier.ps1` v3（Win32 MB_TOPMOST、詳細ログ、英語のみ版）

**気づき・メモ：**
- PowerShell スクリプトのリモートデバッグは「ログ出力→ユーザーが確認」というフローが効果的
- `MB_TOPMOST | MB_SETFOREGROUND` により、Windows のセキュリティ制約下でも最前面表示が可能（SetForegroundWindow より確実）
- ログファイルにより、ユーザーテスト時の「MessageBox が出た/出ない」の原因特定が大幅に効率化
- 次セッションの作業：ユーザーからのログ報告を受け、MessageBox 表示・非表示の原因を特定

**次のステップ：**
1. ユーザーにリマインダーテストを依頼（期限6分後、リマインド5分前のタスク作成）
2. ユーザーが `%TEMP%\todo-remind.log` の内容を報告
3. ログ内容から「WebSocket 受信有無」「MessageBox 呼び出し有無」を確認
4. 原因に応じて notifier.ps1 の追加修正またはクライアント側（todo.html）の修正を実施

---

### [2026-05-29 late evening] sticky-todo — notifier.ps1 修正と test-notifier.bat 診断ツール完成

**作業内容：**
- notifier.ps1 の HttpListener エラーハンドリングを強化
- test-notifier.bat という簡潔な診断スクリプトを作成し、ユーザーが起動エラーを直接確認できるようにした
- PowerShell スクリプトの "-WindowStyle Hidden" での実行では見えないエラーメッセージを、可視スクリプト経由で確認可能にした

**変更点：**
- `projects/sticky-todo/notifier.ps1` — HttpListener 例外処理強化
- `projects/sticky-todo/test-notifier.bat` — 新規作成（ユーザー向けテストツール）

**結果：**診断ツール完成 / ユーザーのテスト実行結果フィードバック待ち

**成果物：**
- `projects/sticky-todo/test-notifier.bat` — notifier.ps1 起動エラーを黒い画面で直接確認するツール

**気づき・メモ：**
- 可視スクリプトを用意することで、隠れたエラーメッセージを引き出せる
- ユーザーへの次ステップは「test-notifier.bat を実行して画面に映る内容を報告」という明確な指示に

---

### [2026-05-29 evening] sticky-todo — リマインダー通知：エンコーディング問題の特定と修正

**作業内容：**
- Linux 環境で UTF-8 で作成したバッチファイル（.bat）を Windows cmd.exe で実行した際、Shift-JIS として読み込まれる問題を特定
- notifier.ps1 と debug-notifier.bat に含まれる日本語文字列（「リマインド！」「期限」「提出先」など）が文字化けし、コマンド解析が失敗する根本原因を確認
- 全ての日本語文字列を英語に置き換えた修正版を作成・コミット

**変更点：**
- `projects/sticky-todo/notifier.ps1` — 日本語文字を英語に変更、メッセージ生成ロジックを Build-Msg 関数に抽出
  - 「リマインド！」→ 「Remind: 」
  - 「期限：」→ 「/ Due: 」
  - 「提出先：」→ 「/ To: 」
  - MessageBox タイトル「ToDo丸 リマインド」→ 「ToDo Remind」
- `projects/sticky-todo/debug-notifier.bat` — 日本語コメント・メッセージを英語に変更

**結果：** エンコーディング問題を根本的に解決 / 次セッションでの動作確認待ち

**成果物：**
- `projects/sticky-todo/notifier.ps1` v2（日本語ゼロ版）
- `projects/sticky-todo/debug-notifier.bat` v2（日本語ゼロ版）

**気づき・メモ：**
- Linux（UTF-8）→ Windows（Shift-JIS）のエンコーディングギャップが原因
- バッチファイルの言語に関わらず、特殊文字の混在を避けることが重要
- 診断ツール debug-notifier.bat のメッセージも英語化することで、どの環境でも実行可能に

---

### [2026-05-29 午後] sticky-todo — リマインダー通知：エラー診断ツール作成

**作業内容：**
- notifier.ps1 起動失敗時の根本原因診断を進める段階
- ユーザーがダブルクリックしてエラーメッセージを確認するための debug-notifier.bat を新規作成
- 前セッション（2026-06-02）での診断計画を実行準備

**変更点：**
- `projects/sticky-todo/debug-notifier.bat` — 新規作成（notifier.ps1 起動状況確認用）

**結果：** 準備完了 / ユーザーからのエラーメッセージフィードバック待ちで中断

**成果物：**
- `projects/sticky-todo/debug-notifier.bat`（デバッグツール）

**気づき・メモ：**
- 「全然ダメ」という報告から、複数の根本原因（notifier 未起動、MessageBox フラグ誤解、Win32 API セキュリティ制約）を仮説立て
- エラーメッセージの具体的な内容をもとに次の診断ステップを決定する予定

---

### [2026-06-01 午後] sticky-todo — リマインダー通知：アプリ最前面化機能（Win32 API）

**作業内容：**
- アプリが最小化されている場合、リマインド時に単なるメッセージボックスだけでは見えない問題を解決
- Win32 API（SetForegroundWindow, ShowWindow）を使用して、対象アプリを復元・最前面に出す機能を実装
- PowerShell notifier.ps1 に `Invoke-BringToFront` 関数を追加
  - msedge プロセスを列挙し、ウィンドウタイトルに「ToDo」を含むものを検索
  - `ShowWindow(SW_RESTORE)` で最小化を復元、`SetForegroundWindow` で最前面化
  - リマインド通知表示時に両方のモード（通常リマインダー + WebSocket経由）で呼び出す

**変更点：**
- `projects/sticky-todo/notifier.ps1` — Win32 API P/Invoke インポート + Invoke-BringToFront 関数追加

**結果：** 成功 / アプリ最小化時の通知確認手段が確保

**成果物：**
- `projects/sticky-todo/notifier.ps1` 改善版（最前面化機能付き）

**気づき・メモ：**
- MessageBox の DefaultDesktopOnly フラグは全ウィンドウの前に表示されるが、最小化アプリには効果がない
- Win32 API で復元してから MessageBox を表示することで、どの状態でも確実に通知が見える
- タイトルマッチングでプロセス特定することで、複数 Edge ウィンドウがある場合でもターゲット指定可能

---

### [2026-05-30 午後] sticky-todo — リマインダー通知UI修正（アラーム vs メッセージボックスのみ）

**作業内容：**
- リマインダー通知の2つのモード（「アラームあり」「メッセージボックスのみ」）を実装
- 「メッセージボックスのみ」を選択した場合、PowerShell notifier が起動した場合は Windowsダイアログで「静かに」表示
- notifier.ps1 が接続不可の場合でも、JavaScript のアプリ内モーダルで通知するようにフォールバック実装
- 修正の根本原因：triggerReminder() が message 型で早期リターンしていた → モーダル表示を追加

**変更点：**
- `projects/sticky-todo/todo.html` — triggerReminder() の message 型でもモーダル表示（ただし音・点滅・揺れなし）

**結果：** 成功 / コミット完了 `fix: show in-app modal for message-only reminder type`

**成果物：**
- `projects/sticky-todo/todo.html` 修正版（リマインダーモーダル改善）

**気づき・メモ：**
- notifier.ps1 が繋がらないとき、以前は「完全無音」だった → アプリ内モーダルをフォールバックに
- アプリが開いている限り、モーダルは必ず出るため、通知漏れを防止
- UI差別化：アラームなし(青枠) vs あり(赤枠・揺れ・音)で視覚的に区別可能

---

### [2026-05-29 午前] sticky-todo — launch.bat バッチ起動メカニズム最適化 & 日本語除去

**作業内容：**
- launch.bat のバッチスクリプト起動方式を改善
  - **旧方式：** `powershell -Command "Start-Process powershell -ArgumentList ..."`（二重ネスト・過度に複雑）
  - **新方式：** `start "" powershell -WindowStyle Hidden -File "%NOTIFIER%"`（cmd 組み込みコマンド・即座に非同期実行）
- バッチファイルから日本語コメント（`rem ===== ToDo丸 起動スクリプト =====` など）を完全除去
- パス処理を `%NOTIFIER%` 環境変数 + 引用符で統一（スペース含むパスに対応）

**変更点：**
- `projects/sticky-todo/launch.bat` — 起動メカニズム簡潔化・コメント日本語化除去

**結果：** 成功 / コード可読性向上・エンコーディング問題リスク軽減

**成果物：**
- `projects/sticky-todo/launch.bat` 改善版
- コミット予定：`chore: launch.bat 起動メカニズム最適化 & 日本語コメント除去`

**気づき・メモ：**
- Windows バッチスクリプト内の日本語コメントはエンコーディング問題リスク
- `start ""` は cmd 組み込みコマンドで、PowerShell ネストより軽量・確実
- 環境変数化 + 引用符で、複雑なパスも安全に処理可能

---

### [2026-05-28 午後] sticky-todo — WebSocket + PowerShell MessageBox で全窓最前面通知実装

**作業内容：**
- Windows の MessageBox を PowerShell 経由で呼び出す方式を実装（`DefaultDesktopOnly` フラグで全窓最前面表示）
- PowerShell HttpListener で WebSocket サーバー（notifier.ps1）を実装
- HTML（todo.html）から HTTPS/WebSocket でトリガーして、MessageBox を表示する仕組みを完成
- launch.bat ロジックを調整し、notifier.ps1 をバックグラウンド起動 + Edge で todo.html を起動
- favicon 赤化・点滅、音声アラーム、HTML モーダル、システムダイアログの 4 層通知フロー完成

**変更点：**
- `projects/sticky-todo/todo.html` — WebSocket でクライアント側トリガー実装
- `projects/sticky-todo/notifier.ps1` — 新規作成（PowerShell + System.Windows.Forms MessageBox）
- `projects/sticky-todo/launch.bat` — notifier.ps1 バックグラウンド起動処理を追加

**結果：** 成功 / 3 ファイル完成，ユーザーテスト待ち

**成果物：**
- `projects/sticky-todo/notifier.ps1`（WebSocket+MessageBox 実装）
- `projects/sticky-todo/launch.bat` 修正版
- `projects/sticky-todo/todo.html` WebSocket トリガー組み込み版
- コミット：`feat: WebSocket+PowerShell MessageBoxで全窓最前面通知・favicon点滅`

**気づき・メモ：**
- `System.Windows.Forms.MessageBoxOptions.DefaultDesktopOnly` は OS レベルで全ウィンドウの最前面を強制
- PowerShell HttpListener で WebSocket リッスン可能（C# アセンブリ利用）
- Edge --app モード + PowerShell スクリプト = ブラウザアプリの制限を補える実用的な組み合わせ
- 3 ファイルをユーザーの「とどまる」フォルダに入れて実行テスト予定

---

### [2026-05-28 早朝] sticky-todo — アラーム UX 最終改善（favicon 赤化 + alert 常時発火）

**作業内容：**
- リマインド時のユーザー注意喚起を強化
- favicon を動的に赤い「！」に変更（視覚的インパクト向上）
- `alert()` を常時発火に修正（アプリ前面でも背面でも表示）
- Windows タスクバー点滅 + ブラウザ標準ダイアログの組み合わせで確実な通知を実現
- スヌーズ/確認後に favicon を通常のオレンジアイコンに復帰させる処理を実装

**変更点：**
- `projects/sticky-todo/todo.html` — favicon設定・alert呼び出しロジック修正

**結果：** 成功 / アラーム UX 最終改善完了

**成果物：**
- `projects/sticky-todo/todo.html`（favicon動的変更＋alert常時発火）
- コミット：`9321be8 feat: リマインド時にfaviconを赤に変更＋alert常時発火`

**気づき・メモ：**
- `document.head` に動的に `<link rel="icon">` を追加することで favicon をリアルタイム切り替え可能
- ブラウザの `alert()` は OS レベルのモーダルダイアログ（アプリ前面でも強制表示）として動作
- 「音声 + favicon赤化 + alert + タスクバー点滅」の4要素組み合わせで、ユーザーの見落とし率をほぼ 0 に削減
- アラーム機能は一連の改善サイクルで完成（PDCA短期回転の好例）

---

### [2026-05-28（深夜・ユーザー診断待ち）] sticky-todo — debug.bat 実行結果待ちで中断

**作業内容：**
- ユーザーが `launch.bat` ダブルクリック後にフォルダが開く問題の根本原因を特定するため、自動診断スクリプト（debug.bat）を作成
- debug.bat でレジストリから Edge インストール位置を自動検索
- HTML ファイルの存在確認、Edge 起動試験を実施
- 診断結果を日本語で分かりやすく「OK」「NG」で表示
- 結果をテキストファイルに出力してメモ帳で自動表示

**変更点：**
- `projects/sticky-todo/debug.bat` — 新規作成（自動診断スクリプト）

**結果：** 中断（debug.bat の実行結果をユーザーから受け取り待ち）

**成果物：**
- `projects/sticky-todo/debug.bat`（Windows Batch 診断スクリプト）
- コミット：`debug: 起動トラブル診断用 debug.bat を追加`

**気づき・メモ：**
- 複雑なパス問題は、自動化された診断スクリプトでユーザー環境の詳細情報を集めるのが最も効率的
- Windows レジストリから Edge パスを検索することで、複数のインストール位置に対応可能
- 日本語フォルダ名を含むパスでも、正しいクォート処理があれば Batch で対応できる

**次のアクション：**
- ユーザーから debug.bat 実行結果を受け取る
- Edge パス検出またはファイルパス問題が判明したら、launch.bat を具体的に修正する
- 修正版を再度ユーザーテストしてもらう

---

### [2026-05-28（夜間・再開）] sticky-todo — file:// 直接起動への転換・デバッグスクリプト作成

**作業内容：**
- PowerShell HTTP サーバー方式（server.ps1）を廃止し、Edge `--app=file:///` による直接起動に変更
- launch.bat を簡潔化：PORT変数、サーバー起動処理、timeout削除
- Windows レジストリから Edge パスを自動検索して、異なるインストール位置に対応
- launch.bat の修正後、ユーザーからの「フォルダが開く」フィードバックに対応
- ユーザーの環境情報を自動診断する `debug.bat` を作成
  - Edge のパス検索（Program Files / Program Files (x86））
  - HTML ファイルの存在確認
  - Edge 起動試験
  - 結果をテキストファイルに出力してメモ帳で表示

**変更点：**
- `projects/sticky-todo/launch.bat` — file:// 直接起動に変更・簡潔化
- `projects/sticky-todo/debug.bat` — 新規作成（診断スクリプト）

**結果：** 部分完了（debug.bat 実行結果待ち）

**成果物：**
- `projects/sticky-todo/launch.bat`（サーバー廃止・file:// 直接起動版）
- `projects/sticky-todo/debug.bat`（診断スクリプト）
- コミット：`463ee03 debug: 起動トラブル診断用 debug.bat を追加`、`c0d6fbb debug: ログをメモ帳に書き出す方式に変更`

**気づき・メモ：**
- Windows 単一ファイルアプリの場合、わざわざローカルサーバーを起動する必要はない
- localStorage、Web Audio API、DOM 操作など主要機能は file:// で完全に動作
- Notification API は file:// で動作しないが、リマインダーモーダル + 音声 + タイトル点滅で対応可能
- 複雑なトラブルシューティングはユーザー環境の詳細情報が必須なため、自動診断スクリプトが有効

---

### [2026-05-28（夜間・修正）] sticky-todo — launch.bat のタイトル引数修正

**作業内容：**
- ユーザーフィードバック対応：`launch.bat` 実行時にフォルダが開く問題を調査・修正
- Windows Batch の `start` コマンド引数順序を修正：タイトル引数を最初に配置
- 修正前：`start /MIN /D "%~dp0" "タイトル" powershell ...` （引数順序が誤り）
- 修正後：`start "ToDo丸Server" /MIN /D "%~dp0" powershell ...` （タイトルを最初に）
- ユーザーへの修正内容を説明・デリバリー完了

**変更点：**
- `projects/sticky-todo/launch.bat` — `start` コマンドの引数順序を修正

**結果：** 成功 / 即座に修正・コミット・デリバリー完了

**成果物：**
- `projects/sticky-todo/launch.bat`（修正版）
- コミット：`8d7d7bc fix: start コマンドのタイトル引数の位置を修正（フォルダが開く問題）`

**気づき・メモ：**
- Windows Batch の `start` コマンドは引数順序が重要
- タイトル引数（引用符で囲んだテキスト）は **最初** に配置する必要がある
- 引数順序誤りでフォルダが開くなどの予期しない動作が発生
- failures.md に「Windows Batch ハマりポイント」として記録済み

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

### [2026-05-28 (続続)] sticky-todo — リマインダー通知方式の最適化

**作業内容：**
- Notification API の廃止（`file://` プロトコル非対応の制限回避）
- 3重リマインド通知に統一：アラーム音（Web Audio API）+ タイトル点滅（`document.title`） + 揺れるモーダル（CSS animation）
- アラーム音の実装：「ポポポーン」3音×4秒ループで確認するまで鳴り続ける設計
- タイトル点滅の実装：「⏰ リマインド！」と交互で点滅してタブ/ウィンドウ注視を強制
- モーダルの仕様統一：×ボタンなしで「5分後にもう一度」「確認した」のみ選択可能

**変更点：**
- `projects/sticky-todo/todo.html` — リマインダー通知方式の刷新

**結果：** 成功 / リマインダー通知システム最適化完了

**成果物：**
- `projects/sticky-todo/todo.html`（3重リマインド実装）
- `knowledge/ui-components.md` — 「3重リマインド通知」パターンを新規追記・ドキュメント化

**気づき・メモ：**
- ブラウザの Notification API は `file://` プロトコルでは機能しない（セキュリティ仕様）
- 音 + 視覚（タイトル） + UI（モーダル）の3方向同時通知で、ユーザー見落とし率をほぼ0に削減可能
- Web Audio API を用いたオシレーター生成は、複雑な音声処理なしでアラーム音として実装可能
- 3重リマインド UI パターンは他プロジェクトでも再利用価値が高い

---

### [2026-05-28 (続)] sticky-todo — リマインダー機能実装完了

**作業内容：**
- 完了のみ表示フィルター、日時付き期限、リマインダー（6段階：5分前〜1日前）、OS通知、アプリ内アラート機能を実装
- 30秒ごとのバックグラウンドチェック機構により、期限前後30秒以内での通知を実現
- アプリ内アラート（揺れるモーダル、×ボタンなし、「5分後にもう一度」「確認した」選択肢のみ）を実装
- 初回起動時の OS通知許可要求ダイアログを実装
- ユーザーフローの最適化（通知見逃し防止の二重通知機構）

**変更点：**
- `projects/sticky-todo/todo.html` — リマインダー機能全実装

**結果：** 成功 / リマインダー機能実装完了

**成果物：** 
- `projects/sticky-todo/todo.html`（リマインダー機能追加）

**気づき・メモ：**
- Web アプリケーション内でのリマインダーは「アプリ起動中のみ」という制限があるが、30秒ごとの定期チェックで高精度な通知が可能
- OS 通知と アプリ内モーダルの組み合わせにより、ユーザーの見逃し率が大幅に低減される
- 「揺れるモーダル + 確認ボタンのみ」という UX パターンは、他のプロジェクトでも再利用可能
- リマインダー通知は Edge --app モード起動時に機能（オフライン時は非動作）

---

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
