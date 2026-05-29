Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32 {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
    [DllImport("user32.dll", CharSet=CharSet.Auto)]
    public static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
}
"@

function Invoke-BringToFront {
    try {
        Get-Process msedge -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | ForEach-Object {
            $sb = [System.Text.StringBuilder]::new(256)
            [Win32]::GetWindowText($_.MainWindowHandle, $sb, 256) | Out-Null
            if ($sb.ToString() -match 'ToDo') {
                [Win32]::ShowWindow($_.MainWindowHandle, 9) | Out-Null
                [Win32]::SetForegroundWindow($_.MainWindowHandle) | Out-Null
            }
        }
    } catch {}
}

$http = [System.Net.HttpListener]::new()
$http.Prefixes.Add('http://localhost:48766/')
try { $http.Start() } catch { exit 0 }

$script:tasks    = @()
$script:firedIds = @{}

function Build-Msg($t, $dueTime) {
    $m = "Remind: " + $t.title
    if ($t.dueDateTime) { $m += " / Due:" + $dueTime.Month + "/" + $dueTime.Day + " " + $dueTime.Hour + ":" + $dueTime.Minute.ToString('00') }
    if ($t.submitTo)    { $m += " / To:" + $t.submitTo }
    return $m
}

function Test-AndFireReminders {
    $now   = [DateTime]::Now
    $epoch = [DateTime]::new(1970, 1, 1, 0, 0, 0, [DateTimeKind]::Utc)
    foreach ($t in $script:tasks) {
        try {
            if (-not $t.dueDateTime -or -not "$($t.reminder)") { continue }
            $dueTime  = [DateTime]::Parse($t.dueDateTime)
            $remindAt = $dueTime.AddMinutes(-[int]"$($t.reminder)")
            $lastMs   = if ($t.lastReminded) { [long]"$($t.lastReminded)" } else { 0L }
            $lastDate = if ($lastMs -gt 0) { $epoch.AddMilliseconds($lastMs).ToLocalTime() } else { [DateTime]::MinValue }
            $key      = "$($t.id)_$($remindAt.ToString('yyyy-MM-ddTHH:mm'))"
            if ($now -ge $remindAt -and $lastDate -lt $remindAt -and -not $script:firedIds.ContainsKey($key)) {
                $script:firedIds[$key] = $true
                $msg  = Build-Msg $t $dueTime
                $icon = if ("$($t.reminderType)" -eq 'message') { [System.Windows.Forms.MessageBoxIcon]::Information } else { [System.Windows.Forms.MessageBoxIcon]::Exclamation }
                Invoke-BringToFront
                [System.Windows.Forms.MessageBox]::Show($msg, 'ToDo Remind', [System.Windows.Forms.MessageBoxButtons]::OK, $icon, [System.Windows.Forms.MessageBoxDefaultButton]::Button1, [System.Windows.Forms.MessageBoxOptions]::DefaultDesktopOnly) | Out-Null
            }
        } catch {}
    }
}

function Get-FiredJson {
    if ($script:firedIds.Count -eq 0) { return '{}' }
    $pairs = $script:firedIds.Keys | ForEach-Object { '"' + $_ + '":true' }
    return '{' + ($pairs -join ',') + '}'
}

$lastCheck = [DateTime]::MinValue

while ($http.IsListening) {
    try {
        $getCtx     = $http.GetContextAsync()
        $gotRequest = $getCtx.Wait(10000)

        $now = [DateTime]::Now
        if (($now - $lastCheck).TotalSeconds -ge 30) {
            $lastCheck = $now
            Test-AndFireReminders
        }

        if (-not $gotRequest) { continue }

        $ctx = $getCtx.Result
        $ctx.Response.Headers.Add('Access-Control-Allow-Origin', '*')
        $ctx.Response.Headers.Add('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        $ctx.Response.Headers.Add('Access-Control-Allow-Headers', 'Content-Type')

        if ($ctx.Request.HttpMethod -eq 'OPTIONS') {
            $ctx.Response.StatusCode = 200
            $ctx.Response.Close()
            continue
        }

        if ($ctx.Request.IsWebSocketRequest) {
            $wsCtx = $ctx.AcceptWebSocketAsync('').Result
            $ws    = $wsCtx.WebSocket
            $buf   = [byte[]]::new(4096)
            $r     = $ws.ReceiveAsync([ArraySegment[byte]]$buf, [Threading.CancellationToken]::None).Result
            $raw   = [Text.Encoding]::UTF8.GetString($buf, 0, $r.Count)
            $displayMsg = $raw
            $wsIcon     = [System.Windows.Forms.MessageBoxIcon]::Exclamation
            try {
                $data = $raw | ConvertFrom-Json
                if ($data.key)  { $script:firedIds[$data.key] = $true }
                if ($data.msg)  { $displayMsg = $data.msg }
                if ($data.type -eq 'message') { $wsIcon = [System.Windows.Forms.MessageBoxIcon]::Information }
            } catch {}
            Invoke-BringToFront
            [System.Windows.Forms.MessageBox]::Show($displayMsg, 'ToDo Remind', [System.Windows.Forms.MessageBoxButtons]::OK, $wsIcon, [System.Windows.Forms.MessageBoxDefaultButton]::Button1, [System.Windows.Forms.MessageBoxOptions]::DefaultDesktopOnly) | Out-Null
            $ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, '', [Threading.CancellationToken]::None).Wait()

        } elseif ($ctx.Request.HttpMethod -eq 'POST' -and $ctx.Request.Url.AbsolutePath -eq '/tasks') {
            $reader = [System.IO.StreamReader]::new($ctx.Request.InputStream, [Text.Encoding]::UTF8)
            $json   = $reader.ReadToEnd()
            $reader.Close()
            try { $script:tasks = @($json | ConvertFrom-Json); Test-AndFireReminders } catch {}
            $ctx.Response.StatusCode = 200
            $ctx.Response.Close()

        } elseif ($ctx.Request.HttpMethod -eq 'GET' -and $ctx.Request.Url.AbsolutePath -eq '/fired') {
            $bytes = [Text.Encoding]::UTF8.GetBytes((Get-FiredJson))
            $ctx.Response.ContentType = 'application/json'
            $ctx.Response.ContentLength64 = $bytes.Length
            $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
            $ctx.Response.Close()

        } else {
            $ctx.Response.StatusCode = 200
            $ctx.Response.Close()
        }
    } catch {}
}
