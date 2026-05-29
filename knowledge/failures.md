# 失敗・ハマりポイント集

最終更新：2026-05-28

新しいエントリは **先頭に追加** する。プロジェクト名を必ず記載。

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
