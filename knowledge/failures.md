# 失敗・ハマりポイント集

最終更新：2026-06-12

新しいエントリは **先頭に追加** する。プロジェクト名を必ず記載。

---

## PowerShell UI・ウィンドウ制御

### [2026-05-30] sticky-todo — Win32 `MB_TOPMOST` フラグだけでは MessageBox の最前面化が確実でない

**状況：** PowerShell で `[Windows.Forms.MessageBox]::Show()` を使い、MessageBox を画面中央・最前面に表示したい

**問題：** `[Windows.Forms.MessageBoxOptions]::TopMost` フラグを指定しても、MessageBox がバックグラウンドに隠れてしまい、タスクバーのボタン点滅のみになる

**原因：** Win32 API の `MessageBox(..., MB_TOPMOST)` は OS のウィンドウマネージャー次第。フォーアグラウンドアプリケーションが別のウィンドウを持つ場合、確実にフォアグラウンドを奪取できない

**解決策：**
```powershell
# ❌ TopMost フラグだけではバックグラウンドに隠れる可能性
[Windows.Forms.MessageBox]::Show($msg, $title, [Windows.Forms.MessageBoxButtons]::OK, 
    [Windows.Forms.MessageBoxIcon]::Information, 
    [Windows.Forms.MessageBoxDefaultButton]::Button1,
    [Windows.Forms.MessageBoxOptions]::TopMost)

# ✅ TopMost な WinForms Form をオーナーにして Activate() で確実に最前面化
$owner = New-Object Windows.Forms.Form
$owner.TopMost = $true
[Windows.Forms.MessageBox]::Show($owner, $msg, $title, 
    [Windows.Forms.MessageBoxButtons]::OK,
    [Windows.Forms.MessageBoxIcon]::Information)
$owner.Activate()
$owner.Dispose()
```

**再発防止：** PowerShell で MessageBox を確実に最前面に表示するときは TopMost な WinForms Form をオーナーにして `Activate()` を呼ぶ

**タグ：** #powershell #ui #messagebox #winforms #windows

---

## PowerShell 非同期・スレッド

### [2026-06-12] sticky-todo — PS5.1 で `@(ConvertFrom-Json)` が JSON 配列を二重ラップする

**状況：** `$script:tasks = @($json | ConvertFrom-Json)` で JSON 配列（複数タスク）を受け取った

**問題：** `$script:tasks.Count` が正しいタスク数ではなく 1 になる。`foreach ($t in $script:tasks)` で `$t` がタスク1件ではなく「全タスクの配列」になってしまい、`$t.dueDateTime` が全タスクの dueDateTime をまとめた `Object[]` になる

**原因：** PowerShell 5.1 の `ConvertFrom-Json` は JSON 配列を `Object[]` として返す。`@(Object[])` はその配列をさらに1要素の配列で包むため `@([[task1,task2,task3]])` になる

**解決策：**
```powershell
# ❌ PS5.1 では配列が二重になる
$script:tasks = @($json | ConvertFrom-Json)

# ✅ 配列かどうか確認して直接代入
$parsed = $json | ConvertFrom-Json
$script:tasks = if ($parsed -is [System.Array]) { $parsed } else { @($parsed) }
```

**再発防止：** PowerShell 5.1 で `ConvertFrom-Json` の結果を配列変数に代入するときは必ずこのパターンを使う

**タグ：** #powershell #json #array #ps5.1

---

## PowerShell 非同期・スレッド

### [2026-06-12] sticky-todo — 日本語Windowsで `DateTime.Parse` が ISO 8601 を解釈できない

**状況：** JavaScriptから送られた `dueDateTime`（例: `"2026-06-12T12:30"`）を PowerShell で `[DateTime]::Parse($str)` でパースしようとした

**問題：** 日本語Windows（ロケール ja-JP）では `DateTime.Parse()` がデフォルトで ISO 8601 形式を解釈できずエラーになる

