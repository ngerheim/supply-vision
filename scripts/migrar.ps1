[CmdletBinding()]
param([string]$Zip,[string]$Destino='C:\Projetos\supply-vision',[ValidateSet('ensaio','definitiva')][string]$Modo,
 [string]$PortalUrl,[string]$BackupNetworkDir,[string]$LimpezaHorario,[switch]$DescartarEnsaio,
 [switch]$Biblioteca,[switch]$PularInstalacoes,[string]$RepositorioTeste,[string]$RelatorioDestino,[int]$InterromperApos=0,[switch]$ContinuarSemRede)
$ErrorActionPreference='Stop'
function Testar-VisualCpp {
 $r=Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64' -ErrorAction SilentlyContinue
 return $r-and$r.Installed-eq1-and[int]$r.Major-ge14
}
function Garantir-VisualCpp([switch]$SomenteVerificar){
 if(Testar-VisualCpp){return}
 if($SomenteVerificar){throw 'Microsoft Visual C++ Redistributable 2015+ x64 ausente. Execute INSTALAR.bat.'}
 Write-Host 'Instalando Microsoft Visual C++ Redistributable 2015+ x64, necessario ao Portal.'
 $w=(Get-Command winget.exe -ErrorAction Stop).Source
 & $w install --id 'Microsoft.VCRedist.2015+.x64' --exact --scope machine --silent --accept-package-agreements --accept-source-agreements
 if($LASTEXITCODE-or!(Testar-VisualCpp)){throw 'Visual C++ x64 nao ficou disponivel. Reinicie o Windows e execute a instalacao novamente.'}
}
function Executar-WorkerdVersao([string]$Exe){
 $saida=(& $Exe --version 2>&1|Out-String)
 return @{saida=$saida;codigo=$LASTEXITCODE}
}
function Conferir-Workerd([string]$Portal){
 $exe=Join-Path $Portal 'node_modules\@cloudflare\workerd-windows-64\bin\workerd.exe'
 if(!(Test-Path -LiteralPath $exe)){throw 'workerd.exe ausente. Confira o antivirus e execute npm.cmd ci na pasta portal.'}
 try{$r=Executar-WorkerdVersao $exe;$saida=$r.saida;$codigo=$r.codigo}catch{$codigo=1}
 if($codigo-or$saida-notmatch 'workerd'){throw 'O motor do Portal (workerd) nao executou. Confira Visual C++ Redistributable 2015+ x64 e o antivirus. Reinicie apos instalar; consulte docs/SOCORRO.md (write EOF).'}
 Write-Host 'Motor do Portal (workerd) executou corretamente.'
}
function Avisar-Bitdefender {
 $achou=@(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction SilentlyContinue|Where-Object displayName -Match 'Bitdefender')
 if(!$achou){$achou=@(Get-Service -ErrorAction SilentlyContinue|Where-Object {$_.DisplayName-match 'Bitdefender'})}
 if(!$achou){$achou=@(Get-CimInstance Win32_Service -ErrorAction SilentlyContinue|Where-Object {$_.PathName-match 'Bitdefender'})}
 if($achou){Write-Host 'BITDEFENDER detectado: peca a TI exclusao da pasta da instalacao no antimalware em tempo real e no controle avancado de ameacas antes de continuar. O assistente nao altera o antivirus.' -ForegroundColor Yellow}
}
function Testar-UncMigracao([string]$Valor){return $Valor-match '^\\\\[^\\/:*?"<>|]+\\[^\\/:*?"<>|]+(?:\\[^/:*?"<>|]*)?$'}
function Sugerir-PortalUrl([string]$Nome){return "http://${Nome}:3000"}
function Normalizar-ModoMigracao([string]$Texto){
 $normal=$Texto.Trim().ToLowerInvariant().Normalize([Text.NormalizationForm]::FormD) -replace '\p{Mn}',''
 $normal=$normal -replace '\s+',' '
 if($normal-eq'ensaio'){return 'ensaio'}
 if($normal-in@('definitiva','migracao definitiva','definitivo')){return 'definitiva'}
 return $null
}
function Perguntar-ModoMigracao {
 do{
  $escolhido=Normalizar-ModoMigracao (Read-Host 'Ensaio ou migracao definitiva? Digite ensaio ou definitiva')
  if(!$escolhido){Write-Host 'Escolha ensaio ou migracao definitiva. Vamos perguntar novamente.' -ForegroundColor Yellow}
 }while(!$escolhido)
 return $escolhido
}
function Pular-EtapaMigracao([int]$Numero,[hashtable]$Estado){return $Estado.ContainsKey([string]$Numero)-and$Estado[[string]$Numero]-eq'concluida'}
function Decidir-CloneMigracao([bool]$Existe,[bool]$Limpo,[bool]$Iniciado,[bool]$TemPrivado){
 if(!$Existe){return 'clonar'}
 if($Limpo){return 'usar'}
 if($Iniciado-and!$TemPrivado){return 'arquivar'}
 return 'recusar'
}
function Permitir-DescarteEnsaio([hashtable]$Config){return $Config['MODO_ENSAIO']-eq'1'}
function Atualizar-EnvMigracao([string]$Arquivo,[string]$Chave,[string]$Valor){
 if($Valor-match '[\r\n]'){throw 'Valor invalido. Use uma unica linha.'}
 $linhas=@(Get-Content -LiteralPath $Arquivo -Encoding UTF8 -ErrorAction Stop)
 $nova=@();$achou=$false
 foreach($l in $linhas){if($l-match ('^\s*'+[regex]::Escape($Chave)+'\s*=')){if(!$achou){$nova+="$Chave=$Valor";$achou=$true}}else{$nova+=$l}}
 if(!$achou){$nova+="$Chave=$Valor"}
 [IO.File]::WriteAllLines($Arquivo,[string[]]$nova,(New-Object Text.UTF8Encoding($false)))
}
function Perguntar-Migracao([string]$Pergunta,[string]$Atual,[string]$Informado){
 if($Informado){return $Informado}
 $v=Read-Host "$Pergunta [$Atual] (Enter mantem)";if(!$v){return $Atual};return $v
}
function Preparar-PastaTesteRede([string]$temp,[pscredential]$Credencial){
 $regra=if($Credencial){$Credencial.UserName+':(OI)(CI)M'}else{'*S-1-5-18:(OI)(CI)F'}
 & "$env:SystemRoot\System32\icacls.exe" $temp /grant $regra /Q|Out-Null
 if($LASTEXITCODE){throw 'Nao foi possivel preparar a pasta do teste de rede.'}
}
function Testar-RedeContaMigracao([string]$Caminho,[pscredential]$Credencial){
 if(!(Testar-UncMigracao $Caminho)){throw 'Use caminho UNC: \\servidor\pasta. Nao use Z:\.'}
 $id=[guid]::NewGuid().ToString('N');$nome="Supply Vision teste rede $id"
 $temp=Join-Path $env:TEMP $nome;New-Item -ItemType Directory $temp|Out-Null
 $script=Join-Path $temp 'teste.ps1';$resultado=Join-Path $temp 'resultado.txt'
 # A tarefa recebe somente caminhos, nunca credenciais. O arquivo de rede e exclusivo desta tentativa.
 $arquivo=Join-Path $Caminho ('.supply-vision-teste-'+$id)
 $a=$arquivo.Replace("'","''");$b=$resultado.Replace("'","''")
 Set-Content $script "try{[IO.File]::WriteAllText('$a','teste');Remove-Item -LiteralPath '$a' -Force;Set-Content '$b' 'OK'}catch{Set-Content '$b' 'FALHA'}" -Encoding UTF8
 Preparar-PastaTesteRede $temp $Credencial
 try{
  $acao=New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument ('-NoProfile -ExecutionPolicy Bypass -File "'+$script+'"')
  $config=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Seconds 60)
  if($Credencial){
   $senha=$null
   try{$senha=$Credencial.GetNetworkCredential().Password;Register-ScheduledTask -TaskName $nome -Action $acao -Settings $config -User $Credencial.UserName -Password $senha -RunLevel Highest|Out-Null}finally{$senha=$null}
  }else{Register-ScheduledTask -TaskName $nome -Action $acao -Settings $config -User SYSTEM -RunLevel Highest|Out-Null}
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
function Testar-RedeComoSystem([string]$Caminho){return Testar-RedeContaMigracao $Caminho}
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
try{
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
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
$checkpoint=$Destino+'.migracao.json';$estado=@{};$pendentes=@();$cloneIniciado=$false;$restaurada=$false
if(Test-Path $checkpoint){$salvo=Get-Content $checkpoint -Raw|ConvertFrom-Json;$cloneIniciado=!!$salvo.cloneIniciado;$restaurada=!!$salvo.restaurada;$script:contaPersonalizada=!!$salvo.contaPersonalizada;$pendentes=@($salvo.registros|Where-Object {$_});if($salvo.semente-ne$hash){throw 'Outra semente foi selecionada. Use Descartar instalacao de ensaio ou uma pasta de destino nova.'};foreach($p in $salvo.etapas.PSObject.Properties){$estado[$p.Name]=$p.Value};$modoSalvo=Normalizar-ModoMigracao $salvo.modo;if($modoSalvo-and$Modo-and$Modo-ne$modoSalvo){throw 'Modo diferente da retomada. Primeiro use Descartar instalacao de ensaio.'};if(!$Modo-and$modoSalvo){$Modo=$modoSalvo};if(!$Modo){$estado.Remove('4')}}
function Salvar-ProgressoMigracao {
 $dados=@{semente=$hash;etapas=$estado;registros=$script:pendentes;cloneIniciado=$script:cloneIniciado;restaurada=$script:restaurada;contaPersonalizada=[bool]$script:contaPersonalizada}
 if($script:Modo){$dados.modo=$script:Modo}
 $tmp=$checkpoint+'.tmp';$dados|ConvertTo-Json -Depth 4|Set-Content $tmp -Encoding UTF8
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
  Avisar-Bitdefender
  if([Environment]::OSVersion.Version.Build-lt22621){throw 'Windows 11 22621 ou mais recente necessario. Solicite ajuda a TI.'}
  $drive=Get-PSDrive -Name ([IO.Path]::GetPathRoot($Destino).Substring(0,1))
  if($drive.Free-lt10GB){throw 'Libere pelo menos 10 GB no disco de destino e tente novamente.'}
  if(!$RepositorioTeste){Invoke-WebRequest 'https://github.com/ngerheim/supply-vision' -UseBasicParsing -TimeoutSec 30|Out-Null}
 }
 Etapa-Migracao 2 'Instalar Git, Node e Python para a maquina' {
  if(!$PularInstalacoes){
   Garantir-VisualCpp
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
   $existe=Test-Path $Destino;$limpo=$false
   if($existe){
    try{
     $origem=(& git.exe -C $Destino remote get-url origin 2>$null|Out-String).Trim()
     $branch=(& git.exe -C $Destino branch --show-current 2>$null|Out-String).Trim()
     $head=(& git.exe -C $Destino rev-parse --verify HEAD 2>$null|Out-String).Trim()
     $limpo=$head-match'^[a-f0-9]{40}$'-and(Test-Path (Join-Path $Destino 'scripts\instalar.ps1'))-and$origem-eq'https://github.com/ngerheim/supply-vision.git'-and$branch-eq'main'-and!( @(& git.exe -C $Destino status --porcelain).Count )
     if($LASTEXITCODE){$limpo=$false}
    }catch{$limpo=$false}
   }
   $decisao=Decidir-CloneMigracao $existe $limpo $cloneIniciado (Test-Path (Join-Path $Destino 'privado'))
   if($decisao-eq'usar'){return}
   if($decisao-eq'recusar'){throw 'Pasta existente nao corresponde a clone limpo da main. Preserve-a e escolha outra pasta.'}
   if($decisao-eq'arquivar'){
    $arquivoClone=$Destino+'.clone-incompleto-'+[guid]::NewGuid().ToString('N')
    Move-Item -LiteralPath $Destino -Destination $arquivoClone
    Registrar-Migracao 'Clone interrompido preservado ao lado da instalacao; retomando somente a etapa de clone.'
   }
   $script:cloneIniciado=$true;Salvar-ProgressoMigracao
   & git.exe clone --branch main --single-branch https://github.com/ngerheim/supply-vision.git $Destino
   if($LASTEXITCODE){throw 'Clone falhou. Confira a internet e execute novamente: a pasta parcial sera preservada ao lado da instalacao.'}
  }
 }
 . (Join-Path $Destino 'scripts\operacao-logica.ps1');. (Join-Path $Destino 'scripts\inicializacao-logica.ps1')
 $privado=Join-Path $Destino 'privado';$env:SUPPLY_VISION_PRIVADO=$privado
 Etapa-Migracao 4 'Escolher ensaio ou migracao definitiva' {
  if(!$script:Modo){$script:Modo=Perguntar-ModoMigracao}
 }
 Etapa-Migracao 5 'Restaurar a semente' {
  if(!$restaurada){
   & (Join-Path $Destino 'scripts\restaurar-semente.ps1') -Zip $Zip
   $script:restaurada=$true;Salvar-ProgressoMigracao
  }
  Registrar-Migracao ('Etapas anteriores concluidas: '+(($estado.Keys|Sort-Object {[int]$_})-join', '))
  Atualizar-EnvMigracao (Join-Path $privado 'comum\operacao.env') 'MODO_ENSAIO' $(if($Modo-eq'ensaio'){'1'}else{'0'})
 }
 Etapa-Migracao 6 'Revisar os valores da nova maquina' {
  $portalEnv=Join-Path $privado 'portal\configuracao\portal.env';$opEnv=Join-Path $privado 'comum\operacao.env'
  $cfg=Ler-ConfigOperacao $portalEnv;$op=Ler-ConfigOperacao $opEnv
  $dns=[Net.Dns]::GetHostEntry([Environment]::MachineName).HostName
  Write-Host "Endereco anterior: $($cfg['PORTAL_URL'])"
  $url=Perguntar-Migracao 'Endereco do Portal' (Sugerir-PortalUrl $dns) $PortalUrl
  $uri=$null;if(![uri]::TryCreate($url,[UriKind]::Absolute,[ref]$uri)-or$uri.Scheme-notin@('http','https')-or$uri.UserInfo){throw 'Endereco invalido. Use http://portal.empresa.local:3000 sem usuario ou senha.'}
  $rede=Perguntar-Migracao 'Pasta de backup na rede' $cfg['BACKUP_NETWORK_DIR'] $BackupNetworkDir
  if(!(Testar-UncMigracao $rede)){throw 'Use caminho UNC: \\servidor\pasta.'}
  if(!(Testar-RedeComoSystem $rede)){
   $dominio=(Get-CimInstance Win32_ComputerSystem).Domain
   Write-Host ('Nao foi possivel gravar como SYSTEM. Peca a TI permissao no compartilhamento e no NTFS para '+$dominio+'\'+$env:COMPUTERNAME+'$. No ensaio o backup em rede permanece bloqueado.') -ForegroundColor Yellow
   if(!$ContinuarSemRede){
    $escolha=Read-Host 'Digite CONTA para usar uma conta de dominio, SIM para continuar sem rede, ou Enter para parar'
    if($escolha-eq'CONTA'){$script:credencialTarefa=Get-Credential -Message 'Conta de dominio para backup e tarefa Supply Vision';if(!$script:credencialTarefa-or!(Testar-RedeContaMigracao $rede $script:credencialTarefa)){throw 'A conta nao conseguiu gravar na pasta de backup. A tarefa definitiva nao foi alterada.'};$script:contaPersonalizada=$true;Write-Host 'Quando a senha desta conta mudar, sera necessario reconfigurar a tarefa. Veja docs/OPERAR.md.'}
    elseif($escolha-ne'SIM'){throw 'Permissao de rede pendente. Peca ajuda a TI e execute novamente.'}
   }
  }
  $horario=Perguntar-Migracao 'Horario da limpeza (HH:mm)' $op['LIMPEZA_HORARIO'] $LimpezaHorario
  $hora=[datetime]::MinValue;if(![datetime]::TryParseExact($horario,'HH:mm',[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::None,[ref]$hora)){throw 'Horario invalido. Use HH:mm, por exemplo 03:00.'}
  Atualizar-EnvMigracao $portalEnv 'PORTAL_URL' $url;Atualizar-EnvMigracao $portalEnv 'BACKUP_NETWORK_DIR' $rede;Atualizar-EnvMigracao $opEnv 'LIMPEZA_HORARIO' $horario
 }
 Etapa-Migracao 7 'Instalar e configurar a tarefa' {
  if($contaPersonalizada-and!$credencialTarefa){$script:credencialTarefa=Get-Credential -Message 'Informe novamente a conta da tarefa (senha nao e guardada)';$cfg=Ler-ConfigOperacao (Join-Path $privado 'portal\configuracao\portal.env');if(!$credencialTarefa-or!(Testar-RedeContaMigracao $cfg['BACKUP_NETWORK_DIR'] $credencialTarefa)){throw 'Conta nao aprovada no teste de rede. Tarefa nao alterada.'}}
  & (Join-Path $Destino 'scripts\instalar.ps1') -ModoInicializacao computador -CredencialTarefa $credencialTarefa
 }
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

}catch{
 $erroMigracao=$_.Exception.Message
 $logFalha=$Destino+'.migracao-erro.log'
 if(!(Test-Path -LiteralPath (Split-Path $logFalha -Parent))){$logFalha=Join-Path ([IO.Path]::GetTempPath()) ('Supply-Vision-migracao-erro-'+$PID+'.log')}
 try{[IO.File]::WriteAllText($logFalha,'Migracao nao concluida. '+$erroMigracao,(New-Object Text.UTF8Encoding($true)))}catch{}
 Write-Host $erroMigracao -ForegroundColor Red
 Write-Host 'Migracao nao concluida. Preserve os arquivos e consulte docs/SOCORRO.md.' -ForegroundColor Red
 Write-Host "Log: $logFalha"
 if(!$RepositorioTeste){[void](Read-Host 'A janela permanece aberta. Pressione Enter somente depois de anotar o erro e o log')}
 throw
}
