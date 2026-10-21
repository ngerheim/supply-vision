[CmdletBinding()]
param([string]$PastaPrivada)
$ErrorActionPreference='Stop'
$raiz=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
. (Join-Path $PSScriptRoot 'inicializacao-logica.ps1')
. (Join-Path $PSScriptRoot 'avisos-admin.ps1')
if($PastaPrivada){$env:SUPPLY_VISION_PRIVADO=$PastaPrivada}
$privado=Obter-PastaPrivada $raiz
$log=Join-Path $privado 'operacao/supervisor.log'
$clienteHealth=$null
function Log([string]$Texto){Add-Content -LiteralPath $log "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') VIGILANCIA: $Texto" -Encoding UTF8}
try{
 $config=Ler-ConfigOperacao (Join-Path $privado 'comum/operacao.env')
 if(!$config['ADMIN_ALERTA_EMAIL']){return}
 $ensaio=Aplicar-ModoEnsaio $config
 $node=Localizar-NodeMaquina
 $controle=Novo-ControleAvisosAdmin $config $ensaio $node (Join-Path $raiz 'portal')
 $tarefa=Obter-TarefaSupplyVision $raiz
 $falha=$false
 if($tarefa){$info=Get-ScheduledTaskInfo -TaskName 'Supply Vision' -TaskPath '\';$falha=!!(Obter-FalhaLogonTarefa ([long]$info.LastTaskResult)) -or ($tarefa.State-ne'Running'-and$info.LastTaskResult-ne0)}else{$falha=$true}
 $saudavel=$false
 try{
  $cfgPortal=Ler-ConfigOperacao (Join-Path $privado 'portal/configuracao/portal.env')
  $clienteHealth=Novo-ClienteHealth
  $saudavel=(Consultar-HealthLocal $clienteHealth ('http://127.0.0.1:'+(Obter-PortaPortalLocal $cfgPortal)+'/api/health')).saudavel
 }catch{}
 $evento=Obter-EventoVigilancia $falha $saudavel
 if($evento){Avisar-Administrador $controle $evento}
 while($controle.Pendentes.Count){Atualizar-AvisosAdmin $controle;Start-Sleep -Milliseconds 500}
}catch{Log 'Falha na verificacao diaria; confira configuracao, tarefa e permissoes.'}
finally{if($clienteHealth){$clienteHealth.cliente.Dispose()};if($controle){Encerrar-AvisosAdmin $controle}}
