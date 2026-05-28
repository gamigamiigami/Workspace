@echo off
rem ===== ToDo丸 起動スクリプト =====
rem ローカルサーバー経由で起動することでブラウザ通知（Notification API）を有効化

set "DIR=%~dp0"
set "PORT=48765"
set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

rem バックグラウンドでHTTPサーバーを起動（すでに起動中の場合は何もしない）
start "" /B powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%DIR%server.ps1" -Dir "%DIR%" -Port %PORT%

rem サーバー起動を少し待つ
timeout /t 1 /nobreak > nul

rem EdgeでAppモードとして起動
start "" "%EDGE%" --app=http://localhost:%PORT%/todo.html --window-size=380,270
