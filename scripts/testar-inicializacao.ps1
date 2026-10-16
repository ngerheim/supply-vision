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
# Tarefa preexistente com propriedades desconhecidas continua valida pelo caminho.
$raizTeste=Join-Path ([IO.Path]::GetTempPath()) 'sv-tarefa-existente'
$script:tarefaExistente=@{Actions=@{Arguments=('-File "'+(Join-Path $raizTeste 'scripts\supervisor.ps1')+'" -ParametroAntigo')};Principal=@{UserId='SID-preservado';LogonType='desconhecido'}}
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
