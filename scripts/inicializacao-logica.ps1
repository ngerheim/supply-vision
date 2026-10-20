if(!(Get-Command Obter-PastaPrivada -ErrorAction SilentlyContinue)){. (Join-Path $PSScriptRoot 'operacao-logica.ps1')}
# Modos explicitos; a tarefa registrada e a fonte de verdade do modo sem login.
function Testar-Elevacao {
 return ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
function Obter-TarefaSupplyVision([string]$Raiz) {
 if(!(Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue)){return $null}
 $t=Get-ScheduledTask -TaskName 'Supply Vision' -TaskPath '\' -ErrorAction SilentlyContinue
 if($t-and([string]$t.Actions.Arguments).Contains((Join-Path $Raiz 'scripts\supervisor.ps1'))){return $t}
 return $null
}
function Obter-ModoInicializacao([string]$Raiz) {
 if(Obter-TarefaSupplyVision $Raiz){return 'computador'}
 return 'desligado'
}
function Plano-Inicializacao([ValidateSet('desligado','computador')][string]$Modo) {
 return @{CriarTarefa=($Modo-eq'computador');RemoverTarefa=($Modo-ne'computador')}
}
function Localizar-NodeMaquina([string]$Informado) {
 $candidatos=@()
 if($Informado){$candidatos+= $Informado}
 else{
  $registro=Get-ItemProperty 'HKLM:\SOFTWARE\Node.js' -ErrorAction SilentlyContinue
  if($registro.InstallPath){$candidatos+=Join-Path $registro.InstallPath 'node.exe'}
  $candidatos+=Join-Path $env:ProgramFiles 'nodejs\node.exe'
  foreach($dir in ([Environment]::GetEnvironmentVariable('Path','Machine')-split';')){if($dir){$candidatos+=Join-Path $dir 'node.exe'}}
 }
 foreach($c in $candidatos){if([IO.Path]::IsPathRooted($c)-and(Test-Path -LiteralPath $c -PathType Leaf)){return [IO.Path]::GetFullPath($c)}}
 throw ('Node instalado na maquina nao encontrado. Instale Node '+(Get-Content -LiteralPath (Join-Path $PSScriptRoot '../portal/package.json') -Raw|ConvertFrom-Json).engines.node+' para todos os usuarios ou informe seu caminho absoluto.')
}
function Validar-BackupSemLogin([string]$Modo,[string]$Caminho) {
 if($Modo-eq'computador'-and$Caminho-and$Caminho-notmatch '^\\\\[^\\]+\\[^\\]+'){
  throw 'BACKUP_NETWORK_DIR no modo sem login deve ser UNC (\\servidor\pasta), nunca letra de unidade como Z:\.'
 }
}
function Montar-DefinicaoTarefa([string]$Raiz,[string]$Privado,[string]$Node,[string]$PowerShell,[Parameter(Mandatory=$true)][ValidateNotNullOrEmpty()][string]$Conta) {
 foreach($c in @($Raiz,$Privado,$Node,$PowerShell)){if($c-notmatch '^(?:[A-Za-z]:\\|\\\\)'){throw 'A tarefa exige caminhos Windows absolutos.'}}
 $args='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+($Raiz.TrimEnd('\')+'\scripts\supervisor.ps1')+'" -SemLogin -NodeExecutavel "'+$Node+'" -PastaPrivada "'+$Privado+'"'
 if($Conta-in@('SYSTEM','S-1-5-18','NT AUTHORITY\SYSTEM')){throw 'Informe a conta de usuario do dono da operacao.'}
 $u=[Security.SecurityElement]::Escape($Conta);$a=[Security.SecurityElement]::Escape($args);$exe=[Security.SecurityElement]::Escape($PowerShell);$cwd=[Security.SecurityElement]::Escape($Raiz)
 return @"
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
 <Triggers><BootTrigger><Enabled>true</Enabled><Delay>PT1M</Delay></BootTrigger></Triggers>
 <Principals><Principal id="Operacao"><UserId>$u</UserId><LogonType>Password</LogonType><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
 <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><AllowStartOnDemand>true</AllowStartOnDemand><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure></Settings>
 <Actions Context="Operacao"><Exec><Command>$exe</Command><Arguments>$a</Arguments><WorkingDirectory>$cwd</WorkingDirectory></Exec></Actions>
</Task>
"@
}
function Obter-GruposAutorizadosConta([string]$Conta) {
 Add-Type -AssemblyName System.DirectoryServices.AccountManagement
 if($Conta-match '^S-1-'){$Conta=(New-Object Security.Principal.SecurityIdentifier($Conta)).Translate([Security.Principal.NTAccount]).Value}
 $prefixo=($Conta-split'\\')[0]
 $dominio=$Conta.Contains('\')-and$prefixo-notin@('.',$env:COMPUTERNAME)
 $tipo=if($dominio){[DirectoryServices.AccountManagement.ContextType]::Domain}else{[DirectoryServices.AccountManagement.ContextType]::Machine}
 $contexto=New-Object DirectoryServices.AccountManagement.PrincipalContext($tipo)
 $usuario=$null
 try{
  $usuario=[DirectoryServices.AccountManagement.UserPrincipal]::FindByIdentity($contexto,$Conta)
  if(!$usuario){throw 'Conta nao encontrada para validar grupos.'}
  return @($usuario.GetAuthorizationGroups()|ForEach-Object {$_.Sid.Value})
 }finally{if($usuario){$usuario.Dispose()};$contexto.Dispose()}
}
function Testar-ContaAdministradora([string]$Conta) {
 if($Conta-in@('SYSTEM','S-1-5-18','NT AUTHORITY\SYSTEM')){return $false}
 $sid=if($Conta-match '^S-1-'){$Conta}else{(New-Object Security.Principal.NTAccount($Conta)).Translate([Security.Principal.SecurityIdentifier]).Value}
 $membros=@(Get-LocalGroupMember -SID 'S-1-5-32-544' -ErrorAction Stop|ForEach-Object {$_.SID.Value})
 if($sid-in$membros){return $true}
 return !!(@(Obter-GruposAutorizadosConta $Conta|Where-Object {$_-in$membros}).Count)
}
function Preparar-GrupoOperadores([Parameter(Mandatory=$true)][ValidateNotNullOrEmpty()][string]$Conta) {
 $nome='Supply Vision Operadores'
 $grupo=Get-LocalGroup -Name $nome -ErrorAction SilentlyContinue
 if(!$grupo){$grupo=New-LocalGroup -Name $nome -Description 'Operadores Supply Vision'}
 $membros=@(Get-LocalGroupMember -SID 'S-1-5-32-544' -ErrorAction Stop)
 $sidConta=if($Conta-match'^S-1-'){$Conta}else{(New-Object Security.Principal.NTAccount($Conta)).Translate([Security.Principal.SecurityIdentifier]).Value}
 $membros+=@{SID=@{Value=$sidConta}}
 $existentes=@(Get-LocalGroupMember -Group $nome -ErrorAction Stop|ForEach-Object {$_.SID.Value})
 foreach($m in $membros){if($m.SID.Value-notin$existentes){Add-LocalGroupMember -Group $nome -Member $m.SID.Value -ErrorAction Stop;$existentes+=$m.SID.Value}}
 return $grupo.SID.Value
}
function Liberar-AcessoOperacao([string]$Raiz,[string]$Privado,[Parameter(Mandatory=$true)][ValidateNotNullOrEmpty()][string]$Conta) {
 $sid=Preparar-GrupoOperadores $Conta
 $regras=@('*S-1-5-18:(OI)(CI)F','*S-1-5-32-544:(OI)(CI)F',('*'+$sid+':(OI)(CI)M'))
 $regras+=($Conta+':(OI)(CI)M')
 # Mantem ACLs existentes. Nenhum acesso para Everyone; heranca cobre novos arquivos.
 $pastas=@(@($Raiz,$Privado)|Select-Object -Unique);$indice=0
 foreach($p in $pastas){
  Write-Progress -Activity 'Permissoes da tarefa Supply Vision' -Status "Pasta $($indice+1) de $($pastas.Count). Aguarde." -PercentComplete ([int](100*$indice/$pastas.Count))
  $indice++
  Write-Host "Preparando permissoes em $p. Pode levar alguns minutos; aguarde."
  $r=Executar-NativoOperacao "$env:SystemRoot\System32\icacls.exe" (@($p,'/grant')+$regras+@('/T','/Q'))
  if($r.codigo-ne0){Write-Progress -Activity 'Permissoes da tarefa Supply Vision' -Completed;throw 'Falha ao preparar permissoes da operacao. A tarefa nao foi ativada.'}
 }
 Write-Progress -Activity 'Permissoes da tarefa Supply Vision' -Completed
}
function Definir-ModoInicializacao([string]$Raiz,[string]$Privado,[ValidateSet('desligado','computador')][string]$Modo,[string]$NodeExecutavel,[pscredential]$Credencial) {
 $ErrorActionPreference='Stop'
 if(!(Testar-Elevacao)){throw 'Alterar a inicializacao exige PowerShell elevado (Executar como administrador).'}
 if(Test-Path (Join-Path $Privado 'operacao\supervisor.lock')){
  if(!(Testar-SupervisorEncerrado $Privado)){throw 'Pare a operacao e aguarde seu encerramento antes de mudar o modo.'}
 }
 $t=Get-ScheduledTask -TaskName 'Supply Vision' -TaskPath '\' -ErrorAction SilentlyContinue
 if($t-and!(Obter-TarefaSupplyVision $Raiz)){throw 'Ja existe uma tarefa Supply Vision de outra instalacao. Nao foi alterada.'}
 $plano=Plano-Inicializacao $Modo
 if($plano.CriarTarefa){
  if(!$Credencial){throw 'O modo computador exige a credencial da conta do dono (ContaPersonalizada).'}
  $node=Localizar-NodeMaquina $NodeExecutavel
  if(!(Test-Path -LiteralPath (Join-Path (Split-Path $node) 'npm.cmd') -PathType Leaf)){throw 'npm.cmd nao encontrado ao lado do Node instalado na maquina.'}
  $r=Executar-NativoOperacao $node @((Join-Path $Raiz 'portal/scripts/versao-node.mjs'));if($r.codigo-ne0){throw 'A tarefa exige o major Node do Portal e a versao minima definida em engines.node.'};$r.saida|ForEach-Object {Write-Warning $_}
  $cfg=Ler-ConfigOperacao (Join-Path $Privado 'portal\configuracao\portal.env');Validar-BackupSemLogin 'computador' $cfg['BACKUP_NETWORK_DIR']
  $conta=$Credencial.UserName
  if(!(Testar-ContaAdministradora $conta)){throw 'A conta da tarefa deve ser administradora local. Peca a TI a permissao antes de configurar.'}
  Liberar-AcessoOperacao $Raiz $Privado $conta
  $xml=Montar-DefinicaoTarefa $Raiz $Privado $node "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" $conta
  try{
   $senha=$null
   try{$senha=$Credencial.GetNetworkCredential().Password;Register-ScheduledTask -TaskName 'Supply Vision' -TaskPath '\' -Xml $xml -User $conta -Password $senha -Force|Out-Null}
   finally{$senha=$null}
  $servico=New-Object -ComObject 'Schedule.Service';$servico.Connect()
  $tarefa=$servico.GetFolder('\').GetTask('Supply Vision')
  $sid=(Get-LocalGroup -Name 'Supply Vision Operadores' -ErrorAction Stop).SID.Value
  $sddl=$tarefa.GetSecurityDescriptor(4)
  $tarefa.SetSecurityDescriptor(($sddl+'(A;;GRGX;;;'+$sid+')'),0)
  }catch{
   # Remove somente a tarefa criada nesta tentativa se a ativacao falhar.
   if(!$t){Unregister-ScheduledTask -TaskName 'Supply Vision' -TaskPath '\' -Confirm:$false -ErrorAction SilentlyContinue}
   throw
  }
 }
 if($plano.RemoverTarefa-and$t){Unregister-ScheduledTask -TaskName 'Supply Vision' -TaskPath '\' -Confirm:$false}
}
function Iniciar-OperacaoConfigurada([string]$Raiz) {
 $ErrorActionPreference='Stop'
 if(Obter-TarefaSupplyVision $Raiz){Start-ScheduledTask -TaskName 'Supply Vision' -TaskPath '\';$global:LASTEXITCODE=0;return}
 Start-Process powershell.exe -WindowStyle Hidden -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "'+(Join-Path $Raiz 'scripts/supervisor.ps1')+'"') -ErrorAction Stop
 $global:LASTEXITCODE=0
}
function Acrescentar-ComandoSupvAoPath([string]$Raiz,[string]$Atual) {
 $raizPath=[IO.Path]::GetFullPath($Raiz).TrimEnd('\','/')
 $partes=@($Atual-split';'|Where-Object {$_})
 foreach($parte in $partes){
  $expandida=[Environment]::ExpandEnvironmentVariables($parte.Trim().Trim('"')).TrimEnd('\','/')
  if($expandida-eq$raizPath){return $Atual}
 }
 return ((@($partes)+$raizPath)-join';')
}
function Instalar-ComandoSupv([string]$Raiz) {
 $atual=[Environment]::GetEnvironmentVariable('Path','User')
 $novo=Acrescentar-ComandoSupvAoPath $Raiz $atual
 if($novo-ceq$atual){return}
 [Environment]::SetEnvironmentVariable('Path',$novo,'User')
 Write-Host 'Comando supv adicionado ao PATH do usuario. Abra um terminal novo para usar supv.'
}