**原因：** `[DateTime]::Parse()` は引数なしだと現在スレッドのカルチャを使う。ja-JP カルチャは `"yyyy/MM/dd HH:mm"` 形式を期待するため、ISO 8601（`"yyyy-MM-ddTHH:mm"`）でエラーになる

**解決策：**
```powershell
# ❌ ロケール依存
[DateTime]::Parse($str)

# ✅ InvariantCulture を明示
[DateTime]::Parse($str, [System.Globalization.CultureInfo]::InvariantCulture)
```

**再発防止：** PowerShell で日付文字列をパースするときは必ず `InvariantCulture` を指定する

**タグ：** #powershell #datetime #locale #japanese-windows

---

## PowerShell 非同期・スレッド

### [2026-05-29] sticky-todo — PowerShell 5.1 で `Task.Wait()` がデッドロックする

**状況：** `HttpListener.GetContextAsync().Wait(10000)` でタイムアウト付きの非同期待機を実装した

**問題：** `Wait()` が永久にブロックし、ループが全く動かない。`Write-Host` も出力されず、タイマーチェックも発火しない

**原因：** PowerShell 5.1（.NET Framework）の SynchronizationContext により、`Task.Wait()` / `Task.Result` が同じスレッドへの継続を待ってデッドロックする。これは .NET の async/await における既知の落とし穴

**解決策：**
```powershell
# ❌ デッドロックする
$task = $http.GetContextAsync()
$ok   = $task.Wait(10000)
$ctx  = $task.Result

# ✅ 正しい（BeginGetContext + WaitHandle）
$ar  = $http.BeginGetContext($null, $null)
$ok  = $ar.AsyncWaitHandle.WaitOne(10000)
$ctx = $http.EndGetContext($ar)
```

**再発防止：**
- PowerShell 5.1 では `Task.Wait()` / `Task.Result` を HttpListener ループで使わない
- `BeginXxx/EndXxx`（APM パターン）+ `WaitHandle.WaitOne` を使う
- .NET の async API を PowerShell から使う場合は常にデッドロックリスクを疑う

**タグ：** #powershell #async #httplistener #deadlock #dotnet

---

## PowerShell 構文

### [2026-05-29] sticky-todo — `Get-Date` のフォーマット文字列には `-Format` が必要

**状況：** `Write-Log` 関数内で `Get-Date 'HH:mm:ss'` と書いた

**問題：** PowerShell が `'HH:mm:ss'` を DateTime 値として解釈しようとしてエラー。ログが一切出力されない

**原因：** `Get-Date` に文字列を渡すと `-Date` パラメーター（パースする日時）として扱われる。フォーマット指定には `-Format` フラグが必須

**解決策：**
```powershell
# ❌ 間違い
Get-Date 'HH:mm:ss'

# ✅ 正しい
Get-Date -Format 'HH:mm:ss'
# または
(Get-Date).ToString('HH:mm:ss')
```

**再発防止：** PowerShell の `Get-Date` はフォーマット指定に必ず `-Format` を明示する

**タグ：** #powershell #datetime #syntax

---

## Windows Batch・コマンド実行

### [2026-05-28] sticky-todo — Windows Batch の `start` コマンド：タイトル引数の位置が重要

**状況：** `launch.bat` で `start` コマンドを使ってPowerShell サーバーとEdgeブラウザを起動しようとしていた

**問題：** `start /MIN /D "%~dp0" "タイトル" powershell ...` のように引数を指定するとフォルダが開いてしまい、本来の動作（サーバー起動）が実行されない。タイトル引数が正しく認識されていない

**原因：** Windows Batch の `start` コマンドは**タイトル引数を最初に配置**する必要がある。正しい順序は `start "Title" /フラグ /フラグ コマンド` である。引数順序を間違えると、`start` コマンドの引数パーサーが混乱し、予期しない動作（フォルダ開き）が発生する

