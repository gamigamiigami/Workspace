@echo off
setlocal EnableDelayedExpansion

rem ===== ToDo丸 起動スクリプト =====

set "HTMLPATH=%~dp0todo.html"
set "HTMLPATH=!HTMLPATH:\=/!"

start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" "--app=file:///!HTMLPATH!" --window-size=1280,820

endlocal
