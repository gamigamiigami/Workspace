# 成功パターン集

最終更新：2026-05-30

新しいパターンは **先頭に追加** する。プロジェクト名を必ず記載。
複数プロジェクトで使えると判明したパターンには `[汎用]` タグをつける。

---

## デスクトップ環境・起動スクリプト

### [汎用] Windows PowerShell 非同期タスク通知機構（アプリ最小化対応）

**用途：** ブラウザアプリやデスクトップアプリでバックグラウンドタスクの完了を通知する必要があり、かつアプリが最小化されたり非アクティブになったりしてもユーザーに気づかせたい場合。JavaScriptのページ内タイマーはバックグラウンドタブで停止するため、PowerShellで独立したプロセスを起動して定期的にポーリングを行う。

**アーキテクチャ：**
```
1. アプリ起動時・タスク保存時：JavaScript が /tasks POST → サーバーがメモリに登録
2. 独立チェック：PowerShell notifier.ps1 が 30秒ごとに GET /fired ポーリング
3. 通知判定：サーバーが pastdue かつ !reminded な task を列挙
4. 通知表示：PowerShell MessageBox を DefaultDesktopOnly で表示
5. 状態管理：JavaScript/PowerShell が lastReminded を共有（重複防止）
```

**実装例：**

1. **server.ps1（タスク管理エンドポイント）**
```powershell
# POST /tasks: タスク登録
# { taskId, deadline, title, ... }
$script:tasks = @()

if ($path -eq 'tasks') {
  if ($ctx.Request.HttpMethod -eq 'POST') {
    $body = [System.IO.StreamReader]::new($ctx.Request.InputStream).ReadToEnd()
    $task = $body | ConvertFrom-Json
    $script:tasks += $task
  }
}

# GET /fired: 通知対象タスク一覧
if ($path -eq 'fired') {
  $now = (Get-Date).ToUniversalTime()
  $pastdue = $script:tasks | Where-Object {
    [datetime]::Parse($_.deadline) -lt $now -and -not $_.reminded
  }
  $response.ContentType = 'application/json'
  $json = $pastdue | ConvertTo-Json
  [byte[]]$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $response.OutputStream.Write($bytes, 0, $bytes.Length)
}
```

2. **notifier.ps1（独立ポーリング・通知スクリプト）**
```powershell
# 30秒ごとにGET /fired をポーリング
while ($true) {
  try {
    $response = Invoke-WebRequest -Uri "http://localhost:48765/fired" -Method GET -ErrorAction Stop
    $tasks = $response.Content | ConvertFrom-Json
    
    foreach ($task in $tasks) {
      # MessageBox: DefaultDesktopOnly = アプリが最小化でも強制表示
      [System.Windows.Forms.MessageBox]::Show(
        $task.title,
        "Reminder",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information,
        [System.Windows.Forms.MessageBoxDefaultButton]::Button1,
        [System.Windows.Forms.MessageBoxOptions]::DefaultDesktopOnly
      )
      
      # 通知済みマーク
      Invoke-WebRequest -Uri "http://localhost:48765/mark?id=$($task.taskId)" -ErrorAction Stop
    }
  } catch { }
  
  Start-Sleep -Seconds 30
}
```

3. **JavaScript（通知表示・状態連携）**
```javascript
// アプリ起動・タスク保存時
fetch('/tasks', {
  method: 'POST',
  body: JSON.stringify({ taskId, deadline, title })
});

// アプリがアクティブなとき、またはBroadcastChannel経由で通知
window.addEventListener('focus', async () => {
  const resp = await fetch('/fired');
  const tasks = await resp.json();
  // アプリのモーダル表示（notifier が接続不可時のフォールバック）
  tasks.forEach(task => showModalReminder(task));
});
```

**ポイント：**
- **PowerShell の DefaultDesktopOnly**：他のアプリが最前面でもMessageBox を強制的に表示。デスクトップ専有フラグなので、ダイアログが確実にユーザーの目に入る

**拡張：アプリ最前面化（Win32 API）**

アプリが最小化されている場合、MessageBox だけでは見えないことがあります。その場合は Win32 API で対象ウィンドウを復元・最前面化してから MessageBox を表示します。

