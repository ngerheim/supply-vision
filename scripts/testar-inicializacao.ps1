$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'inicializacao-logica.ps1')
$xml=[xml](Montar-DefinicaoTarefa 'C:\Supply Vision' 'C:\Supply Vision\privado' 'C:\Program Files\nodejs\node.exe' 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe')
if($xml.Task.Principals.Principal.UserId-ne'S-1-5-18'-or$xml.Task.Principals.Principal.LogonType-ne'ServiceAccount'){throw 'Conta SYSTEM incorreta.'}
if($xml.Task.Triggers.BootTrigger.Delay-ne'PT1M'){throw 'Atraso incorreto.'}
if($xml.Task.Settings.ExecutionTimeLimit-ne'PT0S'-or$xml.Task.Settings.MultipleInstancesPolicy-ne'IgnoreNew'){throw 'Limites incorretos.'}
if($xml.Task.Settings.RestartOnFailure.Interval-ne'PT1M'-or$xml.Task.Settings.RestartOnFailure.Count-ne'3'){throw 'Reinicio incorreto.'}
if($xml.Task.Actions.Exec.Arguments-notlike '*-SemLogin*'-or$xml.Task.Actions.Exec.Arguments-notlike '*"C:\Program Files\nodejs\node.exe"*'){throw 'Argumentos sem caminhos absolutos.'}
if($xml.Task.Actions.Exec.Command-ne'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'-or$xml.Task.Actions.Exec.WorkingDirectory-ne'C:\Supply Vision'){throw 'Comando ou diretorio incorreto.'}
$outra=[xml](Montar-DefinicaoTarefa 'C:\SV' 'C:\SV\privado' 'C:\Node\node.exe' 'C:\Windows\powershell.exe' 'DOMINIO\operador')
if($outra.Task.Principals.Principal.LogonType-ne'Password'-or$outra.Task.Principals.Principal.UserId-ne'DOMINIO\operador'){throw 'Conta personalizada incorreta.'}
foreach($modo in @('desligado','login','computador')){
 $p=Plano-Inicializacao $modo
 if($p.CriarTarefa-and$p.CriarAtalho){throw 'Modos simultaneos.'}
 if($modo-eq'computador'-and(!$p.CriarTarefa-or!$p.RemoverAtalho)){throw 'Tarefa nao exclui login.'}
 if($modo-eq'login'-and(!$p.CriarAtalho-or!$p.RemoverTarefa)){throw 'Login nao exclui tarefa.'}
 if($modo-eq'desligado'-and(!$p.RemoverTarefa-or!$p.RemoverAtalho)){throw 'Desligado nao remove ambos.'}
 Validar-BackupSemLogin $modo ''
 Validar-BackupSemLogin $modo '\\servidor\pasta'
 if($modo-ne'computador'){Validar-BackupSemLogin $modo 'Z:\backup'}else{
  $falhou=$false;try{Validar-BackupSemLogin $modo 'Z:\backup'}catch{$falhou=$true}
  if(!$falhou){throw 'Unidade mapeada foi aceita sem login.'}
 }
}
if(!(Aviso-SessaoRemota 'login' $true).Contains('Desconectar')){throw 'Aviso RDP ausente.'}
if((Aviso-SessaoRemota 'computador' $true)-or(Aviso-SessaoRemota 'login' $false)){throw 'Aviso RDP fora do modo.'}
. (Join-Path $PSScriptRoot 'notificacao.ps1')
$script:avisos=@();function Log([string]$Texto){$script:avisos+=$Texto}
if(Notificar 'teste' 'teste' $false){throw 'Toast sem sessao interativa foi aceito.'}
if(!$script:avisos.Count){throw 'Ausencia de sessao nao foi registrada.'}
$script:chamadas=@()
function Obter-TarefaSupplyVision([string]$Raiz){return @{Actions='ficticia'}}
function Start-ScheduledTask([string]$TaskName,[string]$TaskPath){$script:chamadas+=$TaskName}
Iniciar-OperacaoConfigurada 'ficticio'
if($script:chamadas.Count-ne1-or$script:chamadas[0]-ne'Supply Vision'){throw 'Inicio nao encaminhou para a tarefa.'}
function Start-ScheduledTask {throw 'sem permissao simulada'}
$falhou=$false;try{Iniciar-OperacaoConfigurada 'ficticio'}catch{$falhou=$true}
if(!$falhou){throw 'Falha da tarefa foi ignorada pela central.'}
Write-Host 'Inicializacao: tarefa, contas, exclusao, UNC, RDP e notificacao aprovados.'
