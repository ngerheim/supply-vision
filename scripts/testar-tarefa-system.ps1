# Integracao real Windows/SYSTEM, apenas em pasta e tarefa ficticias.
$ErrorActionPreference='Stop'
if($env:SV_TESTES_INTEGRACAO_WINDOWS-ne'1'){Write-Host 'SKIPPED: tarefa SYSTEM exige SV_TESTES_INTEGRACAO_WINDOWS=1 no CI.';return}
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
. (Join-Path $PSScriptRoot 'inicializacao-logica.ps1')
if(!(Testar-Elevacao)){throw 'O teste SYSTEM exige runner elevado.'}
if(Get-ScheduledTask -TaskName 'Supply Vision' -TaskPath '\' -ErrorAction SilentlyContinue){throw 'Teste recusa alterar tarefa preexistente.'}
$pasta=Join-Path ([IO.Path]::GetTempPath()) ('sv-tarefa-'+[guid]::NewGuid().ToString('N'))
$privado=Join-Path $pasta 'dados-ficticios';$startup=Join-Path $pasta 'startup.cmd'
$criou=$false;$privadoAnterior=$env:SUPPLY_VISION_PRIVADO
# Executa as funcoes reais de parada/retomada sem executar o atualizador inteiro.
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'atualizar-servidor.ps1'),[ref]$null,[ref]$null)
foreach($nome in @('Parar-OperacaoAtualizacao','Iniciar-OperacaoAtualizada')){
 $funcao=$ast.Find({param($n) $n-is[System.Management.Automation.Language.FunctionDefinitionAst]-and$n.Name-eq$nome},$true)
 . ([scriptblock]::Create($funcao.Extent.Text))
}
function Get-NetTCPConnection {} # O supervisor ficticio nao abre portas.
$script:TarefaSemLogin=$true;$Raiz=$pasta;$env:SUPPLY_VISION_PRIVADO=$privado
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
 [IO.File]::WriteAllText((Join-Path $pasta 'PARAR.bat'),"@echo off`r`ntype nul > `"$(Join-Path $privado 'operacao\parar.sinal')`"`r`nexit /b 0`r`n",[Text.Encoding]::ASCII)
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
 Parar-OperacaoAtualizacao
 for($i=0;$i-lt100-and((Get-ScheduledTask -TaskName 'Supply Vision').State-eq'Running');$i++){Start-Sleep -Milliseconds 200}
 if(!(Test-Path (Join-Path $privado 'operacao\parou'))-or!(Testar-SupervisorEncerrado $privado)){throw 'Supervisor nao respondeu ao sinal.'}
 if((Get-ScheduledTask -TaskName 'Supply Vision').State-ne'Disabled'){throw 'Atualizador nao desabilitou a tarefa durante a parada.'}
 # Retomada real do atualizador no modo sem login.
 Remove-Item $status,(Join-Path $privado 'operacao\parar.sinal'),(Join-Path $privado 'operacao\parou') -Force
 Iniciar-OperacaoAtualizada
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
 $env:SUPPLY_VISION_PRIVADO=$privadoAnterior
 if($criou){Stop-ScheduledTask -TaskName 'Supply Vision' -ErrorAction SilentlyContinue;Unregister-ScheduledTask -TaskName 'Supply Vision' -Confirm:$false -ErrorAction SilentlyContinue}
 if(Test-Path $pasta){for($i=0;$i-lt20;$i++){try{Remove-Item -LiteralPath $pasta -Recurse -Force -ErrorAction Stop;break}catch{Start-Sleep -Milliseconds 200}}}
}