```powershell
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32 {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
    [DllImport("user32.dll", CharSet=CharSet.Auto)]
    public static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
}
"@

function Invoke-BringToFront {
    try {
        Get-Process msedge -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | ForEach-Object {
            $sb = [System.Text.StringBuilder]::new(256)
            [Win32]::GetWindowText($_.MainWindowHandle, $sb, 256) | Out-Null
            if ($sb.ToString() -match 'ToDo') {
                [Win32]::ShowWindow($_.MainWindowHandle, 9) | Out-Null   # SW_RESTORE
                [Win32]::SetForegroundWindow($_.MainWindowHandle) | Out-Null
            }
        }
    } catch {}
}

# 通知時に呼び出す
Invoke-BringToFront
[System.Windows.Forms.MessageBox]::Show(...)
```

**利点：**
- 最小化されたウィンドウも復元される
- 通知時に確実にアプリがユーザーの目に入る状態になる
- タイトルマッチングでターゲットプロセスを特定可能
- **独立プロセス**：JavaScriptのタイマーはバックグラウンドタブで停止されるため、PowerShellの常時ポーリングが必須
- **状態共有**：lastReminded フィールドでPowerShell と JavaScript が通知状態を共有。重複通知を防止
- **フォールバック**：PowerShell notifier が接続不可の場合でも、JavaScript のモーダルダイアログが動作（アプリウィンドウが開いている場合）
- **エラー処理**：Invoke-WebRequest のエラーを黙って無視（`-ErrorAction Stop` → catch で無視）することで、サーバーが落ちてもnotifier プロセスが死なない

**注意：**
- MessageBox は同期的なため、複数タスクがある場合は1件ずつ表示される
- PowerShell の実行ポリシー設定が必要：`Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope CurrentUser`
- notifier.ps1 を常時起動するため、Windows タスクスケジューラまたは startup フォルダに配置を推奨

**診断テクニック：隠れた起動エラーの可視化**

PowerShell スクリプトが `-WindowStyle Hidden` で起動されている場合、エラーメッセージは見えず、スクリプトが起動直後にクラッシュしていても原因特定が困難です。これを解決するために：

1. **可視実行用テストバッチを別に作成**
```batch
@echo off
REM test-notifier.bat — notifier.ps1 を可視状態で実行
powershell -NoProfile -ExecutionPolicy Bypass -File "notifier.ps1"
pause
```

2. **実行結果の判定**
   - エラーメッセージが表示される → エラー内容から原因を特定
   - 何も出ずにすぐ終了 → スクリプト内のエラー処理が原因
   - ずっと動き続ける → 正常起動（Hidden 版の問題は別）

3. **ログファイル記録との組み合わせ**
```powershell
# notifier.ps1 のエラーハンドリング例
$logFile = "$env:TEMP\notifier.log"
try {
    # メイン処理
    Add-Type -AssemblyName System.Windows.Forms
    # ...
} catch {
    Add-Content $logFile "$(Get-Date): ERROR: $_"
    Write-Host "Error: $_"  # テスト時に画面に出力
}
```

このアプローチにより、開発段階での問題特定と本番段階での無音実行（Hidden）を両立させられます。

**発見：**
- notifier.ps1 が起動できない場合、アプリが最小化されると完全無音になる→アプリのモーダルダイアログが必須（JavaScript フォールバック）
- アプリウィンドウが開いている限り、モーダルダイアログは常に表示される設計が堅牢
- 音声通知と視覚フィードバック（タイトル点滅、アイコン赤点滅、揺れアニメ）は独立して制御可能
- 「メッセージボックスのみ」モードでは、PowerShell notifier に接続できない場合でもアプリのモーダルダイアログでユーザーに通知できる

**拡張仕様：通知方法の柔軟化**

複数の通知方法を実装して、ユーザーが選択できるようにする場合：

| 要素 | アラームあり | メッセージボックスのみ |
|-----|---------|------------|
| 音声 | ✓（3音ビープ × 4秒） | ✗ |
| タイトル点滅 | ✓（「⏰ リマインド！」） | ✓ |
| アイコン赤点滅 | ✓ | ✓ |
| 揺れアニメ | ✓ | ✓ |
| アプリ内モーダル | ✓ | ✓ |
| PowerShell MessageBox | ✓（警告アイコン ⚠） | ✓（情報アイコン ℹ） |

