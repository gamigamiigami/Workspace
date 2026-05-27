@echo off
rem ===== ToDo丸 起動スクリプト =====
rem 日本語フォルダ名に対応するためPowerShellでURLエンコードして起動

set "HTMLFILE=%~dp0todo.html"
set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

powershell -NoProfile -Command "& { $u = ([uri]$env:HTMLFILE).AbsoluteUri; Start-Process $env:EDGE \"--app=$u --window-size=380,270\" }"
