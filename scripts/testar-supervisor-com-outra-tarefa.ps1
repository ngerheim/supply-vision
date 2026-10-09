# Integracao exclusiva do CI, nunca substitui tarefa de uma instalacao existente.
$ErrorActionPreference='Stop'
if($env:SV_TESTES_INTEGRACAO_WINDOWS-ne'1'){Write-Host 'SKIPPED: outra tarefa exige SV_TESTES_INTEGRACAO_WINDOWS=1 no CI.';return}
if(Get-ScheduledTask -TaskName 'Supply Vision' -TaskPath '\' -ErrorAction SilentlyContinue){throw 'Teste recusa alterar tarefa preexistente.'}
. (Join-Path $PSScriptRoot 'espera-testes.ps1')
$dir=Join-Path ([IO.Path]::GetTempPath()) ('sv-outra-instalacao-'+[guid]::NewGuid().ToString('N'))
$criou=$false;$anterior=$env:SUPPLY_VISION_PRIVADO
try{
 $privado=Join-Path $dir 'privado';$op=Join-Path $privado 'operacao'
 New-Item -ItemType Directory -Force $op|Out-Null
 $entrada=Join-Path $dir 'supervisor-ficticio.ps1'
 $codigo=@'
$ErrorActionPreference='Stop'
$op=Join-Path $PSScriptRoot 'privado\operacao'
$trava=[IO.File]::Open((Join-Path $op 'supervisor.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
try{
 Set-Content (Join-Path $op 'supervisor.log') 'Outra instalacao ficticia em execucao'
 while(!(Test-Path (Join-Path $op 'parar.sinal'))){Set-Content (Join-Path $op 'heartbeat.txt') ([datetime]::UtcNow.Ticks);Start-Sleep -Milliseconds 500}
}finally{$trava.Dispose()}
'@
 [IO.File]::WriteAllText($entrada,$codigo)
 & "$env:SystemRoot\System32\icacls.exe" $dir /grant '*S-1-5-18:(OI)(CI)F' /T /Q|Out-Null
 if($LASTEXITCODE){throw 'ACL da tarefa ficticia falhou'}
 $acao=New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument ('-NoProfile -ExecutionPolicy Bypass -File "'+$entrada+'"')
 $config=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([timespan]::Zero) -MultipleInstances IgnoreNew
 Register-ScheduledTask -TaskName 'Supply Vision' -Action $acao -Settings $config -User SYSTEM -RunLevel Highest|Out-Null
 $criou=$true;Start-ScheduledTask -TaskName 'Supply Vision'
 $heartbeat=Join-Path $op 'heartbeat.txt'
 if(!(Esperar-CondicaoTeste {Test-Path $heartbeat})){throw 'Outra instalacao nao iniciou'}
 $antes=Get-Content $heartbeat -Raw
 # Ambiente aponta deliberadamente a outra instalacao: filhos devem ignorar isso.
 $env:SUPPLY_VISION_PRIVADO=$privado
 & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'testar-supervisor-isolado.ps1') -Ensaio -AtrasoSegundaInstanciaSegundos 8
 if($LASTEXITCODE){throw 'Supervisor isolado falhou com outra tarefa ativa'}
 if((Get-ScheduledTask -TaskName 'Supply Vision').State-ne'Running'){throw 'Teste interrompeu tarefa da outra instalacao'}
 if(!(Esperar-CondicaoTeste {(Get-Content $heartbeat -Raw)-ne$antes})){throw 'Outra instalacao parou de progredir'}
 if((Get-Content (Join-Path $op 'supervisor.log') -Raw).Trim()-ne'Outra instalacao ficticia em execucao'){throw 'Teste escreveu no log da outra instalacao'}
 $bloqueou=$false
 try{$h=[IO.File]::Open((Join-Path $op 'supervisor.lock'),[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None);$h.Dispose()}catch [IO.IOException]{$bloqueou=$true}
 if(!$bloqueou){throw 'Trava da outra instalacao deixou de estar ativa'}
 Write-Host 'PASSOU: outra tarefa Supply Vision permaneceu ativa, com trava/log privados preservados e concorrente atrasado 8 s.'
}finally{
 $env:SUPPLY_VISION_PRIVADO=$anterior
 if($criou){
  Stop-ScheduledTask -TaskName 'Supply Vision' -ErrorAction SilentlyContinue
  [void](Esperar-CondicaoTeste {(Get-ScheduledTask -TaskName 'Supply Vision' -ErrorAction SilentlyContinue).State-ne'Running'})
  Unregister-ScheduledTask -TaskName 'Supply Vision' -Confirm:$false -ErrorAction SilentlyContinue
 }
 if(Test-Path $dir){if(!(Esperar-CondicaoTeste {try{Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction Stop;$true}catch{$false}})){throw 'Nao foi possivel limpar a instalacao ficticia.'}}
}
$global:LASTEXITCODE=0