**解決策：**
```batch
rem ❌ 間違った順序
start /MIN /D "%~dp0" "タイトル" powershell -File "server.ps1"

rem ✅ 正しい順序
start "ToDo丸Server" /MIN /D "%~dp0" powershell -NoProfile -ExecutionPolicy Bypass -File "server.ps1"
```
タイトル引数（引用符で囲まれたテキスト）を`start`の直後に配置することで、正常に動作する

**再発防止：**
- `start` コマンドの引数順序：`start "Title" /flag1 /flag2 /D "path" command [args]`
- タイトル引数が複雑な引用符を含む場合、特にフラグとの相互作用に注意
- `start` コマンドはWindowsの古いコマンドのため、ドキュメント（`start /?`）の確認が重要

**タグ：** #batch #windows #automation #start-command

---

## テンプレート

```
### [YYYY-MM-DD] プロジェクト名 — タイトル

**状況：** どういう実装をしようとしていたか

**問題：** 何が起きたか

**原因：** なぜ起きたか

**解決策：** どう直したか

**再発防止：** 次回から気をつけること

**タグ：** #css #javascript #ios など
```

---

## PowerShell・Windows ネイティブスクリプト

### [2026-06-02, 2026-06-04] sticky-todo — PowerShell notifier の起動エラー診断：「診断が先、コーディングは後」

**状況：** リマインダー機能で PowerShell 製 notifier.ps1 を起動し、MessageBox で通知を表示しようとした。実装後のユーザーテストで「全然ダメ」というフィードバックを受けた

**問題：** MessageBox が画面に出ていない、または出ていても最前面に表示されていない可能性がある。複数の根本原因が考えられ、どれが真因かが不明確

**原因（仮説3つ）：**
1. **notifier.ps1 そのものが起動していない可能性** → タスクマネージャーで `powershell.exe` が見えるか確認
2. **MessageBox は起動しているが `-WindowStyle Hidden` で隠れている** → エラーメッセージが見えない、診断困難
3. **MessageBox は見えるが `DefaultDesktopOnly` では最前面に表示されない** → `MB_TOPMOST (0x40000)` フラグが必要な可能性
4. **`SetForegroundWindow` は背景プロセスからは効かない** → Windows セキュリティ制約

**教訓：** 複数の根本原因が考えられる場合は、「コーディング→テスト」ではなく「**診断スクリプト作成→ユーザー環境で実行→エラーメッセージ収集→仮説絞り込み→修正**」というアプローチが必須

**解決プロセス：**
```
❌ 間違ったアプローチ（ハマった）
1. notifier.ps1 に `-WindowStyle Hidden` で起動
2. ユーザーが「見えない」と報告
3. コード上で MB_TOPMOST を追加してみる
4. SetForegroundWindow を追加してみる
5. 試行錯誤の繰り返し → 時間浪費

✅ 正しいアプローチ（2026-06-02 で実装）
1. debug-notifier.bat を作成（目に見える形で起動）
2. ユーザーに実行してもらう
3. エラーメッセージを見て根本原因を特定
4. そこから仮説が1つに絞れる
5. 正確な修正 → 次セッションで検証
```

**再発防止：**
- PowerShell の `-WindowStyle Hidden` はエラー診断を妨げる → 診断時は `Visible` で実行
- 複数の根本原因が考えられるときは、診断スクリプト（エラー出力を目に見える形）をユーザー環境で実行してから仮説検証
- 「MessageBox が出ない」という症状は複数の理由があるため、最初に「プロセスが起動しているか」を確認すること
- `DefaultDesktopOnly` vs `MB_TOPMOST` の機能差を正確に理解すること

**タグ：** #powershell #windows #notifier #diagnosis #debugging

### [2026-06-11] sticky-todo — PowerShell 隠れた起動エラーの可視化：test-notifier.bat による直接診断

**状況：** notifier.ps1 をローンチしているにもかかわらず MessageBox が表示されない。前セッションで debug-notifier.bat を作成してコンポーネントテストを実施していたが、notifier.ps1 本体の起動エラーが見えない状態だった

