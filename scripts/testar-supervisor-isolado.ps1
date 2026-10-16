param([switch]$SemLogin, [switch]$Ensaio, [ValidateSet('', 'falha', 'lento')][string]$AvisoAdminTeste='', [int]$AtrasoSegundaInstanciaSegundos=0, [switch]$PortalReal, [switch]$ExecutarCenario, [ValidateRange(1,600)][int]$LimiteSegundos=300, [string]$ArquivoFase='', [string]$DiagnosticoDestino='')
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'espera-testes.ps1')
# Pai externo limita inclusive venv, chamadas nativas e finally do cenario.
if(!$ExecutarCenario){
 $logs=Join-Path ([IO.Path]::GetTempPath()) ('sv-supervisor-prazo-'+[guid]::NewGuid().ToString('N'))
 New-Item -ItemType Directory $logs|Out-Null
 if(!$DiagnosticoDestino){$DiagnosticoDestino=$logs}
 $fase=Join-Path $logs 'fase.txt';$saida=Join-Path $logs 'saida.log';$erro=Join-Path $logs 'erro.log'
 $argsFilho=@('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-ExecutarCenario','-ArquivoFase',('"'+$fase+'"'),'-AtrasoSegundaInstanciaSegundos',"$AtrasoSegundaInstanciaSegundos")
 if($SemLogin){$argsFilho+='-SemLogin'};if($Ensaio){$argsFilho+='-Ensaio'}
 if($PortalReal){$argsFilho+='-PortalReal'}
 $argsFilho+=@('-DiagnosticoDestino',('"'+$DiagnosticoDestino+'"'))
 if($AvisoAdminTeste){$argsFilho+=@('-AvisoAdminTeste',$AvisoAdminTeste)}
 $filho=$null
 try{
  $filho=Start-Process (Get-Process -Id $PID).Path -ArgumentList $argsFilho -PassThru -RedirectStandardOutput $saida -RedirectStandardError $erro;[void]$filho.Handle
  if(!(Esperar-ProcessoTeste $filho $LimiteSegundos $fase)){
   Encerrar-ArvoreTeste $filho
   $etapa=if(Test-Path $fase){Get-Content $fase -Raw}else{'iniciando'}
   foreach($log in @($saida,$erro)){if(Test-Path $log){Get-Content $log -Tail 60|Write-Host}}
   throw "Supervisor isolado excedeu $LimiteSegundos s; ultima fase=$etapa; logs=$logs. Arvore de teste encerrada."
  }
  foreach($log in @($saida,$erro)){if(Test-Path $log){Get-Content $log|Write-Host}}
  if(($null-ne$filho.ExitCode-and$filho.ExitCode-ne0)-or(Get-Content $fase -Raw)-ne'concluido'){throw "Supervisor isolado falhou (codigo $($filho.ExitCode)); logs=$logs."}
 }finally{if($filho){if(!$filho.HasExited){Encerrar-ArvoreTeste $filho};$filho.Dispose()}}
 Remove-Item $logs -Recurse -Force
 return
}
function Registrar-FaseSupervisorTeste([string]$Fase){
 Write-Host "Fase supervisor isolado: $Fase"
 if($ArquivoFase){[IO.File]::WriteAllText($ArquivoFase,$Fase)}
}
$raizReal=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$temp=Join-Path $env:TEMP ('supply-vision-supervisor-'+[guid]::NewGuid().ToString('N'))
$processos=@();$pathAnterior=$env:Path;$privadoAnterior=$env:SUPPLY_VISION_PRIVADO;$ensaioAnterior=$env:MODO_ENSAIO;$adminAnterior=$env:ADMIN_ALERTA_EMAIL
function Remover-DiretorioTemporario([string]$Caminho){
 $alvoSeguro=[IO.Path]::GetFullPath($Caminho);$baseSegura=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
 if(!$alvoSeguro.StartsWith($baseSegura,[StringComparison]::OrdinalIgnoreCase)-or!(Split-Path $alvoSeguro -Leaf).StartsWith('supply-vision-supervisor-')){throw 'Diretorio de teste fora da raiz temporaria.'}

 $modulos=Join-Path $Caminho 'portal/node_modules'
 if(Test-Path -LiteralPath $modulos){[IO.Directory]::Delete($modulos)}
 # taskkill retorna antes de o Windows liberar completamente o diretorio de
 # trabalho dos filhos. A limpeza faz parte do teste, mas essa pequena janela
 # nao pode transformar um supervisor aprovado em falha de atualizacao.
 for($tentativa=1;$tentativa-le20;$tentativa++){
  try{Remove-Item -LiteralPath $Caminho -Recurse -Force -ErrorAction Stop;return}catch{
   if($tentativa-eq20){throw "Nao foi possivel limpar o teste isolado apos 10 segundos: $($_.Exception.Message)"}
   Start-Sleep -Milliseconds 500
  }
 }
}
try{
 $portasFixture=Reservar-PortasFixtureTeste;$portaFixture=$portasFixture[0];$urlFixture="http://127.0.0.1:$portaFixture"
 Registrar-FaseSupervisorTeste 'preparacao'
 Preparar-InstalacaoSupervisorTeste $raizReal $temp
 New-Item -ItemType Directory -Force "$temp\alertas\.venv\Scripts"|Out-Null
 $conteudos=@{'portal\dist\server\index.js'='const PORTAL_API_TOKEN="x";';'alertas\.venv\Scripts\python.exe'='teste';'privado\alertas\config\cfg_qlik.txt'='token';'privado\alertas\config\destinatarios.txt'='destino';'acordos.xlsx'='teste'}
 foreach($item in $conteudos.GetEnumerator()){[IO.File]::WriteAllText((Join-Path $temp $item.Key),$item.Value)}

 [IO.File]::WriteAllText("$temp\alertas\processo\pipeline.py","import json,os,pathlib,sys`npathlib.Path('../privado/operacao/pipeline-args.json').write_text(json.dumps({'args':sys.argv[1:],'ensaio':os.environ.get('MODO_ENSAIO'),'path':os.environ.get('PATH'),'cache':str(pathlib.Path(os.environ['XDG_CONFIG_HOME']).resolve()) if os.environ.get('XDG_CONFIG_HOME') else None,'cache_xdg':str(pathlib.Path(os.environ['XDG_CACHE_HOME']).resolve()) if os.environ.get('XDG_CACHE_HOME') else None,'temp':str(pathlib.Path(os.environ['TEMP']).resolve())}))`nprint('pipeline ficticio concluido')")
 [IO.File]::WriteAllText("$temp\alertas\processo\verificar_saude.py", "import pathlib,time`npathlib.Path('../privado/operacao/saude-iniciada').write_text('ficticio')`ntime.sleep(600)")
 Remove-Item -LiteralPath "$temp\alertas\.venv\Scripts\python.exe" -Force
 Registrar-FaseSupervisorTeste 'python-venv'
 & python.exe -m venv --without-pip "$temp\alertas\.venv"
 if($LASTEXITCODE-ne0){throw 'Nao foi possivel criar Python real para validacao do supervisor.'}
 [IO.File]::WriteAllText("$temp\portal\scripts\processar-relatorios.mjs", "import fs from 'node:fs';setInterval(()=>{if(fs.existsSync('../privado/operacao/parar.sinal'))process.exit(0)},500);")
 # Os mesmos pontos de entrada agora usam Node e caminhos absolutos, sem npm intermediario.
 foreach($entrada in @('iniciar-portal.mjs','processar-emails.mjs')){
  Copy-Item "$temp\portal\scripts\processar-relatorios.mjs" "$temp\portal\scripts\$entrada"
 }
 if($PortalReal){
  if(!(Test-Path (Join-Path $raizReal 'portal/dist/server/index.js'))){throw 'PortalReal exige build local.'}
  Copy-Item (Join-Path $raizReal 'portal/scripts/*') (Join-Path $temp 'portal/scripts') -Recurse -Force
  Copy-Item (Join-Path $raizReal 'portal/lib') (Join-Path $temp 'portal/lib') -Recurse -Force
  Copy-Item (Join-Path $raizReal 'portal/dist/*') (Join-Path $temp 'portal/dist') -Recurse -Force
  New-Item -ItemType Junction -Path (Join-Path $temp 'portal/node_modules') -Value (Join-Path $raizReal 'portal/node_modules')|Out-Null
  # So o Portal e real; consumidores nao enviam nada nem alteram dados reais.
  foreach($entrada in @('processar-emails.mjs','processar-relatorios.mjs')){
   [IO.File]::WriteAllText((Join-Path $temp "portal/scripts/$entrada"),"import fs from 'node:fs';setInterval(()=>{if(fs.existsSync('../privado/operacao/parar.sinal'))process.exit(0)},250);")
  }
 }
 # Processo longo o bastante para o teste observar os modulos ativos, mas que
 # tambem respeita o sinal de parada. Assim uma maquina sem permissao para
 # taskkill /T nao deixa um cmd orfao prendendo a pasta temporaria.
 $npmFalso="@echo off`r`n:aguardar`r`nif exist `"..\privado\operacao\parar.sinal`" exit /b 0`r`nping 127.0.0.1 -n 2 >nul`r`ngoto aguardar`r`n"
 [IO.File]::WriteAllText("$temp\bin\npm.cmd",$npmFalso,[Text.Encoding]::ASCII)
 [IO.File]::WriteAllText("$temp\privado\comum\smtp.env","SMTP_HOST=x`r`nSMTP_PORT=1`r`nSMTP_USER=x`r`nSMTP_PASSWORD=x`r`nEMAIL_FROM_NAME=x")
 [IO.File]::WriteAllText("$temp\privado\portal\configuracao\portal.env","PORTAL_URL=$urlFixture`r`nPORTAL_PORTA=$portaFixture`r`nRELATORIOS_PORTA=$($portasFixture[1])`r`nPORTAL_CRIAR_BANCO=1`r`nINITIAL_ADMIN_PASSWORD=senha-ficticia-12345`r`nPORTAL_API_TOKEN=x`r`nBACKUP_EMAIL_TO=x")
 [IO.File]::WriteAllText("$temp\privado\alertas\config\cfg_ambiente.txt","QLIK_TENANT=x`r`nQLIK_APP_ID=x`r`nQLIK_OBJ_ID=x`r`nDESTINATARIO_ALERTA=x")
 [IO.File]::WriteAllText("$temp\privado\comum\operacao.env","ALERTAS_HORARIOS=00:00`r`nBACKUP_HORARIOS=00:00`r`nLIMPEZA_HORARIO=00:00`r`nESPACO_MINIMO_GB=1`r`nMODO_ENSAIO=$(if($Ensaio){'1'}else{'0'})")
 if($AvisoAdminTeste){Add-Content "$temp\privado\comum\operacao.env" "`r`nADMIN_ALERTA_EMAIL=admin@example.com"}
 $filho="import fs from 'node:fs';fs.appendFileSync('../privado/operacao/avisos-iniciados',process.argv[2]+'\n');"
 if($AvisoAdminTeste-eq'falha'){$filho+="process.exitCode=1;"}else{$filho+="setTimeout(()=>process.exit(0),120000);"}
 [IO.File]::WriteAllText("$temp\portal\scripts\aviso-admin.mjs",$filho)

 $data=Get-Date -Format yyyy-MM-dd;@{"backup-$data-00:00"='ok';"limpeza-$data-00:00"='ok'}|ConvertTo-Json|Set-Content "$temp\privado\operacao\estado.json"
 # Simula ambiente antigo: operacao.env deve prevalecer.
 $env:ADMIN_ALERTA_EMAIL='herdado@example.com'
 $env:MODO_ENSAIO=if($Ensaio){'0'}else{'1'}
 $env:SUPPLY_VISION_PRIVADO=Join-Path $temp 'privado'
 $env:Path="$temp\bin;$pathAnterior"
 # A entrada rejeita qualquer pasta privada que nao seja a fixture. O parametro
 # explicito prevalece sobre o ambiente herdado da instalacao em execucao.
 $entrada=@'
param([string]$PastaPrivada,[string]$Manifesto,[switch]$SemLogin,[string]$NodeExecutavel,[int]$Atraso=0)
$ErrorActionPreference='Stop'
$esperado=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'privado'))
if([IO.Path]::GetFullPath($PastaPrivada)-ne$esperado){throw 'Pasta privada fora da fixture.'}
$env:SUPPLY_VISION_PRIVADO=$esperado
. (Join-Path $PSScriptRoot 'scripts\operacao-logica.ps1')
$privado=Obter-PastaPrivada $PSScriptRoot
[IO.File]::WriteAllText($Manifesto,(Join-Path $privado 'operacao\supervisor.lock'))
if($Atraso){Start-Sleep -Seconds $Atraso} # Simula VM lenta, somente no teste.
& (Join-Path $PSScriptRoot 'scripts\supervisor.ps1') -PastaPrivada $privado -SemLogin:$SemLogin -NodeExecutavel $NodeExecutavel -Visivel
'@
 [IO.File]::WriteAllText("$temp\entrada-teste.ps1",$entrada)
 if($SemLogin){Copy-Item (Get-Command node.exe).Source "$temp\bin\node.exe"}
 Registrar-FaseSupervisorTeste 'partida-e-trava'
 $instancias=@()
 foreach($nome in @('a','b')){
  $manifesto="$temp\$nome-trava.txt";$saida="$temp\$nome-saida.log";$erro="$temp\$nome-erro.log"
  $args=@('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+"$temp\entrada-teste.ps1"+'"'),'-PastaPrivada',('"'+"$temp\privado"+'"'),'-Manifesto',('"'+$manifesto+'"'))
  if($SemLogin){$args+=@('-SemLogin','-NodeExecutavel',('"'+"$temp\bin\node.exe"+'"'))}
  if($nome-eq'b'){$args+=@('-Atraso',$AtrasoSegundaInstanciaSegundos)}
  $proc=Start-Process powershell.exe -ArgumentList $args -PassThru -WindowStyle Hidden -RedirectStandardOutput $saida -RedirectStandardError $erro;[void]$proc.Handle
  $processos+=$proc
  $instancias+=@{pid=$proc.Id;trava="$temp\privado\operacao\supervisor.lock";manifesto=$manifesto;saida=$saida;erro=$erro;log="$temp\privado\operacao\supervisor.log"}
 }
 $convergiu=Esperar-CondicaoTeste {foreach($p in $processos){$p.Refresh()};@($processos|Where-Object HasExited).Count-eq1} -Segundos 60
 $vivos=@($processos|Where-Object{!$_.HasExited})
 if(!$convergiu-or$vivos.Count-ne1){throw ("Lock falhou: $($vivos.Count) instancias ativas apos prazo de 60 s.`n"+(Formatar-DiagnosticoTravaTeste $instancias))}
 $perdedor=@($processos|Where-Object HasExited)[0]
 if(!$perdedor.WaitForExit(5000)){throw 'Instancia perdedora nao encerrou em 5 s.'}
 $registroPerdedor=@($instancias|Where-Object {$_.pid-eq$perdedor.Id})[0]
 # Start-Process/Refresh no PS5.1 pode deixar ExitCode nulo. A mensagem
 # exclusiva da disputa confirma que nao foi apenas uma falha de inicializacao.
 if(!(Get-Content -LiteralPath $registroPerdedor.saida -Raw).Contains('A operacao ja esta ativa.')){throw ("Instancia concorrente encerrou sem confirmar trava.`n"+(Formatar-DiagnosticoTravaTeste $instancias))}
 # Espera ativa pelo status.json. Espera fixa era corrida: a verificacao de
 # saude contra um host inexistente sozinha ja consome quase 3 segundos.
 Registrar-FaseSupervisorTeste 'status-inicial'
 $statusPath="$temp\privado\operacao\status.json";$apareceu=$false
 $apareceu=Esperar-CondicaoTeste {if($PortalReal){Confirmar-PortalFixtureVivo $temp};try{$j=Get-Content $statusPath -Raw|ConvertFrom-Json;[bool]($j.portal-and$j.emails-and$j.relatorios)}catch{$false}} -Segundos 60
 if(!$apareceu){throw 'Supervisor nao gravou status.json dentro do prazo.'}
 $status=Get-Content $statusPath -Raw|ConvertFrom-Json;if(!$status.portal-or!$status.emails-or!$status.relatorios){throw 'Supervisor nao iniciou os processos simulados.'}
 if($PortalReal){
  Registrar-FaseSupervisorTeste "health-real-sqlite"
  if(!(Esperar-CondicaoTeste {try{(Invoke-WebRequest "$urlFixture/api/health" -UseBasicParsing -TimeoutSec 2).StatusCode-eq200}catch{$false}} -Segundos 60)){throw "Portal real SQLite nao ficou pronto."}
 }
 $saudeIniciada=$false
 for($i=0;$i-lt60;$i++){if(Test-Path "$temp\privado\operacao\saude-iniciada"){$saudeIniciada=$true;break};Start-Sleep -Milliseconds 500}
 if(!$saudeIniciada){throw 'Verificacao ficticia de saude nao iniciou.'}
 $pipeline=Get-Content "$temp\privado\operacao\pipeline-args.json" -Raw|ConvertFrom-Json
 $esperados=@('--slot','00:00');if($Ensaio){$esperados+='--sem-envio'}
 if(($pipeline.args-join '|')-ne($esperados-join '|')){throw 'Argumentos do pipeline divergiram do modo configurado.'}
 if($pipeline.ensaio-ne$(if($Ensaio){'1'}else{'0'})){throw 'Modo ensaio nao foi propagado ao processo Python.'}
 if($SemLogin){
  # Python resolve nomes curtos (8.3); compara destinos reais, nao a grafia do caminho.
  $pythonTeste=Join-Path $temp 'alertas\.venv\Scripts\python.exe'
  $cacheEsperado=(& $pythonTeste -c 'import pathlib,sys;print(pathlib.Path(sys.argv[1]).resolve())' (Join-Path $temp 'privado\operacao\cache')|Out-String).Trim()
  if($pipeline.cache-ne$cacheEsperado-or$pipeline.temp-ne$cacheEsperado){throw "Cache/TEMP divergentes: cache=$($pipeline.cache); TEMP=$($pipeline.temp); esperado=$cacheEsperado."}
  if($pipeline.cache_xdg-ne$cacheEsperado){throw 'Processo dependeu de cache do perfil.'}
  $binEsperado=(& $pythonTeste -c 'import pathlib,sys;print(pathlib.Path(sys.argv[1]).resolve())' (Join-Path $temp 'bin')|Out-String).Trim()
  $pathEsperado=$binEsperado+';'+[Environment]::GetEnvironmentVariable('Path','Machine')
  if($pipeline.path-ne$pathEsperado){throw "PATH divergente: atual=$($pipeline.path); esperado=$pathEsperado."}
 }
 if($status.ensaio-ne[bool]$Ensaio){throw 'status.json nao reflete o modo ensaio.'}
 $logInicio=Get-Content "$temp\privado\operacao\supervisor.log" -Raw
 if(($logInicio.Contains('Modo ensaio ATIVO'))-ne[bool]$Ensaio){throw 'Log de inicio nao reflete o modo ensaio.'}
 if(!$AvisoAdminTeste-and((Test-Path "$temp\privado\operacao\avisos-admin.sqlite")-or(Test-Path "$temp\privado\operacao\avisos-iniciados"))){throw 'Supervisor tentou envio com ADMIN_ALERTA_EMAIL ausente.'}
 Registrar-FaseSupervisorTeste 'avisos'
 if($AvisoAdminTeste){
  $marcador="$temp\privado\operacao\avisos-iniciados"
  if($Ensaio){
   if(Test-Path $marcador){throw 'Ensaio iniciou envio ao administrador.'}
   if(!$logInicio.Contains('ensaio: aviso ao administrador suprimido — Supervisor iniciado')){throw 'Supervisor nao registrou supressao.'}
  }else{
   if(!(Test-Path $marcador)){throw 'Supervisor nao iniciou aviso ficticio.'}
   if(@(Get-Content $marcador|Where-Object{$_-eq'supervisor-iniciado'}).Count-ne1){throw 'Mais de um aviso por inicializacao.'}
   $primeiro=$status.atualizado;$progrediu=$false;$concluiu=$false
   for($i=0;$i-lt150;$i++){
    Start-Sleep -Milliseconds 500
    try{$progrediu=$progrediu-or((Get-Content $statusPath -Raw|ConvertFrom-Json).atualizado-ne$primeiro)}catch{}
    $logAtual=Get-Content "$temp\privado\operacao\supervisor.log" -Raw
    $concluiu=if($AvisoAdminTeste-eq'falha'){$logAtual.Contains('Falha no aviso ao administrador')}else{$logAtual.Contains('excedeu 60 s')}
    if($concluiu-and$progrediu){break}
   }
   if(!$progrediu-or!$concluiu-or$vivos[0].HasExited){throw 'Falha/timeout do envio bloqueou ou encerrou o supervisor.'}
  }
 }

 # status.json preso por outro processo (supv, antivirus) durante mais de
 # uma volta: o supervisor registra aviso e segue; antes, encerrava tudo.
 Registrar-FaseSupervisorTeste 'status-bloqueado'
 $antes=$status.atualizado
 $trava=[IO.File]::Open($statusPath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)
 try{
  if(!(Esperar-CondicaoTeste {try{(Get-Content "$temp\privado\operacao\supervisor.log" -Raw).Contains('status.json em uso por outro processo')}catch{$false}} -Segundos 60)){throw 'Supervisor nao observou status.json em uso dentro do prazo.'}
 }finally{$trava.Dispose()}
 if($vivos[0].HasExited){throw 'Supervisor encerrou com status.json em uso.'}
 $logSupervisor=Get-Content "$temp\privado\operacao\supervisor.log" -Raw
 if($logSupervisor -match 'ERRO FATAL|Encerrando a operacao'){throw "Supervisor tratou arquivo em uso como fatal: $logSupervisor"}
 $atualizou=$false
 for($i=0;$i -lt 40;$i++){try{if((Get-Content $statusPath -Raw|ConvertFrom-Json).atualizado-ne$antes){$atualizou=$true;break}}catch{};Start-Sleep -Milliseconds 500}
 if(!$atualizou){throw 'Supervisor nao voltou a atualizar status.json apos a liberacao.'}
 Registrar-FaseSupervisorTeste 'parada'
 New-Item -ItemType File -Force "$temp\privado\operacao\parar.sinal"|Out-Null;$vivos[0].WaitForExit(25000)|Out-Null;if(!$vivos[0].HasExited){throw 'Supervisor nao encerrou.'}
 $statusFinal=Get-Content $statusPath -Raw|ConvertFrom-Json;if($statusFinal.ensaio-ne[bool]$Ensaio){throw 'Status de encerramento perdeu o modo ensaio.'}
 if($PortalReal){
  if(@(Get-NetTCPConnection -LocalPort $portaFixture -State Listen -ErrorAction SilentlyContinue).Count){throw 'Parada deixou a porta publica aberta.'}
  # Sidecars podem permanecer apos parada forcada: a verificacao e de handles,
  # nao de existencia. Nao apaga WAL/SHM enquanto alguem pode estar usando.
  $bancos=@(Get-ChildItem (Join-Path $temp 'privado/portal/banco') -Recurse -File|Where-Object {$_.Name-match '\.sqlite(?:-wal|-shm)?$'})
  if(!$bancos.Count){throw 'Portal real nao abriu banco descartavel.'}
  foreach($arquivo in $bancos){$handle=[IO.File]::Open($arquivo.FullName,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None);$handle.Dispose()}
  Write-Host "[OK] Supervisor real SQLite: banco/WAL/SHM liberados, porta fechada."
 }
 Write-Host 'Supervisor isolado: concorrencia, estado, arquivo em uso e encerramento aprovados.' -ForegroundColor Green
}catch{Write-Host ('FALHA DO CENARIO: '+$_.Exception.Message);if($PortalReal){Mostrar-DiagnosticoPortalTeste $temp $DiagnosticoDestino};if($instancias){Write-Host (Formatar-DiagnosticoTravaTeste $instancias)};throw}finally{$env:Path=$pathAnterior;$env:SUPPLY_VISION_PRIVADO=$privadoAnterior;$env:MODO_ENSAIO=$ensaioAnterior;$env:ADMIN_ALERTA_EMAIL=$adminAnterior;foreach($p in $processos){if($p-and!$p.HasExited){try{Encerrar-ArvoreTeste $p}catch{}}};if(Test-Path $temp){Remover-DiretorioTemporario $temp}}

Registrar-FaseSupervisorTeste 'concluido'
