$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'inicializacao-logica.ps1')
$xml=[xml](Montar-DefinicaoTarefa 'C:\Supply Vision' 'C:\Supply Vision\privado' 'C:\Program Files\nodejs\node.exe' 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' 'DOMINIO\operador')
if($xml.Task.Principals.Principal.UserId-ne'DOMINIO\operador'-or$xml.Task.Principals.Principal.LogonType-ne'Password'){throw 'Conta de usuario incorreta.'}
if($xml.Task.Triggers.BootTrigger.Delay-ne'PT1M'){throw 'Atraso incorreto.'}
if($xml.Task.Settings.ExecutionTimeLimit-ne'PT0S'-or$xml.Task.Settings.MultipleInstancesPolicy-ne'IgnoreNew'){throw 'Limites incorretos.'}
if($xml.Task.Settings.RestartOnFailure.Interval-ne'PT1M'-or$xml.Task.Settings.RestartOnFailure.Count-ne'3'){throw 'Reinicio incorreto.'}
if($xml.Task.Actions.Exec.Arguments-notlike '*-SemLogin*'-or$xml.Task.Actions.Exec.Arguments-notlike '*"C:\Program Files\nodejs\node.exe"*'){throw 'Argumentos sem caminhos absolutos.'}
if($xml.Task.Actions.Exec.Command-ne'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'-or$xml.Task.Actions.Exec.WorkingDirectory-ne'C:\Supply Vision'){throw 'Comando ou diretorio incorreto.'}
$falhou=$false;try{Montar-DefinicaoTarefa 'C:\SV' 'C:\SV\privado' 'C:\Node\node.exe' 'C:\Windows\powershell.exe' 'SYSTEM'}catch{$falhou=$true}
if(!$falhou){throw 'Criacao de tarefa SYSTEM foi aceita.'}
foreach($modo in @('desligado','computador')){
 $p=Plano-Inicializacao $modo
 if($p.CriarTarefa-ne($modo-eq'computador')-or$p.RemoverTarefa-ne($modo-eq'desligado')){throw 'Plano de inicializacao incorreto.'}
 Validar-BackupSemLogin $modo ''
 Validar-BackupSemLogin $modo '\\servidor\pasta'
 if($modo-ne'computador'){Validar-BackupSemLogin $modo 'Z:\backup'}else{
  $falhou=$false;try{Validar-BackupSemLogin $modo 'Z:\backup'}catch{$falhou=$true}
  if(!$falhou){throw 'Unidade mapeada foi aceita sem login.'}
 }
}
. (Join-Path $PSScriptRoot 'notificacao.ps1')
$script:avisos=@();function Log([string]$Texto){$script:avisos+=$Texto}
if(Notificar 'teste' 'teste' $false){throw 'Toast sem sessao interativa foi aceito.'}
if(!$script:avisos.Count){throw 'Ausencia de sessao nao foi registrada.'}
# Fixture no formato exato gerado pela versao atual, com principal desconhecido.
$raizTeste=Join-Path ([IO.Path]::GetTempPath()) 'sv-tarefa-existente'
$definicaoExistente=[xml](Montar-DefinicaoTarefa $raizTeste (Join-Path $raizTeste 'privado') 'C:\Node\node.exe' "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" 'DOMINIO\ficticio')
$acaoExistente=$definicaoExistente.Task.Actions.Exec
$script:tarefaExistente=@{Actions=@{Execute=$acaoExistente.Command;Arguments=$acaoExistente.Arguments;WorkingDirectory=$acaoExistente.WorkingDirectory};Principal=@{UserId='SID-preservado';LogonType='desconhecido'}}
function Get-ScheduledTask {return $script:tarefaExistente}
function Register-ScheduledTask {throw 'Nao pode reconfigurar a tarefa existente.'}
function Get-Credential {throw 'Nao pode pedir credencial para reconhecer/iniciar.'}
function Start-ScheduledTask {$script:iniciouExistente=$true}
if((Obter-ModoInicializacao $raizTeste)-ne'computador'){throw 'Tarefa existente nao reconhecida.'}
Iniciar-OperacaoConfigurada $raizTeste
if(!$script:iniciouExistente){throw 'Tarefa existente nao iniciou.'}
. (Join-Path $PSScriptRoot 'administracao-logica.ps1')
function Get-ScheduledTaskInfo {return @{LastTaskResult=0}}
if((Consultar-TarefaAdministrada $raizTeste).modo-ne'computador'){throw 'Consulta recusou tarefa existente.'}
& {
 function Testar-Elevacao {return $true}
 function Unregister-ScheduledTask {throw 'ALTEROU TAREFA ALHEIA'}
 $legitima=$script:tarefaExistente
 try{
  $falhas=@()
  foreach($caso in @('executavel','sufixo','argumento','raiz','multiplas')){
   $acao=@{Execute=$acaoExistente.Command;Arguments=$acaoExistente.Arguments;WorkingDirectory=$acaoExistente.WorkingDirectory}
   switch($caso){
    'executavel' {$acao.Execute='C:\alheio\powershell.exe'}
    'sufixo' {$acao.Arguments=$acao.Arguments.Replace('supervisor.ps1','supervisor.ps1.alheio')}
    'argumento' {$acao.Arguments='-Command Write-Output "'+(Join-Path $raizTeste 'scripts\supervisor.ps1')+'"'}
    'raiz' {$acao.WorkingDirectory='C:\alheio'}
   }
   $script:tarefaExistente=@{Actions=@($acao)}
   if($caso-eq'multiplas'){$script:tarefaExistente.Actions+=@{Execute='alheio';Arguments='';WorkingDirectory=$raizTeste}}
   if(Obter-TarefaSupplyVision $raizTeste){$falhas+="reconheceu $caso"}
   if((Consultar-TarefaAdministrada $raizTeste).modo-eq'computador'){$falhas+="consulta reconheceu $caso"}
   foreach($modo in @('desligado','computador')){
    $recusou=$false;try{Definir-ModoInicializacao $raizTeste $raizTeste $modo}catch{$recusou=$_.Exception.Message-like'*outra instalacao*'}
    if(!$recusou){$falhas+="$modo nao recusou $caso"}
   }
  }
  if($falhas.Count){throw ($falhas-join'; ')}
 }finally{$script:tarefaExistente=$legitima}
}
& {
 $codigo=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'configurar-vigilancia.ps1')).Replace(". (Join-Path `$PSScriptRoot 'inicializacao-logica.ps1')",'')
 $codigo=$codigo.Replace('$PSScriptRoot',("'"+$PSScriptRoot+"'"))
 function Testar-Elevacao {return $true}
 function Testar-ContaAdministradora {return $true}
 $script:tarefaVigilanciaTeste=@{Actions=@{Execute='alheio';Arguments='alheio';WorkingDirectory='C:\alheio'}}
 function Get-ScheduledTask {return $script:tarefaVigilanciaTeste}
 function Unregister-ScheduledTask {$script:mutouVigilancia=$true}
 function Register-ScheduledTask {$script:mutouVigilancia=$true}
 function New-ScheduledTaskAction {}
 function New-ScheduledTaskTrigger {}
 function New-ScheduledTaskSettingsSet {}
 $senha=ConvertTo-SecureString 'ficticia' -AsPlainText -Force
 $credencial=[pscredential]::new('DOMINIO\ficticio',$senha)
 foreach($desligar in @($true,$false)){
  $script:mutouVigilancia=$false;$recusou=$false
  try{& ([scriptblock]::Create($codigo)) -Desligar:$desligar -CredencialTarefa $credencial}catch{$recusou=$_.Exception.Message-like'*outra instalacao*'}
  if(!$recusou-or$script:mutouVigilancia){throw 'Vigilancia alterou tarefa homonima alheia.'}
 }
 # Acao da versao atual, anterior ao transporte explicito de PastaPrivada.
 $script:tarefaVigilanciaTeste=@{Actions=@{Execute="$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe";Arguments=('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+(Join-Path $PSScriptRoot 'vigiar-operacao.ps1')+'"');WorkingDirectory=(Split-Path $PSScriptRoot)}}
 foreach($desligar in @($true,$false)){
  $script:mutouVigilancia=$false
  & ([scriptblock]::Create($codigo)) -Desligar:$desligar -CredencialTarefa $credencial
  if(!$script:mutouVigilancia){throw 'Vigilancia nao operou sobre a acao legada da instalacao.'}
 }
}
$script:tarefaExistente.Actions.Arguments='-File outra-instalacao.ps1'
if(Obter-TarefaSupplyVision $raizTeste){throw 'Tarefa de outra instalacao reconhecida.'}
function Testar-Elevacao {return $true}
$falhou=$false;try{Definir-ModoInicializacao $raizTeste $raizTeste 'desligado'}catch{$falhou=$_.Exception.Message-like'*outra instalacao*'}
if(!$falhou){throw 'Desativacao alterou tarefa alheia.'}
$script:tarefaExistente=$null
$falhou=$false;try{Definir-ModoInicializacao $raizTeste $raizTeste 'computador'}catch{$falhou=$_.Exception.Message-like'*credencial*'}
if(!$falhou){throw 'Computador sem conta foi aceito.'}
Write-Host 'Tarefa existente aceita sem reconfiguracao; tarefa alheia e criacao sem conta recusadas.'
$script:chamadas=@()
function Obter-TarefaSupplyVision([string]$Raiz){return @{Actions='ficticia'}}
function Start-ScheduledTask([string]$TaskName,[string]$TaskPath){$script:chamadas+=$TaskName}
Iniciar-OperacaoConfigurada 'ficticio'
if($script:chamadas.Count-ne1-or$script:chamadas[0]-ne'Supply Vision'){throw 'Inicio nao encaminhou para a tarefa.'}
function Start-ScheduledTask {throw 'sem permissao simulada'}
$falhou=$false;try{Iniciar-OperacaoConfigurada 'ficticio'}catch{$falhou=$true}
if(!$falhou){throw 'Falha da tarefa foi ignorada pelo supv.'}
Write-Host 'Inicializacao: tarefa, contas, exclusao, UNC e notificacao aprovados.'

function Obter-TarefaSupplyVision {return $null}
$script:inicioDireto=$null
function Start-Process {param($FilePath,$WindowStyle,$ArgumentList,$ErrorAction) $script:inicioDireto=@($FilePath,$WindowStyle,$ArgumentList)}
Iniciar-OperacaoConfigurada (Join-Path ([IO.Path]::GetTempPath()) 'Supply Vision teste')
if($script:inicioDireto[0]-ne'powershell.exe'-or$script:inicioDireto[1]-ne'Hidden'-or$script:inicioDireto[2]-notmatch'-File "[^"]+supervisor.ps1"'){throw 'Inicio direto perdeu caminho citado ou janela oculta.'}
function Start-Process {throw 'partida recusada'}
$falhou=$false;try{Iniciar-OperacaoConfigurada 'ficticio'}catch{$falhou=$_.Exception.Message-eq'partida recusada'}
if(!$falhou){throw 'Falha de inicio direto foi ignorada.'}
Write-Host 'Inicio direto, caminhos com espacos, falha via supv aprovados.'

# Executa o ramo real de inicializacao com aviso de versao nativo simulado.
& {
 . (Join-Path $PSScriptRoot 'inicializacao-logica.ps1')
 function Testar-Elevacao {return $true}
 function Testar-SupervisorEncerrado {return $true}
 function Get-ScheduledTask {return $null}
 function Localizar-NodeMaquina {return 'C:\ficticio\node.exe'}
 function Test-Path {param($LiteralPath,$Path,$PathType);return $true}
 function Executar-NativoOperacao {return @{codigo=0;saida=@('aviso de versao ficticio');stdout=@()}}
 function Ler-ConfigOperacao {return @{BACKUP_NETWORK_DIR=''}}
 function Testar-ContaAdministradora {return $true}
 function Liberar-AcessoOperacao {}
 function Montar-DefinicaoTarefa {return '<Task />'}
 function Register-ScheduledTask {throw 'registro ficticio interrompido antes de COM'}
 function Unregister-ScheduledTask {}
 $senha=New-Object Security.SecureString
 $senha.AppendChar('x')
 try{
  $credencial=[pscredential]::new('DOMINIO\ficticio',$senha)
  $avisos=@(& {
   try{Definir-ModoInicializacao 'C:\ficticio' 'C:\ficticio\dados' 'computador' -Credencial $credencial;throw 'Registro ficticio nao foi chamado.'}
   catch{if($_.Exception.Message-ne'registro ficticio interrompido antes de COM'){throw}}
  } 3>&1)
  if($avisos.Count-ne1-or$avisos[0]-isnot[Management.Automation.WarningRecord]-or[string]$avisos[0]-ne'aviso de versao ficticio'){throw 'Inicializacao perdeu o aviso nativo de versao.'}
 }finally{$senha.Dispose()}
}
Write-Host 'Aviso nativo de versao preservado sem registrar tarefa real.'
