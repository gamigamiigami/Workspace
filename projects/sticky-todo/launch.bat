@echo off
rem ===== ToDo丸 起動スクリプト =====

set "PORT=48765"

rem ===== Edgeのパスを自動検索 =====
set "EDGE="
if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" (
  set "EDGE=C:\Program Files\Microsoft\Edge\Application\msedge.exe"
) else if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
  set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
)

if not defined EDGE (
  echo Edgeが見つかりませんでした。
  pause
  exit /b 1
)

rem ===== サーバーを起動（/D で作業フォルダを指定）=====
start /MIN /D "%~dp0" "" powershell -NoProfile -ExecutionPolicy Bypass -File "server.ps1" -Port %PORT%

rem サーバー起動を待つ
timeout /t 2 /nobreak > nul

rem ===== EdgeでAppモードとして起動 =====
start "" "%EDGE%" --app=http://localhost:%PORT%/todo.html --window-size=380,270