実装方法：
- JavaScript レイヤーで `sound` フラグを管理
- CSS で点滅・揺れアニメは常時実装
- PowerShell notifier では `DefaultDesktopOnly` で必ず表示

**使用プロジェクト：** sticky-todo（ToDo管理アプリ・リマインダー機能）

**タグ：** #windows #powershell #notifications #background-task #polling #async #reliability #ux-customization

---

## デスクトップ環境・起動スクリプト

### [汎用] Windows Batch + PowerShell ローカルサーバー起動スクリプト

**用途：** Windows 環境で Webアプリを localhost サーバー経由で起動し、ブラウザの Notification API・localStorage・IndexedDB などのセキュリティ制限を回避したい場合。ユーザーが `.bat` ファイルをダブルクリックするだけで即座に起動する環境を実現。

**構成ファイル：**

1. **launch.bat** （起動スクリプト）
```batch
@echo off
set "PORT=48765"
set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

rem スクリプトのあるフォルダに移動（日本語フォルダ名対応）
cd /d "%~dp0"

rem サーバーを最小化ウィンドウで起動
start /MIN "" powershell -NoProfile -ExecutionPolicy Bypass -File "server.ps1" -Port %PORT%

rem サーバー起動を待つ
timeout /t 2 /nobreak > nul

rem EdgeでAppモードとして起動
start "" "%EDGE%" --app=http://localhost:%PORT%/todo.html --window-size=380,270
```

2. **server.ps1** （ローカルサーバー）
```powershell
param([string]$Dir = $PSScriptRoot, [int]$Port = 48765)

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")

try {
    $listener.Start()
} catch {
    # すでに起動済みなら何もしない
    exit 0
}

while ($listener.IsListening) {
    try {
        $ctx  = $listener.GetContext()
        $path = $ctx.Request.Url.LocalPath.TrimStart('/')
        if ($path -eq '') { $path = 'todo.html' }
        $file = Join-Path $Dir $path

        if (Test-Path $file -PathType Leaf) {
            $bytes = [System.IO.File]::ReadAllBytes($file)
            $ext   = [System.IO.Path]::GetExtension($file).ToLower()
            $ctx.Response.ContentType = switch ($ext) {
                '.html' { 'text/html; charset=utf-8' }
                '.js'   { 'application/javascript' }
                '.css'  { 'text/css' }
                default { 'application/octet-stream' }
            }
            $ctx.Response.ContentLength64 = $bytes.Length
            $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $ctx.Response.StatusCode = 404
        }
        $ctx.Response.Close()
    } catch { break }
}
```

**ポイント：**
- **`cd /d "%~dp0"`**：Batch スクリプト自身のフォルダに移動。`/d` フラグでドライブ変更を許可。日本語フォルダ名でも正常動作。
- **PowerShell の `$PSScriptRoot`**：PowerShell スクリプトが呼ばれたフォルダを自動的に参照。相対パスで HTML ファイルにアクセス可能。
- **`start /MIN`**：サーバープロセスを最小化ウィンドウで起動。タスクバーに目立たない形で表示されて UX が向上。
- **`timeout /t 2`**：サーバー起動遅延時の安定性向上（1秒では短すぎる場合がある）。
- **`--app=http://...`**：Edge のアプリモード。ウィンドウのアドレスバー・タブを非表示にしてデスクトップアプリ風 UI を実現。

**使用プロジェクト：** sticky-todo（ToDo管理アプリ）

**タグ：** #windows #batch #powershell #localhost #notification-api #desktop-app

---

## テンプレート

```
### [汎用 or プロジェクト名] パターン名

**用途：** どういう場面で使うか

**コード：**
（コードスニペット）

**ポイント：** なぜこの実装が良いか、注意点

**使用プロジェクト：** プロジェクト名1, プロジェクト名2

**タグ：** #quiz #animation #accessibility など
```

---

## UI・CSS・機能設計

