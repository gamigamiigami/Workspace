@echo off
rem ===== ToDo丸 起動スクリプト =====
rem 日本語フォルダ名に対応するためPowerShellでURLエンコードして起動

set "HTMLFILE=%~dp0todo.html"
set "NOTIFIER=%~dp0notifier.ps1"
set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

rem 通知サービスを起動（全ウィンドウ最前面MessageBox）
powershell -NoProfile -Command "Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',$env:NOTIFIER -WindowStyle Hidden"

rem ToDo丸を起動
powershell -NoProfile -Command "& { $u = ([uri]$env:HTMLFILE).AbsoluteUri; Start-Process $env:EDGE \"--app=$u --window-size=380,270\" }"
