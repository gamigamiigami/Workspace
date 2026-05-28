@echo off
set "HTMLFILE=%~dp0todo.html"
set "NOTIFIER=%~dp0notifier.ps1"
set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%NOTIFIER%"

powershell -NoProfile -Command "& { $u = ([uri]$env:HTMLFILE).AbsoluteUri; Start-Process $env:EDGE \"--app=$u --window-size=380,270\" }"