### [汎用] PDCA サイクル短期回転による段階的品質改善

**用途：** UI最適化、コード品質改善、機能調整など、複数回の改善が必要な場合、Plan→Do→Check→Act のサイクルを短期（1セッション内、または複数セッション）で回すことで、改善の意図・プロセス・成果を記録しながら実装する

**手法：**
1. **Plan**：目標を明確に定義（「カード情報を最小化する」「coding-rules 準拠に修正する」など）
2. **Do**：具体的な実装を行う（HTML・CSS・JavaScript を修正）
3. **Check**：視覚的な検証、コード品質確認、ユーザーフィードバック収集
4. **Act**：Check の結果に基づいて調整・修正を行う。新たな課題があれば次の Plan に進む
5. **記録**：各サイクルの内容（修正項目、removed/retained 機能など）を task-diary.md に記載

**スケール例（sticky-todo プロジェクト）：**
- **Cycle 1**: カード情報削減（タイトル＋締切日のみ）、モーダル統一（4フィールド）、ソート削除
- **Cycle 2**: `onclick=` 属性（coding-rules違反）を発見 → `addEventListener` に一括置換
- **Cycle 3**: カテゴリ名短縮化の修正、余白・フォント最終調整

**ポイント：**
- PDCA を短期で回すことで「何をなぜ変更したか」が明確に記録される
- Check フェーズで「見た目」と「コード品質」の両方を検証する
- Act で改善した内容は task-diary に記載し、プロジェクトの改善履歴として蓄積
- 複数セッションにまたがる場合、前セッションの成果を引き継ぎながら次フェーズに進む

**注意：**
- Check 段階で「完璧」を目指さず、「改善の方向性」が正しいかを重視
- Act で新たな課題が見つかったら、すぐに次の Plan に進み、ループを止めないこと
- 改善内容を記録しないと、次セッション以降にコンテキストが失われるため、task-diary への記載は必須

**使用プロジェクト：** sticky-todo（ToDo管理アプリ）

**タグ：** #pdca #quality-improvement #iterative-design #documentation

---

### [汎用] UIのコンパクト化・レスポンシブ化 —数値調整ベース

**用途：** ウィンドウサイズやUIコンポーネントが大きすぎる場合、すべてのCSSプロパティ（パディング・マージン・フォントサイズ・高さ・幅・境界線半径など）を一貫性を保ちながら調整する

**手法：**
1. **ターゲットサイズ決定**：目標とするウィンドウサイズ（e.g., 1280×820 → 960×680）や見た目を定義
2. **調整対象の特定**：タイトルバー・ボタン・フィルタ・入力欄・カード・パディングなど、すべてのコンポーネントを列挙
3. **比率計算**：元のサイズから目標サイズへの縮小率を計算（例：40%削減なら、52px → 42px のように調整）
4. **一括修正**：CSS内のすべての数値を同じ比率で削減。フォントサイズ・パディング・マージン・高さ・border-radiusを統一的に縮小
5. **複数ファイル対応**：複数のスタイルシート（HTML内の `<style>` など）にわたる場合、コピペリスクが高いため全パターンを確認して変更

**スケール例（sticky-todo プロジェクト）：**
```
タイトルバー高さ       ：52px    → 42px  (-20%)
フォント（タイトル）   ：15px    → 13px  (-13%)
フォント（その他）     ：12px    → 11px  (-8%)
パディング・マージン   ：14px    → 10px  (-28%)
ボタン高さ            ：34px    → 28px  (-17%)
カード最小幅          ：280px   → 220px (-21%)
icon/SVG幅            ：28px    → 22px  (-21%)
```

**ポイント：**
- 「小さい」という要望が来たら数値で調整すると効率的
- CSS変数（`--color`, `--padding` など）を活用すると、複数箇所の変更が一括化される
- 一貫性を保つため、タイトルバー・ボタン・フィルタ・カード・ツールバーなど全セクションを同一リズムで調整

**注意：**
- フォントサイズを極度に小さくすると可読性が低下（11px以下は避ける推奨）
- border-radiusを削減しすぎると、丸みが失われて見た目が硬くなるため、比率は控えめに
- 複数ファイルにまたがる場合、修正漏れリスクが高い→修正後は全体を視覚的に確認

