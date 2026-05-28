@echo off
rem ===== ToDo丸 起動スクリプト =====

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

start "" "%EDGE%" "--app=file:///%~dp0todo.html" --window-size=380,270
