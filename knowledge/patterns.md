# 成功パターン集

最終更新：2026-05-24

新しいパターンは **先頭に追加** する。プロジェクト名を必ず記載。
複数プロジェクトで使えると判明したパターンには `[汎用]` タグをつける。

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
