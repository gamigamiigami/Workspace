@echo off
rem 結果をテキストファイルに書き出してメモ帳で開く

set "LOG=%~dp0debug-log.txt"

echo ===== ToDo debug ===== > "%LOG%"
echo %date% %time% >> "%LOG%"
echo. >> "%LOG%"

set "EDGE="
if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" (
  set "EDGE=C:\Program Files\Microsoft\Edge\Application\msedge.exe"
  echo EDGE: found in Program Files >> "%LOG%"
) else if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
  set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
  echo EDGE: found in Program Files x86 >> "%LOG%"
) else (
  echo EDGE: NOT FOUND >> "%LOG%"
)

echo EDGE_PATH=%EDGE% >> "%LOG%"
echo HTML_PATH=%~dp0todo.html >> "%LOG%"
echo. >> "%LOG%"

if not defined EDGE (
  echo RESULT: FAILED - Edge not found >> "%LOG%"
  notepad "%LOG%"
  exit /b 1
)

echo Launching Edge... >> "%LOG%"
start "" "%EDGE%" --app="%~dp0todo.html" --window-size=380,270
echo RESULT: launch command executed >> "%LOG%"

notepad "%LOG%"
