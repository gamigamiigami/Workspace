@echo off
echo === notifier diagnostic ===
echo.
echo [1] Port 48766 check...
netstat -ano | findstr :48766
if %ERRORLEVEL% EQU 0 (echo    IN USE) else (echo    FREE)
echo.
echo [2] Component test...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try{Add-Type -AssemblyName System.Windows.Forms;Write-Host 'Forms:OK'}catch{Write-Host 'Forms:FAIL' $_};try{$h=[System.Net.HttpListener]::new();$h.Prefixes.Add('http://localhost:48766/');$h.Start();Write-Host 'HTTP:OK';$h.Stop()}catch{Write-Host 'HTTP:FAIL' $_}"
echo.
echo [3] MessageBox test...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.MessageBox]::Show('test OK','test',[System.Windows.Forms.MessageBoxButtons]::OK,[System.Windows.Forms.MessageBoxIcon]::Information,[System.Windows.Forms.MessageBoxDefaultButton]::Button1,[System.Windows.Forms.MessageBoxOptions]::DefaultDesktopOnly)"
echo    MessageBox closed.
echo.
echo === done ===
pause
