@echo off
setlocal
rem O caminho vai por variavel de ambiente e e citado com [char]34 dentro do
rem PowerShell. Aspas literais aqui quebrariam a string do cmd, e sem aspas
rem o Start-Process parte o caminho no primeiro espaco.
set "SV_SUPERVISOR=%~dp0scripts\supervisor.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ". (Join-Path (Split-Path $env:SV_SUPERVISOR) 'operacao-logica.ps1'); . (Join-Path (Split-Path $env:SV_SUPERVISOR) 'inicializacao-logica.ps1'); $r=Split-Path (Split-Path $env:SV_SUPERVISOR); try{Exigir-InstalacaoNaoMigrada (Obter-PastaPrivada $r)}catch{Write-Host $_.Exception.Message; exit 1}; if(Obter-TarefaSupplyVision $r){Start-ScheduledTask -TaskName 'Supply Vision' -TaskPath ([char]92)}else{Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',([char]34+$env:SV_SUPERVISOR+[char]34))}"
ping -n 3 127.0.0.1 >nul
