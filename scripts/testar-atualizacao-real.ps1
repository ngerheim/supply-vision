# Integracao H2 sem mocks do atualizador, em instalacao Git descartavel.
[CmdletBinding()]
param([string]$BaseRef='origin/main',[string]$DestinoRef='HEAD',
 [ValidateRange(60,1800)][int]$LimiteSegundos=1200,
 [switch]$ExecutarCenario,[string]$PastaTeste)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'espera-testes.ps1')
. (Join-Path $PSScriptRoot 'atualizacao-preparo.ps1')
$fonte=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if($env:OS-ne'Windows_NT'-or$PSVersionTable.PSVersion.Major-ne5){throw 'Atualizacao real exige Windows PowerShell 5.1.'}
if($env:SV_TESTES_INTEGRACAO_WINDOWS-ne'1'){throw 'Atualizacao real exige SV_TESTES_INTEGRACAO_WINDOWS=1 e fixture descartavel.'}
if(!$ExecutarCenario){
 $PastaTeste=Join-Path ([IO.Path]::GetTempPath()) ('sv-h2-'+[guid]::NewGuid().ToString('N'))
 New-Item -ItemType Directory $PastaTeste|Out-Null
 $fase=Join-Path $PastaTeste 'fase.txt';$filho=$null
 try{
  $argumentos=@('-NoProfile','-ExecutionPolicy','Bypass','-File',$PSCommandPath,'-ExecutarCenario','-PastaTeste',$PastaTeste,'-BaseRef',$BaseRef,'-DestinoRef',$DestinoRef)
  $filho=Start-Process powershell.exe -ArgumentList (@($argumentos|ForEach-Object {Proteger-ArgumentoAtualizacao $_})-join' ') -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PastaTeste 'cenario.log') -RedirectStandardError (Join-Path $PastaTeste 'cenario-erro.log')
  if(!(Esperar-ProcessoTeste $filho $LimiteSegundos $fase)){
   Encerrar-ArvoreTeste $filho
   throw "Atualizacao real travou: excedeu $LimiteSegundos s; ultima fase=$(Get-Content $fase -Raw -ErrorAction SilentlyContinue); logs=$PastaTeste."
  }
  foreach($p in @('cenario.log','cenario-erro.log')){Get-Content (Join-Path $PastaTeste $p)|Write-Host}
  if(($null-ne$filho.ExitCode-and$filho.ExitCode-ne0)-or(Get-Content $fase -Raw)-ne'concluido'){throw "Atualizacao real reprovada; logs=$PastaTeste."}
 }finally{
  if($filho){if(!$filho.HasExited){Encerrar-ArvoreTeste $filho};$filho.Dispose()}
  # SYSTEM e um ramo separado da arvore: timeout tambem precisa remove-lo.
  $instalacao=Join-Path $PastaTeste 'instalacao'
  . (Join-Path $PSScriptRoot 'operacao-logica.ps1')
  . (Join-Path $PSScriptRoot 'inicializacao-logica.ps1')
  if(Obter-TarefaSupplyVision $instalacao){Disable-ScheduledTask -TaskName 'Supply Vision'|Out-Null}
  $privadoAntes=$env:SUPPLY_VISION_PRIVADO
  try{
   $env:SUPPLY_VISION_PRIVADO=Join-Path $instalacao 'privado'
   if(Test-Path $instalacao){[void](Parar-Operacao $instalacao 30)}
  }finally{$env:SUPPLY_VISION_PRIVADO=$privadoAntes}
  if(Obter-TarefaSupplyVision $instalacao){Stop-ScheduledTask -TaskName 'Supply Vision';Unregister-ScheduledTask -TaskName 'Supply Vision' -Confirm:$false}
 }
 return
}
# A entrada interna tambem recusa qualquer pasta que nao seja a fixture nova.
$baseTemp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
$pastaCompleta=[IO.Path]::GetFullPath($PastaTeste)
if(!$pastaCompleta.StartsWith($baseTemp,[StringComparison]::OrdinalIgnoreCase)-or(Split-Path $pastaCompleta -Leaf)-notmatch'^sv-h2-[0-9a-f]{32}$'-or!(Test-Path $pastaCompleta)-or((Get-Item $pastaCompleta -Force).Attributes-band[IO.FileAttributes]::ReparsePoint)){throw 'Cenario interno exige fixture H2 dentro de TEMP, sem links.'}
function Fase([string]$Nome){[IO.File]::WriteAllText((Join-Path $PastaTeste 'fase.txt'),$Nome);Write-Host "H2: $Nome"}
function Git-H2([string[]]$Argumentos){
 & git @Argumentos
 if($LASTEXITCODE){throw "Git falhou: $($Argumentos -join ' ')"}
}
function Node-H2([string[]]$Argumentos){
 & node.exe @Argumentos
 if($LASTEXITCODE){throw "Verificacao Node reprovou: $($Argumentos -join ' ')"}
}
function Obter-PidsConsumidoresH2 {
 $todos=@(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction Stop)
 $pidsConsumidores=@{}
 foreach($nome in @('emails','relatorios')){
  $arquivo=Join-Path $raiz ('portal/scripts/processar-'+$nome+'.mjs')
  $padrao='(?i)(?:^|[\s"''])'+[regex]::Escape($arquivo)+'(?:["'']|\s|$)'
  $encontrados=@($todos|Where-Object {$_.CommandLine-match$padrao})
  if($encontrados.Count-ne1){throw "Exige um consumidor real de $nome nesta instalacao; encontrados=$($encontrados.Count)."}
  $pidsConsumidores[$nome]=[int]$encontrados[0].ProcessId
 }
 return $pidsConsumidores
}
function Login-H2 {
 $corpo=@{email='admin@h2.test';password='senha-ficticia-h2-12345'}|ConvertTo-Json
 $r=Invoke-WebRequest 'http://127.0.0.1:3000/api/login' -Method POST -ContentType 'application/json' -Body $corpo -SessionVariable sessao -UseBasicParsing -TimeoutSec 15
 if($r.StatusCode-ne200){throw 'Login real reprovou.'}
 $b=Invoke-RestMethod 'http://127.0.0.1:3000/api/bootstrap' -WebSession $sessao -TimeoutSec 15
 if($b.user.role-ne'admin'){throw 'Sessao real nao autenticou administrador.'}
}
$raiz=Join-Path $PastaTeste 'instalacao';$remoto=Join-Path $PastaTeste 'remoto'
$apoio=Join-Path $fonte 'scripts/ci/atualizacao-real.mjs'
$privado=Join-Path $raiz 'privado';$tarefaCriada=$false
$processos=@();$privadoAntes=$env:SUPPLY_VISION_PRIVADO
try{
 Fase 'merge-base e remoto local'
 $destino=(Git-H2 -Argumentos @('-C',$fonte,'rev-parse','--verify',$DestinoRef)).Trim()
 $base=(Git-H2 -Argumentos @('-C',$fonte,'merge-base',$BaseRef,$destino)).Trim()
 if($base-eq$destino){throw 'Exige dois commits distintos: base da PR e destino.'}
 Write-Host "Base=$base; destino=$destino"
 Git-H2 -Argumentos @('clone','--no-hardlinks','--no-checkout',$fonte,$remoto)
 Git-H2 -Argumentos @('-C',$remoto,'checkout','--detach',$destino)
 # Commit negativo so no remoto descartavel. Falha antes das copias/build/suites.
 $verificador=Join-Path $remoto 'scripts/preparar-configuracao-teste.ps1'
 Add-Content $verificador "`nthrow 'H2_FALHA_PREPARAR_INTENCIONAL'"
 Git-H2 -Argumentos @('-C',$remoto,'add','scripts/preparar-configuracao-teste.ps1')
 Git-H2 -Argumentos @('-C',$remoto,'-c','user.name=CI H2','-c','user.email=ci@h2.test','commit','-m','fixture: reprovar PREPARAR H2')
 $negativo=(Git-H2 -Argumentos @('-C',$remoto,'rev-parse','HEAD')).Trim()
 Git-H2 -Argumentos @('-C',$remoto,'update-ref','refs/heads/main',$negativo)
 Git-H2 -Argumentos @('clone','--no-hardlinks','--branch','main',$remoto,$raiz)
 Git-H2 -Argumentos @('-C',$raiz,'reset','--hard',$base)
 $env:SUPPLY_VISION_PRIVADO=$privado;$env:MODO_ENSAIO='1';$env:WRANGLER_SEND_METRICS='false'
 Fase 'configuracao ficticia e dependencias da base'
 & (Join-Path $raiz 'scripts/preparar-configuracao-teste.ps1') -Destino $privado
 [IO.File]::WriteAllText((Join-Path $privado 'comum/smtp.env'),"SMTP_HOST=127.0.0.1`nSMTP_PORT=1`nSMTP_USER=teste`nSMTP_PASSWORD=teste`nEMAIL_FROM_NAME=H2`n")
 # Sem consultas Qlik: agenda marcada como concluida, inclusive se mudar o dia.
 [IO.File]::WriteAllText((Join-Path $privado 'comum/operacao.env'),"ALERTAS_HORARIOS=00:00`nBACKUP_HORARIOS=00:00`nLIMPEZA_HORARIO=00:00`nESPACO_MINIMO_GB=1`nMODO_ENSAIO=1`nADMIN_ALERTA_EMAIL=`nEXPURGO_HABILITADO=0`n")
 $cfg=Join-Path $privado 'portal/configuracao/portal.env'
 $texto=[IO.File]::ReadAllText($cfg)
 foreach($par in @(@('PORTAL_URL','http://127.0.0.1:3000'),@('INITIAL_ADMIN_PASSWORD','senha-ficticia-h2-12345'),@('BACKUP_EMAIL_TO','backup@h2.test'),@('BACKUP_NETWORK_DIR',''))){$texto=[regex]::Replace($texto,('(?m)^'+$par[0]+'=.*$'),($par[0]+'='+$par[1]))}
 [IO.File]::WriteAllText($cfg,$texto)
 New-Item -ItemType Directory -Force (Join-Path $privado 'operacao')|Out-Null
 $estado=@{}
 foreach($dia in @((Get-Date),(Get-Date).AddDays(1))){foreach($tipo in @('alertas','backup','limpeza')){$estado["$tipo-$($dia.ToString('yyyy-MM-dd'))-00:00"]='ok'}}
 $estado|ConvertTo-Json|Set-Content (Join-Path $privado 'operacao/estado.json') -Encoding UTF8
 Push-Location (Join-Path $raiz 'portal')
 try{& npm.cmd ci --no-audit --no-fund;if($LASTEXITCODE){throw 'npm ci da base falhou.'}}finally{Pop-Location}
 & python.exe -m venv (Join-Path $raiz 'alertas/.venv')
 if($LASTEXITCODE){throw 'venv da base falhou.'}
 & (Join-Path $raiz 'alertas/.venv/Scripts/python.exe') -m pip install -r (Join-Path $raiz 'alertas/config/requirements.txt') -r (Join-Path $raiz 'alertas/config/requirements-dev.txt') --quiet
 if($LASTEXITCODE){throw 'pip da base falhou.'}
 Push-Location (Join-Path $raiz 'portal')
 try{& npm.cmd run build;if($LASTEXITCODE){throw 'Build da base falhou.'}}finally{Pop-Location}
 . (Join-Path $raiz 'scripts/operacao-logica.ps1')
 . (Join-Path $raiz 'scripts/inicializacao-logica.ps1')
 if(@(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue).Count){throw 'Porta 3000 ocupada; recusa consultar outra instalacao.'}
 Fase 'supervisor, Portal e consumidores reais na base'
 if(Get-ScheduledTask -TaskName 'Supply Vision' -ErrorAction SilentlyContinue){throw 'Recusa alterar tarefa Supply Vision preexistente.'}
 if(Testar-Elevacao){
  # Mesma definicao SYSTEM do servidor; ACL herdada do TEMP do runner elevado.
  $xml=Montar-DefinicaoTarefa $raiz $privado (Localizar-NodeMaquina) (Get-Process -Id $PID).Path
  Register-ScheduledTask -TaskName 'Supply Vision' -TaskPath '\' -Xml $xml|Out-Null
  $tarefaCriada=$true
 }else{Write-Host 'Sem elevacao: supervisor em modo login; tarefa SYSTEM nao viavel.'}
 Iniciar-OperacaoConfigurada $raiz
 if(!(Esperar-CondicaoTeste {try{(Invoke-RestMethod 'http://127.0.0.1:3000/api/health' -TimeoutSec 2).status-eq'ok'}catch{$false}} 120)){throw 'Portal da base nao iniciou em 120 s.'}
 Node-H2 -Argumentos @((Join-Path $raiz 'portal/scripts/saude-operacao.mjs'),'http://127.0.0.1:3000')
 Node-H2 -Argumentos @($apoio,'semente',$raiz)
 Login-H2
 $snapshot=Join-Path $PastaTeste 'antes.json'
 Node-H2 -Argumentos @($apoio,'snapshot',$raiz,$snapshot)
 $pidBase=(Get-Content (Join-Path $privado 'operacao/supervisor.pid.json') -Raw|ConvertFrom-Json).pid
 foreach($caso in @('negativo','sucesso','negativo-final')){
  Fase "atualizador completo: $caso"
  if($caso-eq'sucesso'){
   Git-H2 -Argumentos @('-C',$remoto,'update-ref','refs/heads/main',$destino)
   Node-H2 -Argumentos @($apoio,'pendencia',$raiz)
  }elseif($caso-eq'negativo-final'){
   Git-H2 -Argumentos @('-C',$remoto,'update-ref','refs/heads/main',$negativo)
   Node-H2 -Argumentos @($apoio,'snapshot',$raiz,$snapshot)
   $pidBase=(Get-Content (Join-Path $privado 'operacao/supervisor.pid.json') -Raw|ConvertFrom-Json).pid
  }
  $logs=Join-Path $PastaTeste $caso;New-Item -ItemType Directory $logs|Out-Null
  Obter-PidsConsumidoresH2|ConvertTo-Json|Set-Content (Join-Path $logs 'consumidores-antes.json') -Encoding UTF8
  $modoMonitor=if($caso-eq'sucesso'){'sucesso'}else{'negativo'}
  $monitor=Start-Process node.exe -ArgumentList (@($apoio,'monitor',$raiz,$logs,$modoMonitor)|ForEach-Object{Proteger-ArgumentoAtualizacao $_}) -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'monitor.log') -RedirectStandardError (Join-Path $logs 'monitor-erro.log')
  $processos+=$monitor
  if(!(Esperar-CondicaoTeste {Test-Path (Join-Path $logs 'monitor-pronto')} 15)){throw 'Monitor independente nao iniciou.'}
  $argsAtualizador=@('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $raiz 'scripts/atualizar-servidor.ps1'))
  $atualizador=Start-Process powershell.exe -ArgumentList (@($argsAtualizador|ForEach-Object{Proteger-ArgumentoAtualizacao $_})-join' ') -WorkingDirectory $raiz -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'atualizador.log') -RedirectStandardError (Join-Path $logs 'atualizador-erro.log')
  $processos+=$atualizador
  if(!(Esperar-ProcessoTeste $atualizador 900)){throw 'Atualizador excedeu 900 s; veja log da fase.'}
  [IO.File]::WriteAllText((Join-Path $logs 'monitor-parar'),'ok')
  if(!(Esperar-ProcessoTeste $monitor 15)){throw 'Monitor nao encerrou em 15 s.'}
  foreach($p in @('atualizador.log','atualizador-erro.log','monitor.log','monitor-erro.log')){Get-Content (Join-Path $logs $p)|Write-Host}
  $pidsDepois=Obter-PidsConsumidoresH2
  $pidsDepois|ConvertTo-Json|Set-Content (Join-Path $logs 'consumidores-depois.json') -Encoding UTF8
  # ExitCode pode ser nulo no PS5.1; validar tambem marcador exclusivo e HEAD.
  $codigo=$atualizador.ExitCode;$saida=Get-Content (Join-Path $logs 'atualizador.log') -Raw
  if(($null-ne$monitor.ExitCode-and$monitor.ExitCode-ne0)-or!(Test-Path (Join-Path $logs 'monitor-aprovado'))){throw "Monitor reprovou $caso."}
  $head=(Git-H2 -Argumentos @('-C',$raiz,'rev-parse','HEAD')).Trim()
  if($caso-ne'sucesso'){
   $headEsperado=if($caso-eq'negativo'){$base}else{$destino}
   if($codigo-eq0-or$saida-notmatch'H2_FALHA_PREPARAR_INTENCIONAL'-or$head-ne$headEsperado){throw 'Falha PREPARAR nao confirmada, ou codigo alterado.'}
   if((Get-Content (Join-Path $privado 'operacao/supervisor.pid.json') -Raw|ConvertFrom-Json).pid-ne$pidBase){throw 'Supervisor original foi substituido no negativo.'}
   $pidsAntes=Get-Content (Join-Path $logs 'consumidores-antes.json') -Raw|ConvertFrom-Json
   foreach($nome in @('emails','relatorios')){if($pidsDepois[$nome]-ne$pidsAntes.$nome){throw "Consumidor $nome foi substituido no negativo."}}
   # A base atual ja inclui H2 e registra o cancelamento, inclusive no
   # primeiro negativo. Contexto de cancelamento nao significa troca iniciada.
   $contexto=Get-Content (Join-Path $privado 'operacao/atualizacao.json') -Raw|ConvertFrom-Json
   if($contexto.fase-ne'cancelado-preparo'-or$contexto.limpeza-ne'concluida'-or(Test-Path $contexto.preparo)){throw 'Negativo nao registrou cancelamento e limpeza do preparo.'}
   Node-H2 -Argumentos @($apoio,'negativo',$raiz,$snapshot)
  }else{
   if(($null-ne$codigo-and$codigo-ne0)-or$head-ne$destino){throw 'Atualizacao nao chegou ao commit da PR.'}
   $contexto=Get-Content (Join-Path $privado 'operacao/atualizacao.json') -Raw|ConvertFrom-Json
   if($contexto.fase-ne'concluido'-or(Test-Path $contexto.preparo)){throw 'Contexto nao concluiu ou preparo permaneceu.'}
   Node-H2 -Argumentos @($apoio,'verificar',$raiz,$snapshot)
  }
  if((Git-H2 -Argumentos @('-C',$raiz,'status','--porcelain'))){throw 'Instalacao tem alteracoes locais.'}
  if(@(Get-ChildItem $PastaTeste -Directory -Force -Filter '.instalacao-preparo-*').Count){throw 'Pasta de preparo nao removida.'}
  Node-H2 -Argumentos @((Join-Path $raiz 'portal/scripts/saude-operacao.mjs'),'http://127.0.0.1:3000')
  Login-H2
 }
 $tempos=Get-Content (Join-Path $privado 'operacao/atualizacao-tempos.log') -Raw
 if($tempos-notmatch'Resumo atualizacao:.*operacao PARADA=\d+(?:\.\d+)? s.*PREPARAR='){throw 'Resumo de tempos da atualizacao ausente.'}
 $tempos|Write-Host
 if($tarefaCriada-and(Get-ScheduledTask -TaskName 'Supply Vision').State-eq'Disabled'){throw 'Tarefa nao foi reabilitada.'}
 Fase 'concluido'
}finally{
 foreach($p in $processos){if(!$p.HasExited){Encerrar-ArvoreTeste $p};$p.Dispose()}
 if($tarefaCriada){Disable-ScheduledTask -TaskName 'Supply Vision'|Out-Null}
 if(Test-Path $raiz){[void](Parar-Operacao $raiz 30)}
 if($tarefaCriada){Stop-ScheduledTask -TaskName 'Supply Vision';Unregister-ScheduledTask -TaskName 'Supply Vision' -Confirm:$false}
 $env:SUPPLY_VISION_PRIVADO=$privadoAntes
}