**使用プロジェクト：** sticky-todo（Windows Fluent Design風UI）

**タグ：** #css #ui #responsive #design-system #consistency

---

### [汎用] ウィンドウサイズ保存機能 —localStorage使用

**用途：** Electronアプリ・Edgeアプリモードなど、デスクトップアプリ風のWebアプリで、ユーザーがリサイズしたウィンドウサイズを記憶し、次回起動時に同じサイズで開く機能を実装したい場合

**手法：**
1. **ウィンドウサイズ取得**：`window.innerWidth`, `window.innerHeight` で現在のサイズを取得
2. **localStorage に保存**：リサイズイベント（`window.onresize`）で毎回サイズをJSON化して保存
3. **起動時に復元**：ページロード時（`window.onload` または `DOMContentLoaded`）に localStorage から取得してウィンドウサイズを設定
4. **デバウンス処理**（オプション）：リサイズイベント発火時に毎回保存すると負荷が高いため、タイマーを使ってデバウンスすることを推奨

**スケール例（sticky-todo プロジェクト）：**
```javascript
// ウィンドウサイズを localStorage に保存
function saveWindowSize() {
  const size = {
    width: window.innerWidth,
    height: window.innerHeight
  };
  localStorage.setItem('windowSize', JSON.stringify(size));
}

// 起動時にサイズを復元
window.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('windowSize');
  if (saved) {
    const { width, height } = JSON.parse(saved);
    window.resizeTo(width, height);
  }
});

// リサイズ時に保存（デバウンス付き）
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(saveWindowSize, 500);
});
```

**ポイント：**
- localStorage は同一オリジンで複数タブ・ウィンドウで同期される
- `window.resizeTo()` で復元するが、一部ブラウザ・セキュリティ設定で制限される可能性がある
- 初期表示時のサイズが大きすぎる場合、localStorage が存在しない初回起動時のデフォルトサイズを設定しておく
- デバウンスすることで、リサイズイベントの過剰発火を防ぎパフォーマンスを向上

**注意：**
- localStorage に保存できる最大容量は約5〜10MB（ブラウザ依存）。複数プロジェクトで多くのデータを保存する場合は管理に注意
- Edgeアプリモードでも localStorage は動作するが、アプリモード側で `--window-size` フラグでウィンドウサイズを指定している場合、復元サイズとの競合に注意

**使用プロジェクト：** sticky-todo（Windows Fluent Design風UI）

**タグ：** #javascript #localStorage #ux #desktop-app #responsiveness

---

### [汎用] ローカルサーバー経由のブラウザ API 対応（file:// の制限回避）

**用途：** HTMLファイルを `file://` プロトコルで直接開く際、Notification API・localStorage・IndexedDB など多くのブラウザ API がセキュリティ上の理由で動作しない場合、Windows 環境でローカルサーバー（PowerShell サーバー）を立てて `http://localhost:PORT` でアクセスさせることで、すべてのAPI が確実に動作する環境を実現する

**手法：**
1. **PowerShell サーバースクリプト** (`server.ps1`)：指定ポートでローカル HTTP サーバーを起動
2. **Batch 起動スクリプト** (`launch.bat`)：PowerShell サーバーをバックグラウンド起動、ブラウザで `http://localhost:PORT/ファイル名` を開く
3. **HTMLファイル** (`todo.html`)：`file://` ではなく `http://` でアクセスされるため、すべての API が動作

**コード例（server.ps1）：**
```powershell
$Port = 48765
$Path = Split-Path -Parent $MyInvocation.MyCommand.Path

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()

Write-Host "Server running at http://localhost:$Port (press Ctrl+C to stop)"

while ($listener.IsListening) {
  $context = $listener.GetContext()
  $request = $context.Request
  
  # ローカルファイルのパスを取得
  $localPath = Join-Path $Path ([System.Uri]::UnescapeDataString($request.Url.LocalPath).TrimStart('/'))
  
  if (Test-Path $localPath -PathType Leaf) {
    $content = [System.IO.File]::ReadAllBytes($localPath)
    $context.Response.ContentLength64 = $content.Length
    $context.Response.OutputStream.Write($content, 0, $content.Length)
  } else {
    $context.Response.StatusCode = 404
  }
  
  $context.Response.Close()
}
```

