@echo off
rem ====================================================================
rem  2-4's TOY WORLD (Web) かんたん起動ツール（Windows用）
rem  これをダブルクリックするだけでゲームが始まります。
rem  Python も Node も不要。Windows標準のPowerShellだけで動きます。
rem ====================================================================
title 2-4's TOY WORLD サーバー
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
pause
