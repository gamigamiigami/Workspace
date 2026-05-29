@echo off
echo === notifier visible test ===
echo If errors appear below, that is the root cause.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0notifier.ps1"
echo.
echo notifier exited. Press any key.
pause
