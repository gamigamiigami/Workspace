$edges = @(
    "C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
)
$edge = $edges | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { exit 1 }

$html = Join-Path $PSScriptRoot "todo.html"
$url  = "file:///" + [uri]::EscapeUriString($html.Replace("\", "/"))
Start-Process $edge -ArgumentList "--app=$url", "--window-size=380,270"
