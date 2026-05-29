@echo off
set "NOTIFIER=%~dp0notifier.ps1"
echo notifier.ps1 を表示モードで起動します...
echo エラーがあればここに表示されます。
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%NOTIFIER%"
echo.
echo 終了しました。
pause
