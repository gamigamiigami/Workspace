@echo off
rem ===== ToDo丸 起動スクリプト =====
rem ローカルサーバー経由で起動することでブラウザ通知（Notification API）を有効化

set "PORT=48765"
set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

rem スクリプトのあるフォルダに移動（日本語フォルダ名対応）
cd /d "%~dp0"

rem サーバーを最小化ウィンドウで起動（すでに起動中の場合は何もしない）
start /MIN "" powershell -NoProfile -ExecutionPolicy Bypass -File "server.ps1" -Port %PORT%

rem サーバー起動を待つ
timeout /t 2 /nobreak > nul

rem EdgeでAppモードとして起動
start "" "%EDGE%" --app=http://localhost:%PORT%/todo.html --window-size=380,270
