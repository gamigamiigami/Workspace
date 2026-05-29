@echo off
set "HTMLFILE=%~dp0todo.html"
set "NOTIFIER=%~dp0notifier.ps1"

start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%NOTIFIER%"

powershell -NoProfile -Command "& { $u = ([uri]'%HTMLFILE%').AbsoluteUri; $e = @('C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe','C:\Program Files\Microsoft\Edge\Application\msedge.exe') | Where-Object { Test-Path $_ } | Select-Object -First 1; if (-not $e) { $e = (Get-Command msedge -ErrorAction SilentlyContinue).Source }; if ($e) { Start-Process $e \"--app=$u --window-size=380,270\" } else { Start-Process $u } }"
