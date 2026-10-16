# Funcoes de apoio exclusivas dos testes; nao alteram a operacao.
function Esperar-CondicaoTeste([scriptblock]$Condicao,[int]$Segundos=60,
 [scriptblock]$Agora={ [DateTime]::UtcNow },
 [scriptblock]$Pausa={param($Ms) Start-Sleep -Milliseconds $Ms}){
 $limite=(& $Agora).AddSeconds($Segundos)
 do{
  if(& $Condicao){return $true}
  if((& $Agora)-ge$limite){return $false}
  & $Pausa 500
 }while($true)
}
function Formatar-DiagnosticoTravaTeste($Instancias){
 $linhas=@()
 foreach($i in $Instancias){
  $usado=if(Test-Path -LiteralPath $i.manifesto){(Get-Content -LiteralPath $i.manifesto -Raw).Trim()}else{'nao registrado; instancia ainda nao chegou a entrada'}
  $linhas+="PID $($i.pid): trava passada=$($i.trava); trava registrada=$usado; existe=$(Test-Path -LiteralPath $i.trava)"
  foreach($tipo in @('saida','erro','log')){
   $conteudo=try{if(Test-Path -LiteralPath $i[$tipo]){Get-Content -LiteralPath $i[$tipo] -Raw -Encoding UTF8 -ErrorAction Stop}else{'(arquivo ainda nao criado)'}}catch{"(leitura indisponivel: $($_.Exception.Message))"}
   $linhas+="${tipo}: $($i[$tipo])`n$conteudo"
  }
 }
 return $linhas-join"`n"
}

# Preparacao comum dos dois cenarios do supervisor. Somente destino novo em TEMP.
function Preparar-InstalacaoSupervisorTeste([string]$Raiz,[string]$Destino){
 $base=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)+[IO.Path]::DirectorySeparatorChar
 $alvo=[IO.Path]::GetFullPath($Destino)
 if(!$alvo.StartsWith($base,[StringComparison]::OrdinalIgnoreCase)-or(Test-Path -LiteralPath $alvo)){throw 'Fixture exige destino novo dentro de TEMP.'}
 foreach($dir in @('scripts','portal/dist/server','portal/scripts','alertas/processo','privado/comum','privado/portal/configuracao','privado/portal/logs','privado/alertas/config','privado/alertas/logs','privado/alertas/relatorios/diarios','privado/alertas/parametros/de_para','privado/alertas/parametros/filtros','privado/operacao','bin')){
  New-Item -ItemType Directory -Force (Join-Path $alvo $dir)|Out-Null
 }
 foreach($nome in @('supervisor','operacao-logica','validar-operacao','notificacao','avisos-admin','inicializacao-logica')){
  Copy-Item (Join-Path $Raiz "scripts/$nome.ps1") (Join-Path $alvo 'scripts')
 }
 # Launcher e consumidores leem engines.node; instalar o manifesto junto do codigo.
 Copy-Item (Join-Path $Raiz 'portal/package.json') (Join-Path $alvo 'portal/package.json')
 Copy-Item (Join-Path $Raiz 'alertas/parametros') (Join-Path $alvo 'alertas') -Recurse -Force
 Copy-Item (Join-Path $Raiz 'alertas/processo/validar_parametros.py') (Join-Path $alvo 'alertas/processo')
 $parametros=Join-Path $Raiz 'alertas/parametros'
 foreach($exemplo in @(Get-ChildItem $parametros -Recurse -File|Where-Object Name -Like '*.exemplo.*')){
  $relativo=$exemplo.FullName.Substring($parametros.Length).TrimStart([IO.Path]::DirectorySeparatorChar).Replace('.exemplo','')
  Copy-Item $exemplo.FullName (Join-Path (Join-Path $alvo 'privado/alertas/parametros') $relativo) -Force
 }
}