**コード例（launch.bat）：**
```batch
@echo off
cd /d "%~dp0"

REM PowerShell サーバーをバックグラウンド起動
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "& '%~dp0server.ps1'"

REM Edge ブラウザを起動（localhost へアクセス）
timeout /t 1 /nobreak
start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --app=http://localhost:48765/todo.html

exit /b 0
```

**ポイント：**
- PowerShell の `HttpListener` クラスで組み込みHTTPサーバーを実装（外部ツール不要）
- `localhost:PORT` でアクセスすることで、Notification API が確実に動作
- `-WindowStyle Hidden` でサーバープロセスをバックグラウンド実行（ユーザーには見えない）
- `http://` プロトコル経由のため、localStorage・sessionStorage・IndexedDB・Cookies なども確実に動作

**注意：**
- PowerShell 実行ポリシーが制限されている環境では `-ExecutionPolicy Bypass` が必要
- `localhost:PORT` は同一PC内からのみアクセス可能（外部ネットワークからはアクセス不可）
- サーバープロセスはシステムトレイに表示されず、タスクマネージャーで確認可能

**設計の考慮点：**
- **Notification API の確実な動作**：初回起動時に許可ダイアログが出現、以後トースト通知が機能
- **セキュリティ**：`localhost` 限定で、外部からのアクセスは許可しない
- **オフライン動作**：サーバー起動後はネットワーク不要（ローカルファイル読み込みのみ）
- **ユーザーUX**：Batch をダブルクリックするだけで、サーバー起動→ブラウザ起動が自動で完了

**使用プロジェクト：** sticky-todo（リマインダー通知機能）

**タグ：** #windows #powershell #http-server #notification-api #browser-api #localhost

---

## Windows Batch・自動化

### [汎用] Windows launch.bat —日本語フォルダ名のURLエンコード対応

**用途：** HTMLファイルをEdgeブラウザでアプリモード起動する際、フォルダ名が日本語（「とどまる」など）の場合、URLエンコードが必須。PowerShellの `[uri]` クラスを使い、ファイルパスから正しいURLエンコード形式への変換を行う

**コード（launch.bat）：**
```batch
@echo off
rem ===== ToDo丸 起動スクリプト =====
rem 日本語フォルダ名に対応するためPowerShellでURLエンコードして起動

set "HTMLFILE=%~dp0todo.html"
set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

powershell -NoProfile -Command "& { $u = ([uri]$env:HTMLFILE).AbsoluteUri; Start-Process $env:EDGE \"--app=$u --window-size=1280,820\" }"
```

**ポイント：**
- PowerShellの `[uri]` クラスでファイルパスを自動URLエンコード（`とどまる` → `%E3%81%A8%E3%81%A9%E3%81%BE%E3%82%8B`）
- `AbsoluteUri` プロパティで完全なURIスキーム（`file:///...`）を生成
- 環境変数を `$env:変数名` で参照して、PowerShell側から Batch の変数を利用
- 二重引用符をエスケープ（`\"...\"`) して PowerShell コマンド内に埋め込む

**注意：**
- Batch の `file://パス` は日本語文字を自動エンコードしない
- PowerShell `-NoProfile` オプションで起動時間を短縮
- Edge が見つからない場合の例外処理は別途実装推奨

**使用プロジェクト：** sticky-todo

**タグ：** #batch #windows #automation #browser #edge #japanese #urlencoding

---

### [汎用] Windows Batch —シンプルなパス設定パターン（複数行ブロック vs 1行セット）

**用途：** Windows Batch で複数のファイルパスをチェックして、存在する場合のみ変数に設定する場合。特に日本語パスが含まれる環境では、シンプルな1行セットパターンが信頼性が高い

**パターン比較：**

**パターン1 ❌ 複数行ブロック構文（潜在的リスク）**
```batch
if exist "%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe" (
  set "EDGE=%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe"
) else if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
  set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
) else if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" (
  set "EDGE=C:\Program Files\Microsoft\Edge\Application\msedge.exe"
)
```