**問題：** notifier.ps1 は `launch.bat` から `-WindowStyle Hidden` で起動されるため、起動時のエラーがコマンドプロンプトに表示されない。そのため **notifier.ps1 が起動直後にクラッシュしている可能性が高いのに、ユーザーが原因を特定できない** という状況

**原因：** 隠れた状態（Hidden）での起動は、スクリプト作成者側での診断・デバッグに向いていない。エラーメッセージが画面に出ていないため、何が失敗しているかが全く見えない

**解決策：** 可視状態で実行するテスト用バッチファイル `test-notifier.bat` を作成。このバッチは `-WindowStyle Hidden` を使わずに notifier.ps1 を起動し、コマンドプロンプト上にエラーメッセージを出力させる

```batch
@echo off
REM test-notifier.bat — notifier.ps1 を可視状態で起動してエラーを直接確認
powershell -NoProfile -ExecutionPolicy Bypass -File "notifier.ps1"
pause
```

この方法により：
- **エラーメッセージが見える** → モジュールロード失敗、パス解決失敗、権限エラーなどが特定可能
- **クラッシュなら黒い画面で停止** → スクリプトの実行状況をリアルタイムで確認
- **正常ならずっと動き続ける** → スクリプトが正常に実行されていることを確認可能

**再発防止：**
- バックグラウンドプロセスとして実行する必要がない開発段階では、常に可視状態（`-WindowStyle Visible` または Hidden なし）で実行して診断する
- `launch.bat` の最終版では `-WindowStyle Hidden` を使うが、**テスト段階では診断用の可視バッチを別に作成** して問題切り分けを簡素化
- 「目に見える形での診断」が問題の早期特定・早期解決につながる

**タグ：** #powershell #windows #debugging #diagnosis #automation

---

### [2026-05-29] sticky-todo — Linux 環境で作成した Batch/PowerShell スクリプトのエンコーディング問題

**状況：** Linux 環境でバッチファイル（launch.bat）と PowerShell スクリプト（notifier.ps1）を作成し、Windows 上で実行しようとしていた

**問題：** バッチファイル内の日本語文字列（"リマインド！"など）が cmd.exe で正しく読み込まれず、コマンド解析に失敗。バッチファイルが実行されるが、PowerShell 起動が失敗したり、予期しない動作が起きたりする

**原因：** 
- Linux 環境（または WSL）で作成されたテキストファイルはデフォルトで **UTF-8** エンコーディング
- Windows の cmd.exe は **Shift-JIS（SJIS）** エンコーディングでバッチファイルを読み込む
- UTF-8 で符号化された日本語文字がカテゴリーが正しく認識されず、バイトシーケンスが破壊される
- PowerShell スクリプト内の日本語も同様に破壊される可能性がある

**具体例：**
```
❌ Linux で作成したバッチファイル（実際には UTF-8）
@echo off
title ToDo丸Server
echo リマインド！

↓ Windows cmd.exe が Shift-JIS として読み込む

cmd: リマインド → 破壊されたバイト列 → 認識できない文字列
```

**解決策：**
1. **バッチファイル・PowerShell スクリプトから日本語を完全に除去** → 英語のみのコメント・メッセージに統一
2. **ファイルのエンコーディングを Shift-JIS に明示的に変換** → `iconv` や `dos2unix` などのツールを使用（非推奨：複雑で互換性問題が増える）
3. **Windows 環境で再作成** → Notepad などで新規作成し、Shift-JIS で保存（推奨）

実装では「1. 日本語を英語に置き換える」を採用。これによりプラットフォーム依存性が排除される

**再発防止：**
- Windows の Batch/PowerShell スクリプトにはコメントを含めて **英語のみ** を使用
- UI表示やユーザーメッセージは、JavaScript（HTML内）で処理し、コマンドラインツール側は英語に統一
- Linux/WSL 環境で Batch/PowerShell を作成する場合は、完成後に必ず Windows マシンで動作確認
- Batch ファイル内で日本語を使いたい場合は、外部設定ファイル（JSON など UTF-8 対応）から読み込む方法を検討

