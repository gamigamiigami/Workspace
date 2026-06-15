# server.ps1
# Windows標準のPowerShellだけで動く、超軽量ローカルWebサーバー。
# 追加インストール一切不要（Python・Node不要）。start-windows.bat から呼ばれる。
# このフォルダの中身を http://localhost:8000 で配信し、ブラウザを自動で開く。

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 8000

# MIMEタイプ（.wasm や .data も正しく返す必要がある）
$mime = @{
  ".html"="text/html; charset=utf-8"; ".js"="text/javascript"; ".css"="text/css";
  ".png"="image/png"; ".jpg"="image/jpeg"; ".jpeg"="image/jpeg"; ".gif"="image/gif";
  ".mp3"="audio/mpeg"; ".wav"="audio/wav"; ".json"="application/json";
  ".wasm"="application/wasm"; ".data"="application/octet-stream";
  ".tflite"="application/octet-stream"; ".binarypb"="application/octet-stream";
  ".ico"="image/x-icon";
}

# TcpListener を使う（管理者権限なしで使える）
$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $port)
try { $listener.Start() }
catch {
  Write-Host "ポート $port を使えませんでした。別のアプリが使用中かもしれません。" -ForegroundColor Red
  Read-Host "Enterキーで終了"; exit 1
}

Write-Host ""
Write-Host "  2-4's TOY WORLD サーバー起動中" -ForegroundColor Green
Write-Host "  ブラウザで http://localhost:$port を開きます…" -ForegroundColor Green
Write-Host "  終了するには、この黒い画面を閉じてください。" -ForegroundColor Yellow
Write-Host ""

# 既定のブラウザでゲームを開く
Start-Process "http://localhost:$port/index.html"

while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $stream = $client.GetStream()
    $reader = New-Object System.IO.StreamReader($stream)
    $requestLine = $reader.ReadLine()
    if (-not $requestLine) { $client.Close(); continue }

    # "GET /path HTTP/1.1" から path を取り出す
    $parts = $requestLine.Split(" ")
    $url = $parts[1]
    $url = $url.Split("?")[0]
    if ($url -eq "/") { $url = "/index.html" }
    $url = [System.Uri]::UnescapeDataString($url)

    # フォルダ外アクセスを防ぐ
    $relative = $url.TrimStart("/")
    $filePath = Join-Path $root $relative
    $fullRoot = (Resolve-Path $root).Path

    $body = $null; $status = "200 OK"; $ctype = "application/octet-stream"
    if ((Test-Path $filePath) -and ((Resolve-Path $filePath).Path.StartsWith($fullRoot))) {
      $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
      if ($mime.ContainsKey($ext)) { $ctype = $mime[$ext] }
      $body = [System.IO.File]::ReadAllBytes($filePath)
    } else {
      $status = "404 Not Found"; $ctype = "text/plain"
      $body = [System.Text.Encoding]::UTF8.GetBytes("404")
    }

    $header = "HTTP/1.1 $status`r`nContent-Type: $ctype`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
    $stream.Write($headerBytes, 0, $headerBytes.Length)
    $stream.Write($body, 0, $body.Length)
    $stream.Flush()
  } catch {
    # 1リクエストの失敗は無視して継続
  } finally {
    $client.Close()
  }
}
