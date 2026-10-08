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
 $logon=if($Conta-eq'SYSTEM'){'ServiceAccount'}else{'Password'}
 $u=[Security.SecurityElement]::Escape($usuario);$a=[Security.SecurityElement]::Escape($args);$exe=[Security.SecurityElement]::Escape($PowerShell);$cwd=[Security.SecurityElement]::Escape($Raiz)
 return @"
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
 <Triggers><BootTrigger><Enabled>true</Enabled><Delay>PT1M</Delay></BootTrigger></Triggers>
 <Principals><Principal id="Operacao"><UserId>$u</UserId><LogonType>$logon</LogonType><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
 <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><AllowStartOnDemand>true</AllowStartOnDemand><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure></Settings>
 <Actions Context="Operacao"><Exec><Command>$exe</Command><Arguments>$a</Arguments><WorkingDirectory>$cwd</WorkingDirectory></Exec></Actions>
</Task>
"@
}
function Liberar-AcessoOperacao([string]$Raiz,[string]$Privado,[string]$Conta='SYSTEM') {
 $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
 $regras=@('*S-1-5-18:(OI)(CI)F','*S-1-5-32-544:(OI)(CI)F',('*'+$sid+':(OI)(CI)M'))
 if($Conta-ne'SYSTEM'){$regras+=($Conta+':(OI)(CI)M')}
 # Mantem ACLs existentes. Nenhum acesso para Everyone; heranca cobre novos arquivos.
 foreach($p in @($Raiz,$Privado)|Select-Object -Unique){
  & "$env:SystemRoot\System32\icacls.exe" $p /grant @regras /T /Q | Out-Null
  if($LASTEXITCODE){throw 'Falha ao preparar permissoes da operacao. A tarefa nao foi ativada.'}
 }
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
  $v=(& $node --version | Out-String).Trim();if($v-notmatch '^v(\d+\.\d+\.\d+)' -or [version]$Matches[1]-lt[version]'22.13.0'){throw 'A tarefa exige Node >= 22.13.'}
  $cfg=Ler-ConfigOperacao (Join-Path $Privado 'portal\configuracao\portal.env');Validar-BackupSemLogin 'computador' $cfg['BACKUP_NETWORK_DIR']
  $conta=if($Credencial){$Credencial.UserName}else{'SYSTEM'}
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
  $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
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
  $linha="@echo off`r`nstart `"`" `"$(Join-Path $Raiz 'INICIAR.bat')`"`r`n"
  [IO.File]::WriteAllText($Startup,$linha,[Text.Encoding]::ASCII)
 }elseif($plano.RemoverAtalho-and(Test-Path -LiteralPath $Startup)){Remove-Item -LiteralPath $Startup -Force}
}
function Iniciar-OperacaoConfigurada([string]$Raiz) {
 $ErrorActionPreference='Stop'
 if(Obter-TarefaSupplyVision $Raiz){Start-ScheduledTask -TaskName 'Supply Vision' -TaskPath '\';$global:LASTEXITCODE=0;return}
 & (Join-Path $Raiz 'INICIAR.bat') | Out-Null
}
function Aviso-SessaoRemota([string]$Modo,[bool]$Remota) {
 if($Modo-eq'login'-and$Remota){return 'Na sessão RDP, use Desconectar; não use Sair. Sair encerra a operação neste modo.'}
 return ''
}
