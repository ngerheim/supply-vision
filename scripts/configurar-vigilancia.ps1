[CmdletBinding()]
param([switch]$Desligar,[pscredential]$CredencialTarefa)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'inicializacao-logica.ps1')
if(!(Testar-Elevacao)){throw 'Execute como administrador para configurar a vigilancia.'}
$nome='Supply Vision Vigilancia'
if($Desligar){Unregister-ScheduledTask -TaskName $nome -Confirm:$false -ErrorAction SilentlyContinue;return}
if(!$CredencialTarefa){$CredencialTarefa=Get-Credential -Message 'Conta do dono que executara a vigilancia';if(!$CredencialTarefa){throw 'Conta nao informada.'}}
if(!(Testar-ContaAdministradora $CredencialTarefa.UserName)){throw 'A vigilancia exige a conta administradora do dono.'}
$exe="$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$script=Join-Path $PSScriptRoot 'vigiar-operacao.ps1'
$acao=New-ScheduledTaskAction -Execute $exe -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$script+'"') -WorkingDirectory (Split-Path $PSScriptRoot)
$gatilho=New-ScheduledTaskTrigger -Daily -At '09:00'
$ajustes=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -MultipleInstances IgnoreNew -StartWhenAvailable
try{
 $senha=$CredencialTarefa.GetNetworkCredential().Password
 Register-ScheduledTask -TaskName $nome -Action $acao -Trigger $gatilho -User $CredencialTarefa.UserName -Password $senha -RunLevel Highest -Settings $ajustes -Force|Out-Null
}finally{$senha=$null}
Write-Host 'Vigilancia diaria ativada. Usa SMTP comum e respeita o modo ensaio.'
