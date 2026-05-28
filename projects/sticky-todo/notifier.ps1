Add-Type -AssemblyName System.Windows.Forms

$http = [System.Net.HttpListener]::new()
$http.Prefixes.Add('http://localhost:48766/')
try { $http.Start() } catch { exit 0 }

while ($http.IsListening) {
    try {
        $ctx = $http.GetContext()
        if ($ctx.Request.IsWebSocketRequest) {
            $wsCtx = $ctx.AcceptWebSocketAsync('').Result
            $ws    = $wsCtx.WebSocket
            $buf   = [byte[]]::new(4096)
            $r     = $ws.ReceiveAsync([ArraySegment[byte]]$buf, [Threading.CancellationToken]::None).Result
            $msg   = [Text.Encoding]::UTF8.GetString($buf, 0, $r.Count)

            # DefaultDesktopOnly = 全ウィンドウ最前面・フォーカス強制
            [System.Windows.Forms.MessageBox]::Show(
                $msg, 'ToDo丸 リマインド',
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Exclamation,
                [System.Windows.Forms.MessageBoxDefaultButton]::Button1,
                [System.Windows.Forms.MessageBoxOptions]::DefaultDesktopOnly
            ) | Out-Null

            $ws.CloseAsync(
                [System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure,
                '', [Threading.CancellationToken]::None
            ).Wait()
        } else {
            $ctx.Response.StatusCode = 200
            $ctx.Response.Close()
        }
    } catch {}
}