# Espera apenas o processo, nunca WaitForExit() sem prazo (que espera tambem
# EOF de pipes herdados por descendentes). O limite independe do filho.
function Esperar-ProcessoTeste($Processo,[int]$Segundos,[string]$ArquivoFase=''){
 $cronometro=[Diagnostics.Stopwatch]::StartNew();$ultimaFase='';$ultimoAviso=-30
 do{
  if($Processo.WaitForExit(100)){return $true}
  $fase=if($ArquivoFase-and(Test-Path -LiteralPath $ArquivoFase)){Get-Content -LiteralPath $ArquivoFase -Raw -ErrorAction SilentlyContinue}else{'iniciando'}
  if($fase-ne$ultimaFase-or$cronometro.Elapsed.TotalSeconds-$ultimoAviso-ge30){
   Write-Host ("Cenario em andamento: fase=$fase; duracao=$([int]$cronometro.Elapsed.TotalSeconds) s; PID=$($Processo.Id).")
   $ultimaFase=$fase;$ultimoAviso=$cronometro.Elapsed.TotalSeconds
  }
  if($cronometro.Elapsed.TotalSeconds-ge$Segundos){return $false}
 }while($true)
}
function Encerrar-ArvoreTeste($Processo){
 if(!$Processo){return}
 if($env:OS-eq'Windows_NT'){
  $kill=Start-Process taskkill.exe -ArgumentList @('/PID',"$($Processo.Id)",'/T','/F') -PassThru -WindowStyle Hidden
  try{if(!$kill.WaitForExit(5000)){$kill.Kill()}}finally{$kill.Dispose()}
 }else{try{$Processo.Kill($true)}catch{}}
 try{if(!$Processo.WaitForExit(5000)){$Processo.Kill()}}catch{}
}

# Portas escolhidas pelo SO; nenhuma fixture sonda os endpoints da producao.
function Reservar-PortasFixtureTeste {
 $ouvintes=@();$portas=@()
 try{
  foreach($i in 1..2){$o=New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,0);$o.Start();$ouvintes+=$o;$portas+=$o.LocalEndpoint.Port}
 }finally{foreach($o in $ouvintes){$o.Stop()}}
 if($env:SV_PREPARO_RAIZ){
  $registro=Join-Path $env:SV_PREPARO_RAIZ '.cache/preparo-portas'
  New-Item -ItemType Directory -Force $registro|Out-Null
  @{pid=$PID;portas=$portas}|ConvertTo-Json|Set-Content (Join-Path $registro ($PID.ToString()+'.json')) -Encoding UTF8
 }
 return $portas
}

# Diagnostico exclusivo da instalacao ficticia, antes de sua limpeza.
function Pasta-DiagnosticoPortalTeste([string]$Fixture) {
 $base=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)+[IO.Path]::DirectorySeparatorChar
 $alvo=[IO.Path]::GetFullPath($Fixture)
 if(!$alvo.StartsWith($base,[StringComparison]::OrdinalIgnoreCase)-or(Split-Path $alvo -Leaf)-notlike'supply-vision-supervisor-*'){throw 'Diagnostico exige fixture do supervisor em TEMP.'}
 return Join-Path $alvo 'privado/operacao'
}
function Confirmar-PortalFixtureVivo([string]$Fixture) {
 $operacao=Pasta-DiagnosticoPortalTeste $Fixture
 $log=Join-Path $operacao 'supervisor.log'
 if(!(Test-Path -LiteralPath $log)){return}
 $partida=@(Get-Content -LiteralPath $log -Tail 60 -Encoding UTF8|Where-Object {$_-match'portal iniciado \(PID (\d+)\)'}|Select-Object -Last 1)
 if($partida.Count-and$partida[0]-match'portal iniciado \(PID (\d+)\)'){
  $portalId=[int]$Matches[1]
  if(!(Get-Process -Id $portalId -ErrorAction SilentlyContinue)){throw "Portal real caiu durante a partida (PID $portalId); confira portal-saida.log e portal-erro.log."}
 }
}
function Mostrar-DiagnosticoPortalTeste([string]$Fixture,[string]$Destino='') {
 $operacao=Pasta-DiagnosticoPortalTeste $Fixture
 $pastaDestino=''
 if($Destino){$pastaDestino=Join-Path $Destino (Split-Path $Fixture -Leaf);[void][IO.Directory]::CreateDirectory($pastaDestino)}
 foreach($nome in @('portal-saida.log','portal-erro.log','supervisor.log')){
  $log=Join-Path $operacao $nome
  Write-Host "Ultimas 60 linhas de ${nome}:"
  if(Test-Path -LiteralPath $log){
   $linhas=@(Get-Content -LiteralPath $log -Tail 60 -Encoding UTF8)
   $linhas|ForEach-Object {Write-Host $_}
   if($pastaDestino){[IO.File]::WriteAllLines((Join-Path $pastaDestino $nome),[string[]]$linhas,(New-Object Text.UTF8Encoding($false)))}
  }else{Write-Host '(arquivo ainda nao criado)'}
 }
 if($pastaDestino){Write-Host "Evidencias ficticias da partida: $pastaDestino"}
}
