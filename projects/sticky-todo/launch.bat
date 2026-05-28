@echo off
rem ===== ToDo丸 起動スクリプト =====

set "HTMLFILE=%~dp0todo.html"

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

powershell -NoProfile -Command "& { $u = ([uri]$env:HTMLFILE).AbsoluteUri; Start-Process $env:EDGE \"--app=$u --window-size=380,270\" }"
