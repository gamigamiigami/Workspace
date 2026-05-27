@echo off
setlocal EnableDelayedExpansion

rem ===== 先生のTodoメモ 起動スクリプト =====

set "HTMLPATH=%~dp0todo.html"
set "HTMLPATH=!HTMLPATH:\=/!"

rem Edgeのインストール場所を順番に探す
set "EDGE="
if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
  set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
)
if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" (
  set "EDGE=C:\Program Files\Microsoft\Edge\Application\msedge.exe"
)

if "!EDGE!" == "" (
  echo Edgeが見つかりませんでした。
  echo todo.html を直接ダブルクリックして開いてください。
  pause
  goto :eof
)

start "" "!EDGE!" "--app=file:///!HTMLPATH!" --window-size=1280,820

endlocal