**リスク：**
- 複数行の `if-else if` ブロック構文は、遅延展開タイミングの問題が生じる可能性がある
- 日本語フォルダ名（「とどまる」など）を含むパス展開時に、変数展開順序がズレることがある

**パターン2 ✅ シンプルな1行セットパターン（推奨）**
```batch
set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" (
  set "EDGE=C:\Program Files\Microsoft\Edge\Application\msedge.exe"
)
```

**メリット：**
- 先に最も一般的なパス（x86）をセット
- x64版が存在すれば上書きするシンプルロジック
- 複数行ブロック構文を避けることで、変数展開タイミングを確実に制御
- 日本語パスが含まれる環境でも安定動作

**ポイント：**
- Windows Batch での「`if-else if` のネストよりも、シーケンシャルなセット→上書き」が信頼性が高い
- `set "変数=値"` の形式で、値を引用符で囲むことで、スペース・特殊文字を含むパスに対応
- 日本語フォルダが含まれる場合、複雑な条件分岐より単純な順序制御が有効

**使用プロジェクト：** sticky-todo

**タグ：** #batch #windows #path-detection #japanese-path #reliability

---

### [汎用] Windows launch.bat —複数パターンの Edge インストール先に対応

**用途：** HTMLファイルをEdgeブラウザでアプリモード起動するlaunch.batスクリプト。Windows環境ごとにEdgeのインストール先が異なるため、複数パスを段階的に探索する

**コード（launch.bat）：**
```batch
@echo off
chcp 65001 > nul
cd /d "%~dp0"

REM Edge の複数のインストール先をチェック（優先順：ローカル→Program Files (x86)→Program Files）
set EDGE_PATH=

REM 1. ユーザーローカルフォルダから Edge を探索（%LOCALAPPDATA%）
if exist "%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe" (
  set "EDGE_PATH=%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe"
  goto :RunEdge
)

REM 2. Program Files (x86) から探索
if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
  set "EDGE_PATH=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
  goto :RunEdge
)

REM 3. Program Files から探索
if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" (
  set "EDGE_PATH=C:\Program Files\Microsoft\Edge\Application\msedge.exe"
  goto :RunEdge
)

REM Edge が見つからない場合
echo "Edge が見つかりません。Edge をインストールしてください。"
pause
exit /b 1

:RunEdge
REM アプリモード起動（--app オプション）
"!EDGE_PATH!" --app="file:///%~dp0todo.html" --profile-directory=Default
exit /b 0
```

**ポイント：**
- `%LOCALAPPDATA%` はユーザーごとのローカルインストール先として最優先
- `setlocal enabledelayedexpansion` を使い、ループ内での変数展開が正確に動作するよう制御
- `if exist` で各パスを段階的にチェック、最初に見つかったものを使用
- アプリモード起動時は `--app` オプションを指定（ブラウザUI非表示）
- `--profile-directory=Default` でユーザープロフィールを明示

**注意：**
- Windows環境によってEdgeインストール先が異なる可能性が高い
- 遅延展開（`!VARIABLE!`）はループ・条件分岐内で重要
- `chcp 65001` でUTF-8対応、`cd /d` で絶対パス移動

**使用プロジェクト：** sticky-todo

**タグ：** #batch #windows #automation #browser #edge

---

## 自動化・スクリプト

### [汎用] settings.json での自動 commit & push フック

**用途：** セッション終了時に自動で git 操作を実行し、push 忘れを防ぐ

**コード（settings.json）：**
```json
{
  "stop_hook": {
    "type": "command",
    "script": [
      {
        "condition": "file_changed",
        "command": "git add -A && git commit -m 'chore: セッション終了 - 自動保存' && git push origin HEAD || true"
      }
    ]
  }
}
```

**使用例：**
- 毎セッション終了時に変更を自動保存
- push 忘れの救済
- 複数ファイル変更時の一括 commit

**ポイント：**
- `|| true` で失敗時もエラーを無視（変更がない場合も考慮）
- `file_changed` 条件で「変更がある場合のみ」実行可能（トークン節約）
- commit メッセージを統一するとログが見やすい

