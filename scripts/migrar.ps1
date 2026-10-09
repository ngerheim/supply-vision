[CmdletBinding()]
param([string]$Zip,[string]$Destino='C:\Projetos\supply-vision',[ValidateSet('ensaio','definitiva')][string]$Modo,
 [string]$PortalUrl,[string]$BackupNetworkDir,[string]$LimpezaHorario,[switch]$DescartarEnsaio,
 [switch]$Biblioteca,[switch]$PularInstalacoes,[string]$RepositorioTeste,[string]$RelatorioDestino,[int]$InterromperApos=0,[switch]$ContinuarSemRede)
$ErrorActionPreference='Stop'
function Testar-UncMigracao([string]$Valor){return $Valor-match '^\\\\[^\\/:*?"<>|]+\\[^\\/:*?"<>|]+(?:\\[^/:*?"<>|]*)?$'}
function Sugerir-PortalUrl([string]$Nome){return "http://${Nome}:3000"}
function Pular-EtapaMigracao([int]$Numero,[hashtable]$Estado){return $Estado.ContainsKey([string]$Numero)-and$Estado[[string]$Numero]-eq'concluida'}
function Permitir-DescarteEnsaio([hashtable]$Config){return $Config['MODO_ENSAIO']-eq'1'}
function Atualizar-EnvMigracao([string]$Arquivo,[string]$Chave,[string]$Valor){
 if($Valor-match '[\r\n]'){throw 'Valor invalido. Use uma unica linha.'}
 $linhas=@(Get-Content -LiteralPath $Arquivo -ErrorAction Stop)
 $nova=@();$achou=$false
 foreach($l in $linhas){if($l-match ('^\s*'+[regex]::Escape($Chave)+'\s*=')){if(!$achou){$nova+="$Chave=$Valor";$achou=$true}}else{$nova+=$l}}
 if(!$achou){$nova+="$Chave=$Valor"}
 [IO.File]::WriteAllLines($Arquivo,[string[]]$nova,(New-Object Text.UTF8Encoding($false)))
}
function Perguntar-Migracao([string]$Pergunta,[string]$Atual,[string]$Informado){
 if($Informado){return $Informado}
 $v=Read-Host "$Pergunta [$Atual] (Enter mantem)";if(!$v){return $Atual};return $v
}
function Testar-RedeComoSystem([string]$Caminho){
 if(!(Testar-UncMigracao $Caminho)){throw 'Use caminho UNC: \\servidor\pasta. Nao use Z:\.'}
 $id=[guid]::NewGuid().ToString('N');$nome="Supply Vision teste rede $id"
 $temp=Join-Path $env:TEMP $nome;New-Item -ItemType Directory $temp|Out-Null
 $script=Join-Path $temp 'teste.ps1';$resultado=Join-Path $temp 'resultado.txt'
 # A tarefa recebe somente caminhos, nunca credenciais. O arquivo de rede e exclusivo desta tentativa.
 $arquivo=Join-Path $Caminho ('.supply-vision-teste-'+$id)
 $a=$arquivo.Replace("'","''");$b=$resultado.Replace("'","''")
 Set-Content $script "try{[IO.File]::WriteAllText('$a','teste');Remove-Item -LiteralPath '$a' -Force;Set-Content '$b' 'OK'}catch{Set-Content '$b' 'FALHA'}" -Encoding UTF8
 & "$env:SystemRoot\System32\icacls.exe" $temp /grant '*S-1-5-18:(OI)(CI)F' /Q|Out-Null
 try{
  $acao=New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument ('-NoProfile -ExecutionPolicy Bypass -File "'+$script+'"')
  $config=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Seconds 60)
  Register-ScheduledTask -TaskName $nome -Action $acao -Settings $config -User SYSTEM -RunLevel Highest|Out-Null
  Start-ScheduledTask -TaskName $nome
  $limite=(Get-Date).AddSeconds(65)
  while(!(Test-Path $resultado)-and(Get-Date)-lt$limite){Start-Sleep 1}
  return (Test-Path $resultado)-and((Get-Content $resultado -Raw).Trim()-eq'OK')
 }finally{
  Stop-ScheduledTask -TaskName $nome -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $nome -Confirm:$false -ErrorAction SilentlyContinue
  # Se a tarefa parou entre criar e apagar, tenta limpar somente seu arquivo exclusivo.
  Remove-Item -LiteralPath $arquivo -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $temp -Recurse -Force
 }
}
function Descartar-InstalacaoEnsaio([string]$Raiz,[string]$Privado){
 $cfg=Ler-ConfigOperacao (Join-Path $Privado 'comum\operacao.env')
 if(!(Permitir-DescarteEnsaio $cfg)){throw 'Descarte recusado: esta instalacao nao tem MODO_ENSAIO=1. Nada foi movido.'}
 $t=Obter-TarefaSupplyVision $Raiz
 if($t){Disable-ScheduledTask -TaskName 'Supply Vision'|Out-Null}
 try{
  . (Join-Path $Raiz 'scripts\migracao-logica.ps1')
  Parar-ParaMigracao $Privado
  if($t){Unregister-ScheduledTask -TaskName 'Supply Vision' -Confirm:$false}
  $arquivo=$Privado+'.ensaio-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8)
  Move-Item -LiteralPath $Privado -Destination $arquivo
  return $arquivo
 }catch{if($t-and(Obter-TarefaSupplyVision $Raiz)){Enable-ScheduledTask -TaskName 'Supply Vision'|Out-Null};throw}
}
if($Biblioteca){return}
# Parametros de teste nao substituem os scripts reais de restauracao, tarefa ou homologacao.
if($PularInstalacoes-and!$RepositorioTeste){throw 'PularInstalacoes exige RepositorioTeste.'}
if(!$RepositorioTeste-and!$PSBoundParameters.ContainsKey('Destino')){$Destino=Perguntar-Migracao 'Pasta para instalar o sistema' $Destino ''}
if($RepositorioTeste){$Destino=[IO.Path]::GetFullPath($RepositorioTeste)}
$Destino=[IO.Path]::GetFullPath($Destino)
$admin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if(!$admin){throw 'Abra MIGRAR.bat e aceite Executar como administrador.'}
$privadoExistente=Join-Path $Destino 'privado'
if((Test-Path (Join-Path $privadoExistente 'comum\operacao.env'))-and!$DescartarEnsaio){
 . (Join-Path $Destino 'scripts\operacao-logica.ps1')
 $cfgExistente=Ler-ConfigOperacao (Join-Path $privadoExistente 'comum\operacao.env')
 if((Permitir-DescarteEnsaio $cfgExistente)-and!$RepositorioTeste){
  if((Read-Host 'Retomar ensaio (Enter) ou Descartar instalacao de ensaio (digite DESCARTAR)')-eq'DESCARTAR'){$DescartarEnsaio=$true}
 }
}
if($DescartarEnsaio){
 . (Join-Path $Destino 'scripts\operacao-logica.ps1');. (Join-Path $Destino 'scripts\inicializacao-logica.ps1')
 $arquivada=Descartar-InstalacaoEnsaio $Destino $privadoExistente
 Remove-Item -LiteralPath ($Destino+'.migracao.json') -Force -ErrorAction SilentlyContinue
 Write-Host "Ensaio preservado em $arquivada. Execute MIGRAR.bat novamente e escolha a semente definitiva."
 return
}
if(!$Zip){
 $zips=@(Get-ChildItem -LiteralPath $PSScriptRoot -Filter 'supply-vision-semente-*.zip')
 if($zips.Count-eq1){$Zip=$zips[0].FullName}else{$Zip=Read-Host 'Caminho completo da semente zip'}
}
$Zip=(Resolve-Path -LiteralPath $Zip).Path
$hash=(Get-FileHash -LiteralPath $Zip -Algorithm SHA256).Hash
# Progresso fora de privado permite registrar as etapas anteriores a restauracao.
# Este arquivo nao contem dados da semente, credenciais ou configuracao.
New-Item -ItemType Directory -Force (Split-Path $Destino)|Out-Null
$checkpoint=$Destino+'.migracao.json';$estado=@{};$pendentes=@()
if(Test-Path $checkpoint){$salvo=Get-Content $checkpoint -Raw|ConvertFrom-Json;$pendentes=@($salvo.registros|Where-Object {$_});if($salvo.semente-ne$hash){throw 'Outra semente foi selecionada. Use Descartar instalacao de ensaio ou uma pasta de destino nova.'};foreach($p in $salvo.etapas.PSObject.Properties){$estado[$p.Name]=$p.Value};if($salvo.modo-and$Modo-and$Modo-ne$salvo.modo){throw 'Modo diferente da retomada. Primeiro use Descartar instalacao de ensaio.'};if(!$Modo){$Modo=$salvo.modo}}
function Salvar-ProgressoMigracao {
 $tmp=$checkpoint+'.tmp';@{semente=$hash;modo=$script:Modo;etapas=$estado;registros=$script:pendentes}|ConvertTo-Json -Depth 4|Set-Content $tmp -Encoding UTF8
 Move-Item -LiteralPath $tmp -Destination $checkpoint -Force
}
function Registrar-Migracao([string]$Mensagem){
 Write-Host $Mensagem
 $op=Join-Path $Destino 'privado\operacao'
 $registro="$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Mensagem"
 if(Test-Path $op){
  foreach($anterior in $script:pendentes){Add-Content (Join-Path $op 'migracao.log') $anterior -Encoding UTF8}
  $script:pendentes=@();Add-Content (Join-Path $op 'migracao.log') $registro -Encoding UTF8
 }else{$script:pendentes+= $registro}
 Salvar-ProgressoMigracao
}
function Etapa-Migracao([int]$Numero,[string]$Texto,[scriptblock]$Acao){
 if(Pular-EtapaMigracao $Numero $estado){Registrar-Migracao "$Numero/10 - ${Texto}: ja concluida";return}
 Registrar-Migracao "$Numero/10 - $Texto"
 & $Acao
 $estado[[string]$Numero]='concluida'
 Salvar-ProgressoMigracao
 if($InterromperApos-eq$Numero){throw "Interrupcao simulada apos etapa $Numero. Execute novamente para continuar."}
}
try{
 Etapa-Migracao 1 'Conferir o servidor' {
  if([Environment]::OSVersion.Version.Build-lt22621){throw 'Windows 11 22621 ou mais recente necessario. Solicite ajuda a TI.'}
  $drive=Get-PSDrive -Name ([IO.Path]::GetPathRoot($Destino).Substring(0,1))
  if($drive.Free-lt10GB){throw 'Libere pelo menos 10 GB no disco de destino e tente novamente.'}
  if(!$RepositorioTeste){Invoke-WebRequest 'https://github.com/ngerheim/supply-vision' -UseBasicParsing -TimeoutSec 30|Out-Null}
 }
 Etapa-Migracao 2 'Instalar Git, Node e Python para a maquina' {
  if(!$PularInstalacoes){
   $winget=(Get-Command winget.exe -ErrorAction Stop).Source
   $env:Path=[Environment]::GetEnvironmentVariable('Path','Machine')
   foreach($pacote in @(@('git.exe','Git.Git','2.0.0'),@('node.exe','OpenJS.NodeJS.LTS','22.13.0'),@('python.exe','Python.Python.3.12','3.12.0'))){
    $cmd=Get-Command $pacote[0] -ErrorAction SilentlyContinue;$adequado=$false
    if($cmd-and$cmd.Source-notlike'*WindowsApps*'){$versao=(& $cmd.Source --version|Out-String);$adequado=$versao-match '(\d+\.\d+\.\d+)';if($adequado){$adequado=[version]$Matches[1]-ge[version]$pacote[2]}}
    if(!$adequado){
     $opcoes=@('install','--id',$pacote[1],'--exact','--scope','machine','--silent','--accept-package-agreements','--accept-source-agreements')
     if($pacote[1]-eq'Python.Python.3.12'){$opcoes+=@('--override','/quiet InstallAllUsers=1 PrependPath=1 Include_test=0')}
     & $winget @opcoes
     if($LASTEXITCODE){throw 'Instalacao falhou. Confira a internet e execute MIGRAR.bat novamente.'}
     $env:Path=[Environment]::GetEnvironmentVariable('Path','Machine')
    }
   }
   $env:Path=[Environment]::GetEnvironmentVariable('Path','Machine')+';'+[Environment]::GetEnvironmentVariable('Path','User')
  }
  foreach($regra in @(@('git.exe','2.0.0'),@('node.exe','22.13.0'),@('python.exe','3.12.0'))){
   $v=(& $regra[0] --version|Out-String);if($v-notmatch '(\d+\.\d+\.\d+)' -or [version]$Matches[1]-lt[version]$regra[1]){throw "Versao de $($regra[0]) insuficiente. Atualize para $($regra[1]) ou mais recente."}
  }
 }
 Etapa-Migracao 3 'Obter o sistema aprovado (main)' {
  if(!$RepositorioTeste){
   if(Test-Path $Destino){
    $origem=(& git.exe -C $Destino remote get-url origin 2>$null|Out-String).Trim()
    $branch=(& git.exe -C $Destino branch --show-current 2>$null|Out-String).Trim()
    if($origem-ne'https://github.com/ngerheim/supply-vision.git'-or$branch-ne'main'-or@(& git.exe -C $Destino status --porcelain).Count){throw 'Pasta existente nao corresponde a clone limpo da main. Preserve-a e escolha outra pasta.'}
    return
   }
   & git.exe clone --branch main --single-branch https://github.com/ngerheim/supply-vision.git $Destino
   if($LASTEXITCODE){throw 'Clone falhou. Preserve a pasta parcial e escolha outra pasta para tentar novamente.'}
  }
 }
 . (Join-Path $Destino 'scripts\operacao-logica.ps1');. (Join-Path $Destino 'scripts\inicializacao-logica.ps1')
 $privado=Join-Path $Destino 'privado';$env:SUPPLY_VISION_PRIVADO=$privado
 Etapa-Migracao 4 'Escolher ensaio ou migracao definitiva' {
  if(!$script:Modo){$escolha=Read-Host 'Ensaio ou migracao definitiva? Digite ensaio ou definitiva';if($escolha-notin@('ensaio','definitiva')){throw 'Escolha ensaio ou definitiva e tente novamente.'};$script:Modo=$escolha}
 }
 Etapa-Migracao 5 'Restaurar a semente' {
  & (Join-Path $Destino 'scripts\restaurar-semente.ps1') -Zip $Zip
  Registrar-Migracao ('Etapas anteriores concluidas: '+(($estado.Keys|Sort-Object {[int]$_})-join', '))
  Atualizar-EnvMigracao (Join-Path $privado 'comum\operacao.env') 'MODO_ENSAIO' $(if($Modo-eq'ensaio'){'1'}else{'0'})
 }
 Etapa-Migracao 6 'Revisar os valores da nova maquina' {
  $portalEnv=Join-Path $privado 'portal\configuracao\portal.env';$opEnv=Join-Path $privado 'comum\operacao.env'
  $cfg=Ler-ConfigOperacao $portalEnv;$op=Ler-ConfigOperacao $opEnv
  $dns=[Net.Dns]::GetHostEntry([Environment]::MachineName).HostName
  Write-Host "Endereco anterior: $($cfg['PORTAL_URL'])"
  $url=Perguntar-Migracao 'Endereco do Portal' (Sugerir-PortalUrl $dns) $PortalUrl
  $uri=$null;if(![uri]::TryCreate($url,[UriKind]::Absolute,[ref]$uri)-or$uri.Scheme-notin@('http','https')-or$uri.UserInfo){throw 'Endereco invalido. Use http://sup.locfrotas.local:3000 sem usuario ou senha.'}
  $rede=Perguntar-Migracao 'Pasta de backup na rede' $cfg['BACKUP_NETWORK_DIR'] $BackupNetworkDir
  if(!(Testar-UncMigracao $rede)){throw 'Use caminho UNC: \\servidor\pasta.'}
  if(!(Testar-RedeComoSystem $rede)){
   $dominio=(Get-CimInstance Win32_ComputerSystem).Domain
   Write-Host ('Nao foi possivel gravar como SYSTEM. Peca a TI permissao no compartilhamento e no NTFS para '+$dominio+'\'+$env:COMPUTERNAME+'$. No ensaio o backup em rede permanece bloqueado.') -ForegroundColor Yellow
   if(!$ContinuarSemRede-and(Read-Host 'Continuar mesmo assim? Digite SIM')-ne'SIM'){throw 'Permissao de rede pendente. Peca ajuda a TI e execute novamente.'}
  }
  $horario=Perguntar-Migracao 'Horario da limpeza (HH:mm)' $op['LIMPEZA_HORARIO'] $LimpezaHorario
  $hora=[datetime]::MinValue;if(![datetime]::TryParseExact($horario,'HH:mm',[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::None,[ref]$hora)){throw 'Horario invalido. Use HH:mm, por exemplo 03:00.'}
  Atualizar-EnvMigracao $portalEnv 'PORTAL_URL' $url;Atualizar-EnvMigracao $portalEnv 'BACKUP_NETWORK_DIR' $rede;Atualizar-EnvMigracao $opEnv 'LIMPEZA_HORARIO' $horario
 }
 Etapa-Migracao 7 'Instalar e configurar a tarefa SYSTEM' {& (Join-Path $Destino 'scripts\instalar.ps1') -ModoInicializacao computador}
 Etapa-Migracao 8 'Abrir a porta do Portal na rede local' {& (Join-Path $Destino 'portal\scripts\abrir-firewall-lan.ps1') -SemPausa}
 Etapa-Migracao 9 'Iniciar e aguardar o Portal' {
  Start-ScheduledTask -TaskName 'Supply Vision'
  $limite=(Get-Date).AddMinutes(3);$ok=$false
  do{try{$h=Invoke-RestMethod 'http://127.0.0.1:3000/api/health' -TimeoutSec 5;$ok=$h.status-eq'ok'-and(Get-ScheduledTask -TaskName 'Supply Vision').State-eq'Running'-and(Test-Path (Join-Path $privado 'operacao\status.json'))}catch{};if(!$ok){Start-Sleep 2}}while(!$ok-and(Get-Date)-lt$limite)
  if(!$ok){throw 'Portal nao respondeu em 3 minutos. Veja privado/operacao/supervisor.log; solicite ajuda e execute novamente.'}
 }
 Etapa-Migracao 10 'Gerar o relatorio de verificacao final' {& (Join-Path $Destino 'scripts\homologar.ps1') -Destino $RelatorioDestino}
 # Registra tambem as etapas anteriores a criacao de privado, sem dados sensiveis.
 Registrar-Migracao ('Etapas concluidas: '+(($estado.Keys|Sort-Object {[int]$_})-join', '))
 Write-Host 'Concluido. Leia o relatorio na Area de Trabalho. Reinicie sem fazer login e confira o Portal de outro computador.'
}catch{Registrar-Migracao 'Etapa nao concluida. Preserve os arquivos, corrija o problema indicado e execute MIGRAR.bat novamente.';throw}
