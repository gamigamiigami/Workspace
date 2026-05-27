@echo off
setlocal EnableDelayedExpansion

rem ===== 先生のTodoメモ 起動スクリプト =====
rem このファイルをダブルクリックすると Microsoft Edge でアプリが開きます

set "HTMLPATH=%~dp0todo.html"
set "HTMLPATH=!HTMLPATH:\=/!"

start "" msedge "--app=file:///!HTMLPATH!" --window-size=1280,820

endlocal
