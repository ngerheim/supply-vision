[CmdletBinding()]
param([switch]$Desligar)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'inicializacao-logica.ps1')
if(!(Testar-Elevacao)){throw 'Execute como administrador para configurar a vigilancia.'}
$nome='Supply Vision Vigilancia'
if($Desligar){Unregister-ScheduledTask -TaskName $nome -Confirm:$false -ErrorAction SilentlyContinue;return}
$exe="$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$script=Join-Path $PSScriptRoot 'vigiar-operacao.ps1'
$acao=New-ScheduledTaskAction -Execute $exe -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$script+'"') -WorkingDirectory (Split-Path $PSScriptRoot)
$gatilho=New-ScheduledTaskTrigger -Daily -At '09:00'
$principal=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$ajustes=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -MultipleInstances IgnoreNew -StartWhenAvailable
Register-ScheduledTask -TaskName $nome -Action $acao -Trigger $gatilho -Principal $principal -Settings $ajustes -Force|Out-Null
Write-Host 'Vigilancia diaria ativada. Usa SMTP comum e respeita o modo ensaio.'
