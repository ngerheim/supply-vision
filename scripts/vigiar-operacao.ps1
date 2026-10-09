[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$raiz=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
. (Join-Path $PSScriptRoot 'inicializacao-logica.ps1')
. (Join-Path $PSScriptRoot 'avisos-admin.ps1')
$privado=Obter-PastaPrivada $raiz
$log=Join-Path $privado 'operacao/supervisor.log'
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
 try{$saudavel=(Invoke-RestMethod 'http://127.0.0.1:3000/api/health' -TimeoutSec 5).status-eq'ok'}catch{}
 $evento=Obter-EventoVigilancia $falha $saudavel
 if($evento){Avisar-Administrador $controle $evento}
 while($controle.Pendentes.Count){Atualizar-AvisosAdmin $controle;Start-Sleep -Milliseconds 500}
}catch{Log 'Falha na verificacao diaria; confira configuracao, tarefa e permissoes.'}
finally{if($controle){Encerrar-AvisosAdmin $controle}}
