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
function Obter-ModoInicializacao([string]$Raiz,[string]$Startup) {
 if(Obter-TarefaSupplyVision $Raiz){return 'computador'}
 if($Startup-and(Test-Path -LiteralPath $Startup)){return 'login'}
 return 'desligado'
}
function Plano-Inicializacao([ValidateSet('desligado','login','computador')][string]$Modo) {
 return @{CriarTarefa=($Modo-eq'computador');RemoverTarefa=($Modo-ne'computador');CriarAtalho=($Modo-eq'login');RemoverAtalho=($Modo-ne'login')}
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
 throw 'Node instalado na maquina nao encontrado. Instale Node >= 22.13 para todos os usuarios ou informe seu caminho absoluto.'
}
function Validar-BackupSemLogin([string]$Modo,[string]$Caminho) {
 if($Modo-eq'computador'-and$Caminho-and$Caminho-notmatch '^\\\\[^\\]+\\[^\\]+'){
  throw 'BACKUP_NETWORK_DIR no modo sem login deve ser UNC (\\servidor\pasta), nunca letra de unidade como Z:\.'
 }
}
function Montar-DefinicaoTarefa([string]$Raiz,[string]$Privado,[string]$Node,[string]$PowerShell,[string]$Conta='SYSTEM') {
 foreach($c in @($Raiz,$Privado,$Node,$PowerShell)){if($c-notmatch '^(?:[A-Za-z]:\\|\\\\)'){throw 'A tarefa exige caminhos Windows absolutos.'}}
 $args='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+($Raiz.TrimEnd('\')+'\scripts\supervisor.ps1')+'" -SemLogin -NodeExecutavel "'+$Node+'" -PastaPrivada "'+$Privado+'"'
 $usuario=if($Conta-eq'SYSTEM'){'S-1-5-18'}else{$Conta}
 # No XML, SYSTEM omite LogonType; ServiceAccount existe apenas na API COM/CIM.
 $logon=if($Conta-eq'SYSTEM'){''}else{'<LogonType>Password</LogonType>'}
 $u=[Security.SecurityElement]::Escape($usuario);$a=[Security.SecurityElement]::Escape($args);$exe=[Security.SecurityElement]::Escape($PowerShell);$cwd=[Security.SecurityElement]::Escape($Raiz)
 return @"
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
 <Triggers><BootTrigger><Enabled>true</Enabled><Delay>PT1M</Delay></BootTrigger></Triggers>
 <Principals><Principal id="Operacao"><UserId>$u</UserId>$logon<RunLevel>HighestAvailable</RunLevel></Principal></Principals>
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
 if($Conta-in@('SYSTEM','S-1-5-18','NT AUTHORITY\SYSTEM')){return $true}
 $sid=if($Conta-match '^S-1-'){$Conta}else{(New-Object Security.Principal.NTAccount($Conta)).Translate([Security.Principal.SecurityIdentifier]).Value}
 $membros=@(Get-LocalGroupMember -SID 'S-1-5-32-544' -ErrorAction Stop|ForEach-Object {$_.SID.Value})
 if($sid-in$membros){return $true}
 return !!(@(Obter-GruposAutorizadosConta $Conta|Where-Object {$_-in$membros}).Count)
}
function Preparar-GrupoOperadores([string]$Conta='SYSTEM') {
 $nome='Supply Vision Operadores'
 $grupo=Get-LocalGroup -Name $nome -ErrorAction SilentlyContinue
 if(!$grupo){$grupo=New-LocalGroup -Name $nome -Description 'Operadores Supply Vision'}
 $membros=@(Get-LocalGroupMember -SID 'S-1-5-32-544' -ErrorAction Stop)
 if($Conta-ne'SYSTEM'){$membros+=@{SID=(New-Object Security.Principal.NTAccount($Conta)).Translate([Security.Principal.SecurityIdentifier])}}
 $existentes=@(Get-LocalGroupMember -Group $nome -ErrorAction Stop|ForEach-Object {$_.SID.Value})
 foreach($m in $membros){if($m.SID.Value-notin$existentes){Add-LocalGroupMember -Group $nome -Member $m.SID.Value -ErrorAction Stop;$existentes+=$m.SID.Value}}
 return $grupo.SID.Value
}
function Liberar-AcessoOperacao([string]$Raiz,[string]$Privado,[string]$Conta='SYSTEM') {
 $sid=Preparar-GrupoOperadores $Conta
 $regras=@('*S-1-5-18:(OI)(CI)F','*S-1-5-32-544:(OI)(CI)F',('*'+$sid+':(OI)(CI)M'))
 if($Conta-ne'SYSTEM'){$regras+=($Conta+':(OI)(CI)M')}
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
function Definir-ModoInicializacao([string]$Raiz,[string]$Privado,[string]$Startup,[ValidateSet('desligado','login','computador')][string]$Modo,[string]$NodeExecutavel,[pscredential]$Credencial) {
 $ErrorActionPreference='Stop'
 if(!(Testar-Elevacao)){throw 'Alterar a inicializacao exige PowerShell elevado (Executar como administrador).'}
 if(Test-Path (Join-Path $Privado 'operacao\supervisor.lock')){
  if(!(Testar-SupervisorEncerrado $Privado)){throw 'Pare a operacao e aguarde seu encerramento antes de mudar o modo.'}
 }
 $t=Get-ScheduledTask -TaskName 'Supply Vision' -TaskPath '\' -ErrorAction SilentlyContinue
 if($t-and!(Obter-TarefaSupplyVision $Raiz)){throw 'Ja existe uma tarefa Supply Vision de outra instalacao. Nao foi alterada.'}
 $plano=Plano-Inicializacao $Modo
 if($plano.CriarTarefa){
  $node=Localizar-NodeMaquina $NodeExecutavel
  if(!(Test-Path -LiteralPath (Join-Path (Split-Path $node) 'npm.cmd') -PathType Leaf)){throw 'npm.cmd nao encontrado ao lado do Node instalado na maquina.'}
  $r=Executar-NativoOperacao $node @('--version');$v=($r.stdout-join"`n").Trim();if($r.codigo-ne0-or$v-notmatch '^v(\d+\.\d+\.\d+)' -or [version]$Matches[1]-lt[version]'22.13.0'){throw 'A tarefa exige Node >= 22.13.'}
  $cfg=Ler-ConfigOperacao (Join-Path $Privado 'portal\configuracao\portal.env');Validar-BackupSemLogin 'computador' $cfg['BACKUP_NETWORK_DIR']
  $conta=if($Credencial){$Credencial.UserName}else{'SYSTEM'}
  if(!(Testar-ContaAdministradora $conta)){throw 'A conta da tarefa deve ser administradora local. Peca a TI a permissao antes de configurar.'}
  Liberar-AcessoOperacao $Raiz $Privado $conta
  $xml=Montar-DefinicaoTarefa $Raiz $Privado $node "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" $conta
  try{
  if($Credencial){
   $senha=$null
   try{$senha=$Credencial.GetNetworkCredential().Password;Register-ScheduledTask -TaskName 'Supply Vision' -TaskPath '\' -Xml $xml -User $conta -Password $senha -Force|Out-Null}
   finally{$senha=$null}
  }else{Register-ScheduledTask -TaskName 'Supply Vision' -TaskPath '\' -Xml $xml -Force|Out-Null}
  $servico=New-Object -ComObject 'Schedule.Service';$servico.Connect()
  $tarefa=$servico.GetFolder('\').GetTask('Supply Vision')
  $sid=(Get-LocalGroup -Name 'Supply Vision Operadores' -ErrorAction Stop).SID.Value
  $sddl=$tarefa.GetSecurityDescriptor(4)
  $tarefa.SetSecurityDescriptor(($sddl+'(A;;GRGX;;;'+$sid+')'),0)
  if(Test-Path -LiteralPath $Startup){Remove-Item -LiteralPath $Startup -Force}
  }catch{
   # Se a ativacao nova falhar, nao deixa tarefa junto com o antigo atalho.
   if(!$t){Unregister-ScheduledTask -TaskName 'Supply Vision' -TaskPath '\' -Confirm:$false -ErrorAction SilentlyContinue}
   throw
  }
 }
 if($plano.RemoverTarefa-and$t){Unregister-ScheduledTask -TaskName 'Supply Vision' -TaskPath '\' -Confirm:$false}
 if($plano.CriarAtalho){
  $linha=Montar-InicializacaoLogin $Raiz
  [IO.File]::WriteAllText($Startup,$linha,[Text.Encoding]::ASCII)
 }elseif($plano.RemoverAtalho-and(Test-Path -LiteralPath $Startup)){Remove-Item -LiteralPath $Startup -Force}
}
function Iniciar-OperacaoConfigurada([string]$Raiz) {
 $ErrorActionPreference='Stop'
 Exigir-InstalacaoNaoMigrada (Obter-PastaPrivada $Raiz)
 if(Obter-TarefaSupplyVision $Raiz){Start-ScheduledTask -TaskName 'Supply Vision' -TaskPath '\';$global:LASTEXITCODE=0;return}
 Start-Process powershell.exe -WindowStyle Hidden -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "'+(Join-Path $Raiz 'scripts/supervisor.ps1')+'"') -ErrorAction Stop
 $global:LASTEXITCODE=0
}
function Aviso-SessaoRemota([string]$Modo,[bool]$Remota) {
 if($Modo-eq'login'-and$Remota){return 'Na sessão RDP, use Desconectar; não use Sair. Sair encerra a operação neste modo.'}
 return ''
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
function Remover-ComandoSvLegado([string]$Raiz) {
 $legado=Join-Path $Raiz 'sv.cmd'
 if(Test-Path -LiteralPath $legado -PathType Leaf){Remove-Item -LiteralPath $legado -Force -ErrorAction Stop}
}
function Instalar-ComandoSupv([string]$Raiz) {
 Remover-ComandoSvLegado $Raiz
 Atualizar-EntradasLegadas $Raiz
 $atual=[Environment]::GetEnvironmentVariable('Path','User')
 $novo=Acrescentar-ComandoSupvAoPath $Raiz $atual
 if($novo-ceq$atual){return}
 [Environment]::SetEnvironmentVariable('Path',$novo,'User')
 Write-Host 'Comando supv adicionado ao PATH do usuario. Abra um terminal novo para usar supv.'
}

function Montar-InicializacaoLogin([string]$Raiz) {
 return "@echo off`r`ncall `"$(Join-Path $Raiz 'supv.cmd')`" iniciar`r`n"
}

# Somente alvos aposentados desta instalacao, nunca atalhos de outras pastas.
function Testar-AlvoAtalhoAposentado([string]$Raiz,[string]$Alvo,[string]$Argumentos) {
 $alvos=@(('Supply Vision'+'.bat'),('INICIAR'+'.bat'),('PARAR'+'.bat'),('scripts/central'+'.ps1'),('portal/Restringir Acesso da Rede'+'.cmd'))
 foreach($relativo in $alvos){
  $caminho=[IO.Path]::GetFullPath((Join-Path $Raiz $relativo))
  if(Test-Path -LiteralPath $caminho){continue}
  if($Alvo-eq$caminho){return $true}
  # O instalador pode usar powershell.exe -File, com caminho absoluto citado.
  if([IO.Path]::GetFileName($Alvo)-in@('powershell.exe','pwsh.exe')-and$Argumentos-match('(?i)(?:^|\s)-File\s+"'+[regex]::Escape($caminho)+'"\s*$')){return $true}
 }
 return $false
}
function Atualizar-EntradasLegadas([string]$Raiz,[string[]]$Desktops=@([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('CommonDesktopDirectory')),[string]$Inicio=[Environment]::GetFolderPath('Startup')) {
 if($env:OS-ne'Windows_NT'){return}
 $shell=$null
 try{
  $shell=New-Object -ComObject WScript.Shell
  foreach($desktop in @($Desktops|Select-Object -Unique)){
   if(!$desktop-or!(Test-Path -LiteralPath $desktop)){continue}
   foreach($arquivo in @(Get-ChildItem -LiteralPath $desktop -Filter 'Supply Vision*.lnk' -File)){
    if($arquivo.Name-notin@('Supply Vision.lnk','Supply Vision - Homologacao.lnk')){continue}
    $atalho=$null
    try{
     $atalho=$shell.CreateShortcut($arquivo.FullName)
     if(Testar-AlvoAtalhoAposentado $Raiz $atalho.TargetPath $atalho.Arguments){Remove-Item -LiteralPath $arquivo.FullName -Force -ErrorAction Stop}
    }finally{if($atalho){[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($atalho)}}
   }
  }
 }finally{if($shell){[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)}}
 if($Inicio){
  $arquivo=Join-Path $inicio 'Supply Vision.cmd'
  $legado="@echo off`r`nstart `"`" `"$(Join-Path $Raiz ('INICIAR'+'.bat'))`"`r`n"
  if((Test-Path -LiteralPath $arquivo)-and[IO.File]::ReadAllText($arquivo)-eq$legado){
   [IO.File]::WriteAllText($arquivo,(Montar-InicializacaoLogin $Raiz),[Text.Encoding]::ASCII)
  }
 }
}
