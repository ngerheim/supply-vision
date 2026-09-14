@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$d='%~dp0privado\operacao'; New-Item -ItemType Directory -Force $d|Out-Null; New-Item -ItemType File -Force (Join-Path $d 'parar.sinal')|Out-Null"
echo Solicitacao de encerramento enviada.
ping -n 4 127.0.0.1 >nul