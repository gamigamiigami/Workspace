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

rem バックスラッシュをスラッシュに変換して file:// URL を作る
set "HTML=%~dp0todo.html"
set "HTML=%HTML:\=/%"
start "" "%EDGE%" "--app=file:///%HTML%" --window-size=380,270
