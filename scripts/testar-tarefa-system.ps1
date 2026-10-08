# Integracao real Windows/SYSTEM, apenas em pasta e tarefa ficticias.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
. (Join-Path $PSScriptRoot 'inicializacao-logica.ps1')
if(!(Testar-Elevacao)){throw 'O teste SYSTEM exige runner elevado.'}
if(Get-ScheduledTask -TaskName 'Supply Vision' -TaskPath '\' -ErrorAction SilentlyContinue){throw 'Teste recusa alterar tarefa preexistente.'}
$pasta=Join-Path ([IO.Path]::GetTempPath()) ('sv-tarefa-'+[guid]::NewGuid().ToString('N'))
$privado=Join-Path $pasta 'dados-ficticios';$startup=Join-Path $pasta 'startup.cmd'
$criou=$false
try{
 New-Item -ItemType Directory -Force (Join-Path $pasta 'scripts'),(Join-Path $privado 'portal\configuracao'),(Join-Path $privado 'operacao')|Out-Null
 [IO.File]::WriteAllText((Join-Path $privado 'portal\configuracao\portal.env'),'BACKUP_NETWORK_DIR=\\servidor\pasta')
 Set-Content -LiteralPath $startup -Value 'atalho ficticio'
 $falso=@'
param([switch]$SemLogin,[string]$NodeExecutavel,[string]$PastaPrivada)
$ErrorActionPreference='Stop'
$op=Join-Path $PastaPrivada 'operacao'
$env:SUPPLY_VISION_SEM_LOGIN='1'
. (Join-Path $PSScriptRoot 'notificacao.ps1')
function Log([string]$Texto){Add-Content (Join-Path $op 'supervisor.log') $Texto}
$toast=Notificar 'teste' 'teste'
$trava=[IO.File]::Open((Join-Path $op 'supervisor.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
try{
 @{pid=$PID;inicio=(Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o')}|ConvertTo-Json|Set-Content (Join-Path $op 'supervisor.pid.json')
 Add-Content (Join-Path $op 'inicios') $PID
 @{pid=$PID;toast=$toast;conta=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;semLogin=[bool]$SemLogin;node=$NodeExecutavel}|ConvertTo-Json|Set-Content (Join-Path $op 'status.tmp')
 Move-Item (Join-Path $op 'status.tmp') (Join-Path $op 'status.json') -Force
 while(!(Test-Path (Join-Path $op 'parar.sinal'))){Start-Sleep -Milliseconds 100}
 Set-Content (Join-Path $op 'parou') 'ok'
}finally{Remove-Item (Join-Path $op 'supervisor.pid.json') -Force -ErrorAction SilentlyContinue;$trava.Dispose()}
'@
 [IO.File]::WriteAllText((Join-Path $pasta 'scripts\supervisor.ps1'),$falso)
 Copy-Item (Join-Path $PSScriptRoot 'notificacao.ps1') (Join-Path $pasta 'scripts\notificacao.ps1')
 $node=(Get-Command node.exe).Source
 # Mesma ativacao usada pela central, com diretorios exclusivamente ficticios.
 $criou=$true
 Definir-ModoInicializacao $pasta $privado $startup 'computador' $node
 if(Test-Path $startup){throw 'Ativacao manteve atalho de login.'}
 Iniciar-OperacaoConfigurada $pasta
 $status=Join-Path $privado 'operacao\status.json'
 for($i=0;$i-lt100-and!(Test-Path $status);$i++){Start-Sleep -Milliseconds 200}
 if(!(Test-Path $status)){throw 'SYSTEM nao gravou status.'}
 $st=Get-Content $status -Raw|ConvertFrom-Json
 if($st.toast-or!(Get-Content (Join-Path $privado 'operacao\supervisor.log') -Raw).Contains('sem sessao interativa')){throw 'Notificacao SYSTEM nao foi suprimida e registrada.'}
 if($st.conta-ne'S-1-5-18'-or!$st.semLogin){throw 'Supervisor nao executou como SYSTEM sem login.'}
 # O runner precisa ler e escrever os arquivos deixados pela SYSTEM.
 Set-Content (Join-Path $privado 'operacao\central-escreveu') 'ok'
 if(Testar-SupervisorEncerrado $privado){throw 'Trava SYSTEM nao foi observada pelo runner.'}
 Iniciar-OperacaoConfigurada $pasta # IgnoreNew evita outra instancia.
 Start-Sleep -Milliseconds 500
 if(@(Get-Content (Join-Path $privado 'operacao\inicios')).Count-ne1){throw 'Duas instancias foram iniciadas.'}
 New-Item -ItemType File -Force (Join-Path $privado 'operacao\parar.sinal')|Out-Null
 for($i=0;$i-lt100;$i++){if((Testar-SupervisorEncerrado $privado)-and((Get-ScheduledTask -TaskName 'Supply Vision').State-ne'Running')){break};Start-Sleep -Milliseconds 200}
 if(!(Test-Path (Join-Path $privado 'operacao\parou'))-or!(Testar-SupervisorEncerrado $privado)){throw 'Supervisor nao respondeu ao sinal.'}
 # Simula a janela de atualizacao: desabilitar durante parada e retomar a tarefa.
 Disable-ScheduledTask -TaskName 'Supply Vision' -TaskPath '\'|Out-Null
 Remove-Item $status,(Join-Path $privado 'operacao\parar.sinal'),(Join-Path $privado 'operacao\parou') -Force
 Enable-ScheduledTask -TaskName 'Supply Vision' -TaskPath '\'|Out-Null
 Iniciar-OperacaoConfigurada $pasta
 for($i=0;$i-lt100-and!(Test-Path $status);$i++){Start-Sleep -Milliseconds 200}
 if(!(Test-Path $status)-or@(Get-Content (Join-Path $privado 'operacao\inicios')).Count-ne2){throw 'Tarefa nao retomou apos a atualizacao.'}
 New-Item -ItemType File -Force (Join-Path $privado 'operacao\parar.sinal')|Out-Null
 for($i=0;$i-lt100;$i++){if((Testar-SupervisorEncerrado $privado)-and((Get-ScheduledTask -TaskName 'Supply Vision').State-ne'Running')){break};Start-Sleep -Milliseconds 200}
 if(!(Testar-SupervisorEncerrado $privado)){throw 'Supervisor retomado nao encerrou.'}
 Definir-ModoInicializacao $pasta $privado $startup 'login'
 if(!(Test-Path $startup)-or(Get-ScheduledTask -TaskName 'Supply Vision' -ErrorAction SilentlyContinue)){throw 'Modo login nao excluiu tarefa.'}
 Definir-ModoInicializacao $pasta $privado $startup 'desligado'
 if(Test-Path $startup){throw 'Modo desligado manteve atalho.'}
 Write-Host 'Tarefa SYSTEM real: inicio, status, ACL, instancia unica, parada e exclusao aprovados.'
}finally{
 if($criou){Stop-ScheduledTask -TaskName 'Supply Vision' -ErrorAction SilentlyContinue;Unregister-ScheduledTask -TaskName 'Supply Vision' -Confirm:$false -ErrorAction SilentlyContinue}
 if(Test-Path $pasta){for($i=0;$i-lt20;$i++){try{Remove-Item -LiteralPath $pasta -Recurse -Force -ErrorAction Stop;break}catch{Start-Sleep -Milliseconds 200}}}
}
