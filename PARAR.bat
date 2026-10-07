@echo off
setlocal
set "SUPPLY_VISION_PARADA_RAIZ=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$r=$env:SUPPLY_VISION_PARADA_RAIZ; . (Join-Path $r 'scripts\operacao-logica.ps1'); $d=Join-Path (Obter-PastaPrivada $r) 'operacao'; New-Item -ItemType Directory -Force $d|Out-Null; New-Item -ItemType File -Force (Join-Path $d 'parar.sinal')|Out-Null"
echo Solicitacao de encerramento enviada.
ping -n 4 127.0.0.1 >nul