**タグ：** #batch #powershell #windows #encoding #internationalization #linux-windows-compat

---

## セッションスクリプト・自動化

### [2026-05-24] workspace-setup — Stop フックは「セッション終了時」ではなく「Claudeの返答後」に毎回発動

**状況：** セッション終了時に自動振り返り・知識追記を行う Stop フック（agent型）を実装しようとした

**問題：** Stop フックが「セッション終了時」ではなく「Claudeの返答後」に毎回発動することに気づいた。1回の会話で何度も振り返り処理が実行されてしまい、トークン無駄遣い・不要な git commit が多発する

**原因：** Claude Code の stop_hook は「セッション終了時」ではなく「AI返答終了時」に呼ばれる設計。つまり「伊神さんが質問→Claude返答→Stop発動」が1ターンあるたびに動く

**解決策：**
- Stop フックを「軽量な commit & push のみ」に限定（AI振り返りなし）
- 知識の振り返り・追記は手動スキル `/wrap-up` として実装
- 伊神さんが「今日終わり」と思ったときだけ `/wrap-up` を呼ぶ運用に変更

| 役割 | 方法 | タイミング |
|---|---|---|
| commit & push（自動） | Stop フック（コマンド型） | 毎ターン後・軽い |
| 知識の振り返り・追記（手動） | `/wrap-up` スキル | 伊神さんが「今日終わり」と思ったとき |

**再発防止：** 自動化スクリプトは「毎回実行→トークン無駄遣い」という落とし穴がある。毎回vs手動のバランスを最初に検討する

**タグ：** #automation #hook #claude-code #workflow

---

## 既知の注意事項（初期登録）

### [2026-05-23] 共通 — 日本語フォントの縦書き指定はブラウザ依存に注意

**状況：** CSS `writing-mode: vertical-rl` で縦書きレイアウトを実装

**問題：** ブラウザ・OS によって文字の向きや行間が異なる表示になる

**原因：** 縦書きのフォントレンダリングはブラウザ実装差が大きい

**解決策：** 縦書きを使う場合は Chrome / Firefox / Safari / iOS Safari の4環境で確認する

**再発防止：** 縦書きレイアウトが必要かどうか事前にユーザーに確認し、代替として横書き＋回転を検討する

**タグ：** #css #font #cross-browser

---

### [2026-05-23] 共通 — iOSでのtouchイベントはpassive:trueが必要な場合あり

**状況：** スクロール中のタッチ操作を `touchstart` / `touchmove` で制御しようとした

**問題：** iOS Safari でスクロールがカクつく、または警告が出る

**原因：** iOS はデフォルトでパッシブイベントを期待しており、`preventDefault()` を呼ぶと競合する

**解決策：**
```javascript
// passiveを明示する
element.addEventListener('touchstart', handler, { passive: true });

// preventDefault()が必要な場合はpassive:falseを明示
element.addEventListener('touchmove', handler, { passive: false });
```

**再発防止：** タッチイベントを使う際は最初から `passive` オプションを意識する

**タグ：** #javascript #ios #touch #performance

---

### [2026-05-23] 共通 — localStorageはプライベートモードで動作しない

**状況：** スコアや進捗を `localStorage` に保存する実装をした

**問題：** プライベート（シークレット）ブラウジングモードでエラーが発生し、ゲームが動かなくなる

**原因：** プライベートモードでは `localStorage` へのアクセスが制限・禁止される場合がある

**解決策：**
```javascript
// localStorage使用前にtry-catchで保護する
function saveData(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // プライベートモードや容量超過の場合は無視して続行
    console.warn('保存できませんでした:', e);
  }
}

function loadData(key, defaultValue) {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch (e) {
    return defaultValue;
  }
}
```

**再発防止：** `localStorage` を使う場合は必ず try-catch で囲む

**タグ：** #javascript #localstorage #private-mode

---

## 関連リンク

- 成功パターン集 → [patterns.md](./patterns.md)
- コーディング規約 → [rules.md](./rules.md)
