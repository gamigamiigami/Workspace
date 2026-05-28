@echo off
echo ===== ToDo丸 デバッグ =====
echo.

set "EDGE="
if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" (
  set "EDGE=C:\Program Files\Microsoft\Edge\Application\msedge.exe"
  echo [OK] Edge: Program Files に見つかりました
) else if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
  set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
  echo [OK] Edge: Program Files (x86) に見つかりました
) else (
  echo [NG] Edge: 見つかりません！
)

echo.
echo EDGE  = %EDGE%
echo HTML  = %~dp0todo.html
echo.

if not defined EDGE (
  echo Edgeが見つからないので終了します。
  pause
  exit /b 1
)

echo Edgeを起動します...
start "" "%EDGE%" --app="%~dp0todo.html" --window-size=380,270
echo 起動コマンド実行しました。
echo.
pause