**注意：** Stop フックは「セッション終了」ではなく「Claudeの返答後」に毎回発動するため、AI処理（振り返りなど）をここに入れてはいけない。軽量な git コマンドのみに限定する

**使用プロジェクト：** workspace-setup

**タグ：** #automation #git #hook #claude-code #workflow

---

## 初期パターン集

### [汎用] クイズ問題のシャッフル表示

**用途：** 問題リストをランダム順で出題する

**コード：**
```javascript
// Fisher-Yatesアルゴリズムによるシャッフル
function shuffle(array) {
  const arr = [...array]; // 元の配列を変更しないようコピー
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 使用例
const questions = shuffle(questionList);
```

**ポイント：** 元の配列を破壊しないよう `[...array]` でコピーしてから処理する

**使用プロジェクト：** （初期登録）

**タグ：** #javascript #quiz #array

---

### [汎用] 正解・不正解フィードバック表示

**用途：** 答え合わせ後に視覚的フィードバックを表示する

**コード：**
```javascript
function showFeedback(isCorrect, correctAnswer) {
  const feedback = document.getElementById('feedback');
  if (isCorrect) {
    feedback.textContent = '✓ 正解！';
    feedback.className = 'feedback correct';
  } else {
    feedback.textContent = `✗ 不正解。正解は「${correctAnswer}」`;
    feedback.className = 'feedback incorrect';
  }
}
```

```css
.feedback {
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 18px;
  font-weight: bold;
  text-align: center;
  margin: 16px 0;
}
.feedback.correct   { background: #d4edda; color: #155724; border: 2px solid #28a745; }
.feedback.incorrect { background: #f8d7da; color: #721c24; border: 2px solid #dc3545; }
```

**ポイント：** 色だけでなくアイコン（✓/✗）とテキストで区別する（色覚アクセシビリティ対応）

**使用プロジェクト：** （初期登録）

**タグ：** #javascript #css #quiz #accessibility #feedback

---

### [汎用] スコア表示と進捗バー

**用途：** 現在の問題番号・スコアを常に表示する

**コード：**
```html
<div class="progress-bar">
  <div class="progress-fill" id="progressFill"></div>
</div>
<p class="score-text">問題 <span id="currentQ">1</span> / <span id="totalQ">10</span> ｜ スコア: <span id="score">0</span></p>
```

```css
.progress-bar {
  height: 12px;
  background: #e9ecef;
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 8px;
}
.progress-fill {
  height: 100%;
  background: #28a745;
  border-radius: 6px;
  transition: width 0.3s ease;
}
.score-text { font-size: 14px; color: #666; text-align: right; }
```

```javascript
function updateProgress(current, total, score) {
  document.getElementById('progressFill').style.width = `${(current / total) * 100}%`;
  document.getElementById('currentQ').textContent = current;
  document.getElementById('totalQ').textContent = total;
  document.getElementById('score').textContent = score;
}
```

**ポイント：** `transition` でアニメーションを付けると達成感が出る

**使用プロジェクト：** （初期登録）

**タグ：** #css #javascript #quiz #progress #ux

---

### [汎用] 画面遷移なしのページ切り替え（シングルページ方式）

**用途：** HTMLを1ファイルにまとめ、セクションの表示/非表示で画面遷移を再現する

**コード：**
```html
<!-- 各画面をsectionで定義 -->
<section id="screen-start"  class="screen active">スタート画面</section>
<section id="screen-quiz"   class="screen">クイズ画面</section>
<section id="screen-result" class="screen">結果画面</section>
```

```css
.screen { display: none; }
.screen.active { display: block; }
```

```javascript
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
}

// 使用例
showScreen('screen-quiz');
```

**ポイント：** ファイルが1つで済むため配布・共有が簡単。ページ遷移なしで動作も高速

**使用プロジェクト：** （初期登録）

**タグ：** #javascript #css #spa #single-file

---

## 関連リンク

- 失敗・注意点 → [failures.md](./failures.md)
- コーディング規約 → [rules.md](./rules.md)
- UIコンポーネント → [ui-components.md](./ui-components.md)
