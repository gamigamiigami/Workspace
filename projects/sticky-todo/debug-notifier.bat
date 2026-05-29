@echo off
echo === notifier 診断 ===
echo.

echo [1] ポート 48766 の使用状況...
netstat -ano | findstr :48766
if %ERRORLEVEL% EQU 0 (
    echo    上記のプロセスがポートを使用中です
) else (
    echo    ポートは空いています
)
echo.

echo [2] 各パーツの動作確認...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "Write-Host '[チェック1] Windows.Forms...'; " ^
    "try { Add-Type -AssemblyName System.Windows.Forms; Write-Host '  OK' } catch { Write-Host '  NG:' $_ }; " ^
    "Write-Host '[チェック2] Win32クラス...'; " ^
    "try { Add-Type 'using System; using System.Runtime.InteropServices; using System.Text; public class Win32Diag { [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr h); }'; Write-Host '  OK' } catch { Write-Host '  NG:' $_ }; " ^
    "Write-Host '[チェック3] HTTPリスナー...'; " ^
    "try { $h=[System.Net.HttpListener]::new(); $h.Prefixes.Add('http://localhost:48766/'); $h.Start(); Write-Host '  OK（起動成功）'; $h.Stop() } catch { Write-Host '  NG:' $_ }"

echo.
echo === 診断終了 ===
pause
