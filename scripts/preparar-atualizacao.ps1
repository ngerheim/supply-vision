# Executado em processo oculto separado, exclusivamente no worktree descartavel.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Instalacao,[switch]$ReinstalarNode,[switch]$ReinstalarPython,[switch]$IgnorarReserva,[switch]$ForcarCompleto=($env:SV_PREPARO_COMPLETO-eq'1'),[string]$AndamentoArquivo,[string]$TemposArquivo)
$ErrorActionPreference='Stop'
$Raiz=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
. (Join-Path $PSScriptRoot 'atualizacao-preparo.ps1')
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
Validar-PastaPreparo $Instalacao $Raiz
# Sem argumento explicito, o pai legado importa preparo-tempos.log ao voltar.
# Um unico escritor evita duplicar as linhas na primeira atualizacao.
$publicarTempos=$PSBoundParameters.ContainsKey('TemposArquivo')
if(!$TemposArquivo){$TemposArquivo=Join-Path (Obter-PastaPrivada $Instalacao) 'operacao/atualizacao-tempos.log'}
if(!$AndamentoArquivo){$AndamentoArquivo=Join-Path (Obter-PastaPrivada $Instalacao) 'operacao/atualizacao-andamento.json'}
$script:PassosPreparo=New-Object Collections.ArrayList
$script:AndamentoPreparo=Ler-AndamentoAtualizacao $AndamentoArquivo
if(!$script:AndamentoPreparo){$script:AndamentoPreparo=Novo-AndamentoAtualizacao $AndamentoArquivo $TemposArquivo}
function Iniciar-PassoPreparo([string]$Nome) {
 [void]$script:PassosPreparo.Add(@{nome=$Nome;inicio=[datetime]::UtcNow})
 Publicar-AndamentoAtualizacao $script:AndamentoPreparo ('PREPARAR / '+$Nome)
}
function Concluir-PassoPreparo([string]$Codigo='0') {
 if(!$script:PassosPreparo.Count){return}
 $i=$script:PassosPreparo.Count-1;$p=$script:PassosPreparo[$i];$script:PassosPreparo.RemoveAt($i)
 $tempo=([math]::Round(([datetime]::UtcNow-$p.inicio).TotalSeconds,2)).ToString('0.##',[Globalization.CultureInfo]::InvariantCulture)
 $linha="PREPARAR / $($p.nome): codigo=$Codigo; duracao=$tempo s."
 try{Add-Content -LiteralPath (Join-Path $Raiz 'preparo-tempos.log') -Value $linha -Encoding UTF8}catch{}
 if($publicarTempos){try{Add-Content -LiteralPath $TemposArquivo -Value $linha -Encoding UTF8}catch{}}
 Write-Host $linha
}
function Registrar-CaminhoDependencias([string]$Linha) {
 Write-Host $Linha
 try{
  Add-Content -LiteralPath (Join-Path $Raiz 'preparo-tempos.log') -Value $Linha -Encoding UTF8
  if($publicarTempos){Add-Content -LiteralPath $TemposArquivo -Value $Linha -Encoding UTF8}
 }catch{}
}
function Executar-Preparo([scriptblock]$Comando,[string]$Falha) {
 $preferencia=$ErrorActionPreference;$codigo=1
 $nome=$Falha-replace' falhou no preparo\.',''-replace' falharam no preparo\.',''-replace' falhou no preparo:',':'
 Iniciar-PassoPreparo $nome
 try{$ErrorActionPreference='Continue';$global:LASTEXITCODE=0; & $Comando; $ok=$?; $codigo=$LASTEXITCODE;if(!$ok-and$codigo-eq0){$codigo=1}}
 finally{$ErrorActionPreference=$preferencia;Concluir-PassoPreparo ([string]$codigo)}
 if($codigo-ne0){throw $Falha}
}
Set-Location $Raiz
try {
 & node (Join-Path $Raiz 'portal/scripts/versao-node.mjs') --exata
 if($LASTEXITCODE){throw 'PREPARAR exige Node com o mesmo major/minor de engines.node do Portal.'}
 Iniciar-PassoPreparo 'Inicializacao isolada'
 # Nao herdar caminhos, credenciais, caches ou modo de producao.
 Get-ChildItem Env: | Where-Object Name -Match '^(SUPPLY_VISION_|SV_|PORTAL_|SMTP_|EMAIL_|BACKUP_|QLIK_|ADMIN_|MODO_ENSAIO|RELATORIOS_|WRANGLER_|MINIFLARE_|XDG_|CLOUDFLARE_|CF_|GIT_|NPM_CONFIG_|PIP_|PYTHONPATH$|VIRTUAL_ENV$|NODE_OPTIONS$)' | ForEach-Object {Remove-Item ('Env:'+$_.Name)}
 $env:SUPPLY_VISION_PRIVADO=Join-Path $Raiz 'privado'
 $env:MODO_ENSAIO='1'
 $env:SV_PREPARO_RAIZ=$Raiz
 $env:XDG_CONFIG_HOME=Join-Path $Raiz '.cache'
 $env:XDG_CACHE_HOME=$env:XDG_CONFIG_HOME
 [void][IO.Directory]::CreateDirectory($env:XDG_CONFIG_HOME)
 $env:TEMP=$env:XDG_CONFIG_HOME;$env:TMP=$env:XDG_CONFIG_HOME;$env:TMPDIR=$env:XDG_CONFIG_HOME
 $env:WRANGLER_REGISTRY_PATH=Join-Path $env:XDG_CONFIG_HOME 'wrangler-registry'
 $env:WRANGLER_CACHE_DIR=Join-Path $env:XDG_CONFIG_HOME 'wrangler'
 $env:WRANGLER_LOG_PATH=Join-Path $Raiz '.cache/wrangler.log'
 $env:WRANGLER_SEND_METRICS='false'
 $env:MINIFLARE_REGISTRY_PATH=Join-Path $Raiz '.cache/registry'
 # Ate a compilacao do helper nativo usa o TEMP descartavel, nunca o da operacao.
 # Antes de build/testes: a saida deste processo encerra a arvore inteira.
 Entrar-JobPreparo
 Concluir-PassoPreparo
 @{pid=$PID;inicio=(Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o')}|ConvertTo-Json|Set-Content (Join-Path $Raiz 'preparo-processo.json') -Encoding UTF8
 Iniciar-PassoPreparo 'Limpeza de preparos reprovados'
 Limpar-PreparosAntigos $Instalacao -PreparoAtual $Raiz -SomenteReprovados
 Concluir-PassoPreparo
 Iniciar-PassoPreparo 'Configuracao de teste'
 & (Join-Path $PSScriptRoot 'preparar-configuracao-teste.ps1') -Destino $env:SUPPLY_VISION_PRIVADO
 # Somente modelos ficticios; nem mesmo SMTP/URL dos exemplos podem sair na rede.
 [IO.File]::WriteAllText((Join-Path $env:SUPPLY_VISION_PRIVADO 'comum/smtp.env'),"SMTP_HOST=127.0.0.1`nSMTP_PORT=1`nSMTP_USER=teste`nSMTP_PASSWORD=teste`nEMAIL_FROM_NAME=teste`n")
 Add-Content (Join-Path $env:SUPPLY_VISION_PRIVADO 'comum/operacao.env') "`nMODO_ENSAIO=1`nADMIN_ALERTA_EMAIL="
 $configPortal=Join-Path $env:SUPPLY_VISION_PRIVADO 'portal/configuracao/portal.env'
 $texto=[IO.File]::ReadAllText($configPortal)
 $portasPreparo=@();$reservas=@()
 try{foreach($i in 1..2){$reserva=New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,0);$reserva.Start();$reservas+=$reserva;$portasPreparo+=$reserva.LocalEndpoint.Port}}
 finally{foreach($reserva in $reservas){$reserva.Stop()}}
 $registroPortas=Join-Path $env:XDG_CONFIG_HOME 'preparo-portas'
 New-Item -ItemType Directory -Force $registroPortas|Out-Null
 @{pid=$PID;portas=$portasPreparo}|ConvertTo-Json|Set-Content (Join-Path $registroPortas ($PID.ToString()+'.json')) -Encoding UTF8
 $texto=[regex]::Replace($texto,'(?m)^PORTAL_URL=.*$',('PORTAL_URL=http://127.0.0.1:'+$portasPreparo[0]))
 $texto=[regex]::Replace($texto,'(?m)^BACKUP_EMAIL_TO=.*$','BACKUP_EMAIL_TO=teste@example.invalid')
 [IO.File]::WriteAllText($configPortal,($texto+"`nPORTAL_PORTA=$($portasPreparo[0])`nRELATORIOS_PORTA=$($portasPreparo[1])`n"))
 Concluir-PassoPreparo
 $portal=Join-Path $Raiz 'portal';$alertas=Join-Path $Raiz 'alertas'
 Iniciar-PassoPreparo 'Metadados das dependencias'
 # Metadados capturados antes de TROCAR; falha usa copia/instalacao.
 $assinaturaAtual=$null;$impedimentoReserva=''
 try{
  $origem=Obter-AssinaturaDependencias $Instalacao (Join-Path $Instalacao 'alertas/.venv/Scripts/python.exe')
  [IO.File]::WriteAllText((Join-Path $Raiz 'dependencias-origem.json'),($origem|ConvertTo-Json -Depth 6))
  $assinaturaAtual=Obter-AssinaturaDependencias $Raiz 'python.exe'
 }catch{$impedimentoReserva='metadados/ambiente indisponiveis'}
 # O pai legado marca qualquer edicao de package/lock como reinstalacao.
 # Reavalia com os manifestos efetivos, inclusive no salto a partir desse pai.
 # Reaplicar/IgnorarReserva e reinstalacao no mesmo SHA continuam forcados.
 if(!$IgnorarReserva-and$origem-and$assinaturaAtual-and$origem.sha-ne$assinaturaAtual.sha-and(Testar-DependenciasNodeIguais $origem $assinaturaAtual)){$ReinstalarNode=$false}
 if($IgnorarReserva-or(($ReinstalarNode-or$ReinstalarPython)-and$origem.sha-eq$assinaturaAtual.sha)){$impedimentoReserva='reinstalacao forcada'}
 Concluir-PassoPreparo
 $usoReserva=Usar-ReservaDependencias $Instalacao $Raiz $assinaturaAtual $impedimentoReserva
 Iniciar-PassoPreparo 'Dependencias Node'
 if($usoReserva.usada){$caminhoNode='reserva reaproveitada'}
 elseif($ReinstalarNode-or!(Copiar-DependenciasPreparo (Join-Path $Instalacao 'portal/node_modules') (Join-Path $portal 'node_modules'))){
  $caminhoNode='instalacao - motivo: '+$usoReserva.motivo
  Push-Location $portal
  try{Executar-Preparo {& npm.cmd ci --no-audit --no-fund} 'npm ci falhou no preparo.'}finally{Pop-Location}
 }else{$caminhoNode='copia - motivo: '+$usoReserva.motivo+'; metodo: '+$script:MetodoCopiaDependencias}
 Registrar-CaminhoDependencias ('Dependencias Node: '+$caminhoNode)
 Concluir-PassoPreparo
 Iniciar-PassoPreparo 'Materializacao de junctions Node'
 # npm cria junctions para pacotes file: (fast-glob/vendor). Materializa antes
 # de mover node_modules; links absolutos apontariam para o preparo ja limpo.
 $modulos=Join-Path $portal 'node_modules'
 if(@(Get-ChildItem -LiteralPath $modulos -Recurse -Force -Attributes ReparsePoint).Count){
  [void](Copiar-DependenciasPreparo $modulos ($modulos+'-isolado'))
  [IO.Directory]::Move($modulos,($modulos+'-instalado'))
  [IO.Directory]::Move(($modulos+'-isolado'),$modulos)
 }
 Concluir-PassoPreparo
 Iniciar-PassoPreparo 'Dependencias Python'
 if($usoReserva.usada){$caminhoPython='reserva reaproveitada'}
 elseif($ReinstalarPython-or!(Copiar-DependenciasPreparo (Join-Path $Instalacao 'alertas/.venv') (Join-Path $alertas '.venv'))){
  $caminhoPython='instalacao - motivo: '+$usoReserva.motivo
  Executar-Preparo {& python.exe -m venv (Join-Path $alertas '.venv')} 'Criacao do venv falhou no preparo.'
  Executar-Preparo {& (Join-Path $alertas '.venv/Scripts/python.exe') -m pip install -r (Join-Path $alertas 'config/requirements.txt') -r (Join-Path $alertas 'config/requirements-dev.txt') --quiet} 'pip install falhou no preparo.'
 }else{$caminhoPython='copia - motivo: '+$usoReserva.motivo+'; metodo: '+$script:MetodoCopiaDependencias}
 Registrar-CaminhoDependencias ('Dependencias Python: '+$caminhoPython)
 Concluir-PassoPreparo
 Iniciar-PassoPreparo 'Validar-PythonAlertas'
 Validar-PythonAlertas (Join-Path $alertas '.venv/Scripts/python.exe')
 Concluir-PassoPreparo
 Iniciar-PassoPreparo 'Consulta CI'
 $sha=(& git rev-parse HEAD).Trim()
 if($LASTEXITCODE-ne0){throw 'Nao foi possivel obter SHA do preparo.'}
 $ci=Consultar-CIPreparo $sha -ForcarCompleto:$ForcarCompleto -Andamento $script:AndamentoPreparo
 if($ci.bloqueado){throw $ci.motivo}
 Concluir-PassoPreparo
 $modo=if($ci.rapido){'rapido'}else{'completo'}
 $linhaModo=if($ci.rapido){"PREPARAR: modo rapido - $($ci.motivo)"}else{"PREPARAR: modo completo - motivo: $($ci.motivo)"}
 Write-Host $linhaModo
 try{Add-Content (Join-Path $Raiz 'preparo-tempos.log') $linhaModo -Encoding UTF8;if($publicarTempos){Add-Content $TemposArquivo $linhaModo -Encoding UTF8}}catch{}
 Publicar-AndamentoAtualizacao $script:AndamentoPreparo 'PREPARAR / Build do Portal' -Modo $modo -MotivoModo $ci.motivo
 Push-Location $portal
 try{
  Executar-Preparo {& npm.cmd run build} 'Build do Portal falhou no preparo.'
  if(!$ci.rapido){Executar-Preparo {& npm.cmd test} 'Testes do Portal falharam no preparo.'}
 }finally{Pop-Location}
 if(!$ci.rapido){
 Push-Location $alertas
 try{Executar-Preparo {& (Join-Path $alertas '.venv/Scripts/python.exe') -m pytest tests -q} 'Testes dos Alertas falharam no preparo.'}finally{Pop-Location}
 }
 Iniciar-PassoPreparo 'Configuracao dos testes operacionais'
 $env:NODE_OPTIONS='--import="'+(New-Object Uri (Join-Path $portal 'scripts/isolamento-preparo.mjs')).AbsoluteUri+'"'
 $testes=@('validar-operacao.ps1','testar-operacao.ps1')
 if(!$ci.rapido){$testes+=@('testar-supervisor-isolado.ps1','testar-persistencia-alertas.ps1')}
 Concluir-PassoPreparo
 foreach($teste in $testes){
  Executar-Preparo {Executar-PowerShellOculto @('-NoProfile','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot $teste))} "Teste operacional falhou no preparo: $teste"
 }
 if($ci.rapido){Executar-Preparo {& node (Join-Path $portal 'scripts/fumaca-preparo.mjs') $portasPreparo[0] $portasPreparo[1]} 'Fumaca do Portal compilado falhou no preparo.'}
 Iniciar-PassoPreparo 'Aprovacao e conferencia'
 if((& git rev-parse HEAD).Trim()-cne$sha){throw 'SHA mudou durante o preparo.'}
 [IO.File]::WriteAllText((Join-Path $Raiz 'preparo-aprovado'),$sha)
 Concluir-PassoPreparo
 exit 0
}catch{
 while($script:PassosPreparo.Count){Concluir-PassoPreparo 'falhou'}
 $script:AndamentoPreparo.erro=$_.Exception.Message
 Publicar-AndamentoAtualizacao $script:AndamentoPreparo 'PREPARAR reprovado' 'falhou'
 Write-Error "PREPARAR falhou; operacao original continua no ar: $($_.Exception.Message)" -ErrorAction Continue
 try{
  # Na primeira atualizacao o pai ainda e da versao anterior. Nao depender
  # da limpeza antiga, que pode remover so o registro Git e deixar a pasta.
  Encerrar-FilhosPreparo
  Set-Location (Split-Path $Instalacao -Parent)
  Limpar-PastaPreparo $Instalacao $Raiz
 }catch{Write-Warning "PREPARAR: limpeza pendente em ${Raiz}: $($_.Exception.Message). A proxima atualizacao tentara limpar esta sobra."}
 exit 1
}
