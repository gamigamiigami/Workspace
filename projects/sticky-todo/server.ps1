param([string]$Dir = $PSScriptRoot, [int]$Port = 48765)

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")

try {
    $listener.Start()
} catch {
    # すでに起動済みなら何もしない
    exit 0
}

while ($listener.IsListening) {
    try {
        $ctx  = $listener.GetContext()
        $path = $ctx.Request.Url.LocalPath.TrimStart('/')
        if ($path -eq '') { $path = 'todo.html' }
        $file = Join-Path $Dir $path

        if (Test-Path $file -PathType Leaf) {
            $bytes = [System.IO.File]::ReadAllBytes($file)
            $ext   = [System.IO.Path]::GetExtension($file).ToLower()
            $ctx.Response.ContentType = switch ($ext) {
                '.html' { 'text/html; charset=utf-8' }
                '.js'   { 'application/javascript' }
                '.css'  { 'text/css' }
                default { 'application/octet-stream' }
            }
            $ctx.Response.ContentLength64 = $bytes.Length
            $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $ctx.Response.StatusCode = 404
        }
        $ctx.Response.Close()
    } catch { break }
}
