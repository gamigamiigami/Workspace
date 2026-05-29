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
    [DllImport("user32.dll", CharSet=CharSet.Unicode)]
    public static extern int MessageBox(IntPtr hWnd, string text, string caption, uint type);
}
"@

$logFile = "$env:TEMP\todo-remind.log"
function Write-Log($msg) {
    $line = "$(Get-Date -Format 'HH:mm:ss') $msg"
    Write-Host $line
    try { Add-Content $logFile $line } catch { Write-Host "  [log-write-fail] $_" }
}

function Show-MsgBox($msg, $isMessage) {
    $icon = if ($isMessage) { [System.Windows.Forms.MessageBoxIcon]::Information } else { [System.Windows.Forms.MessageBoxIcon]::Exclamation }
    $owner = New-Object System.Windows.Forms.Form
    $owner.TopMost = $true
    $owner.Width = 1; $owner.Height = 1
    $owner.ShowInTaskbar = $false
    $owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
    $owner.Show()
    $owner.Activate()
    [System.Windows.Forms.MessageBox]::Show($owner, $msg, 'ToDo Remind',
        [System.Windows.Forms.MessageBoxButtons]::OK, $icon) | Out-Null
    $owner.Close()
    $owner.Dispose()
}

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
try { $http.Start(); Write-Log "notifier started (PS $($PSVersionTable.PSVersion) OS $([System.Environment]::OSVersion.Version))" } catch { Write-Log "start failed: $_"; exit 0 }

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
    Write-Log "timer check: $($script:tasks.Count) tasks"
    foreach ($t in $script:tasks) {
        try {
            if (-not $t.dueDateTime -or -not "$($t.reminder)") { continue }
            Write-Log "  raw dueDateTime='$($t.dueDateTime)' type=$($t.dueDateTime.GetType().Name) reminder='$($t.reminder)'"
            $ic = [System.Globalization.CultureInfo]::InvariantCulture
            $dueTime = $null
            foreach ($fmt in @('yyyy-MM-ddTHH:mm','yyyy-MM-ddTHH:mm:ss','yyyy/MM/dd HH:mm','M/d/yyyy h:mm tt')) {
                try { $dueTime = [DateTime]::ParseExact("$($t.dueDateTime)", $fmt, $ic); break } catch {}
            }
            if (-not $dueTime) {
                try { $dueTime = [DateTime]::Parse("$($t.dueDateTime)", $ic) } catch {}
            }
            if (-not $dueTime) { Write-Log "  CANNOT parse dueDateTime, skipping"; continue }
            Write-Log "  parsed dueTime=$dueTime"
            $remindAt = $dueTime.AddMinutes(-[int]"$($t.reminder)")
            $lastMs   = if ($t.lastReminded) { [long]"$($t.lastReminded)" } else { 0L }
            $lastDate = if ($lastMs -gt 0) { $epoch.AddMilliseconds($lastMs).ToLocalTime() } else { [DateTime]::MinValue }
            $key      = "$($t.id)_$($remindAt.ToString('yyyy-MM-ddTHH:mm'))"
            Write-Log "  task=$($t.id) remindAt=$remindAt lastDate=$lastDate now=$now fired=$($script:firedIds.ContainsKey($key))"
            if ($now -ge $remindAt -and $lastDate -lt $remindAt -and -not $script:firedIds.ContainsKey($key)) {
                $script:firedIds[$key] = $true
                Write-Log "  FIRING reminder for $($t.id)"
                $msg = Build-Msg $t $dueTime
                Invoke-BringToFront
                Show-MsgBox $msg ("$($t.reminderType)" -eq 'message')
            }
        } catch { Write-Log "  error: $_" }
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
        $ar         = $http.BeginGetContext($null, $null)
        $gotRequest = $ar.AsyncWaitHandle.WaitOne(10000)

        $now = [DateTime]::Now
        if (($now - $lastCheck).TotalSeconds -ge 30) {
            $lastCheck = $now
            Test-AndFireReminders
        }

        if (-not $gotRequest) { continue }

        $ctx = $http.EndGetContext($ar)
        $ctx.Response.Headers.Add('Access-Control-Allow-Origin', '*')
        $ctx.Response.Headers.Add('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        $ctx.Response.Headers.Add('Access-Control-Allow-Headers', 'Content-Type')

        if ($ctx.Request.HttpMethod -eq 'OPTIONS') {
            $ctx.Response.StatusCode = 200
            $ctx.Response.Close()
            continue
        }

        if ($ctx.Request.IsWebSocketRequest) {
            Write-Log "WebSocket request received"
            $wsCtx = $ctx.AcceptWebSocketAsync($null).Result
            $ws    = $wsCtx.WebSocket
            $buf   = [byte[]]::new(4096)
            $r     = $ws.ReceiveAsync([ArraySegment[byte]]$buf, [Threading.CancellationToken]::None).Result
            $raw   = [Text.Encoding]::UTF8.GetString($buf, 0, $r.Count)
            Write-Log "WebSocket data ($($r.Count) bytes): $($raw.Substring(0, [Math]::Min(200, $raw.Length)))"
            $displayMsg = $raw
            $isMsg = $false
            try {
                $data = $raw | ConvertFrom-Json
                if ($data.key)  { $script:firedIds[$data.key] = $true }
                if ($data.msg)  { $displayMsg = $data.msg }
                if ($data.type -eq 'message') { $isMsg = $true }
            } catch { Write-Log "WebSocket JSON parse failed" }
            Invoke-BringToFront
            Write-Log "Showing MessageBox..."
            Show-MsgBox $displayMsg $isMsg
            Write-Log "MessageBox closed"
            $ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, '', [Threading.CancellationToken]::None).Wait()

        } elseif ($ctx.Request.HttpMethod -eq 'POST' -and $ctx.Request.Url.AbsolutePath -eq '/tasks') {
            $reader = [System.IO.StreamReader]::new($ctx.Request.InputStream, [Text.Encoding]::UTF8)
            $json   = $reader.ReadToEnd()
            $reader.Close()
            try {
                $parsed = $json | ConvertFrom-Json
                $script:tasks = if ($parsed -is [System.Array]) { $parsed } else { @($parsed) }
                Write-Log "tasks updated: $($script:tasks.Count) json=$($json.Substring(0,[Math]::Min(200,$json.Length)))"
            } catch { Write-Log "tasks parse failed: $_" }
            $ctx.Response.StatusCode = 200
            $ctx.Response.Close()

        } elseif ($ctx.Request.HttpMethod -eq 'GET' -and $ctx.Request.Url.AbsolutePath -eq '/fired') {
            $bytes = [Text.Encoding]::UTF8.GetBytes((Get-FiredJson))
            $ctx.Response.ContentType = 'application/json'
            $ctx.Response.ContentLength64 = $bytes.Length
            $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
            $ctx.Response.Close()

        } else {
            Write-Log "unknown request: $($ctx.Request.HttpMethod) $($ctx.Request.Url.AbsolutePath)"
            $ctx.Response.StatusCode = 200
            $ctx.Response.Close()
        }
    } catch { Write-Log "loop error: $_" }
}
