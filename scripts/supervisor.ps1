[CmdletBinding()]
param([switch]$Visivel)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
. (Join-Path $PSScriptRoot 'notificacao.ps1')
$Raiz=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Privado=Join-Path $Raiz 'privado';$Portal=Join-Path $Raiz 'portal';$Alertas=Join-Path $Raiz 'alertas'
$Operacao=Join-Path $Privado 'operacao';New-Item -ItemType Directory -Force $Operacao|Out-Null
try { & (Join-Path $PSScriptRoot 'validar-operacao.ps1') -Raiz $Raiz }
catch { Add-Content (Join-Path $Operacao 'supervisor.log') "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  ERRO DE CONFIGURACAO: $($_.Exception.Message)"; throw }
$LockFile=Join-Path $Operacao 'supervisor.lock'
try { $LockHandle=[IO.File]::Open($LockFile,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None) }
catch { Write-Host 'A operacao ja esta ativa.'; exit 0 }
$PidFile=Join-Path $Operacao 'supervisor.pid.json';$EstadoFile=Join-Path $Operacao 'estado.json';$StatusFile=Join-Path $Operacao 'status.json';$PararFile=Join-Path $Operacao 'parar.sinal';$Log=Join-Path $Operacao 'supervisor.log'
function Log([string]$m){$l="$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m";if($Visivel){Write-Host $l};Add-Content $Log $l -Encoding UTF8;$linhas=@(Get-Content $Log -ErrorAction SilentlyContinue);if($linhas.Count-gt1200){$linhas|Select-Object -Last 1000|Set-Content $Log -Encoding UTF8}}
function Vivo([int]$id){return $null-ne(Get-Process -Id $id -ErrorAction SilentlyContinue)}
if(Test-Path $PidFile){
 try{$ant=Get-Content $PidFile -Raw|ConvertFrom-Json;$proc=Get-Process -Id ([int]$ant.pid) -ErrorAction Stop;$inicio=[datetime]::Parse($ant.inicio).ToUniversalTime();if($proc.Path-eq(Get-Process -Id $PID).Path-and[Math]::Abs(($proc.StartTime.ToUniversalTime()-$inicio).TotalSeconds)-le2){Write-Host 'A operacao ja esta ativa.';exit 0}}catch{}
}
Remove-Item $PararFile -Force -ErrorAction SilentlyContinue
@{pid=$PID;inicio=(Get-Date).ToUniversalTime().ToString('o');raiz=$Raiz}|ConvertTo-Json -Compress|Set-Content $PidFile -Encoding UTF8
$config=Ler-ConfigOperacao (Join-Path $Privado 'comum\operacao.env')
$ManutencaoFile=Join-Path $Operacao 'manutencao.sinal'
$estado=@{};if(Test-Path $EstadoFile){try{$o=Get-Content $EstadoFile -Raw|ConvertFrom-Json;$o.psobject.Properties|ForEach-Object{$estado[$_.Name]=$_.Value}}catch{}}
function Salvar-Estado{
 $limite=(Get-Date).Date.AddDays(-14)
 foreach($k in @($estado.Keys)){if($k-match '-(\d{4}-\d{2}-\d{2})-' -and [datetime]$Matches[1]-lt$limite){$estado.Remove($k)}}
 $estado|ConvertTo-Json|Set-Content $EstadoFile -Encoding UTF8
}
$processos=@{}
function Iniciar-Processo([string]$nome,[string]$exe,[string[]]$argumentos,[string]$pasta){
 if($processos[$nome]-and!$processos[$nome].HasExited){return};$saida=Join-Path $Operacao "$nome-saida.log";$erro=Join-Path $Operacao "$nome-erro.log"
 $processos[$nome]=Start-Process $exe -ArgumentList $argumentos -WorkingDirectory $pasta -WindowStyle Hidden -PassThru -RedirectStandardOutput $saida -RedirectStandardError $erro;Log "$nome iniciado (PID $($processos[$nome].Id))."
}
function Encerrar($p){if($p-and!$p.HasExited){& taskkill.exe /PID $p.Id /T /F 2>$null|Out-Null}}
function Pode-Tentar([string]$tipo){$k="tentativa-$tipo";if(!$estado[$k]){return $true};return (Get-Date)-ge([datetime]$estado[$k]).AddMinutes(10)}
$Npm=(Get-Command npm.cmd).Source;$Node=(Get-Command node.exe).Source;$Python=Join-Path $Alertas '.venv\Scripts\python.exe'
$alerta=$null;$alertaChave='';$alertaHora='';$alertaRunId='';$backup=$null;$backupChave='';$limpeza=$null;$limpezaChave=''
$portalPronto=$false;$PortalUrl='http://127.0.0.1:3000'
# O trace store local do miniflare cresce sem limite (5,5 MB para 14,5 MB em
# tres dias de operacao) e NAO e controlado por "observability" no
# wrangler.json. A unica chave e esta variavel, lida direto do ambiente.
$env:X_LOCAL_OBSERVABILITY='false'
try{$linhaUrl=@(Get-Content (Join-Path $Privado 'portal\configuracao\portal.env') -ErrorAction Stop)|Where-Object{$_ -like 'PORTAL_URL=*'}|Select-Object -First 1;if($linhaUrl){$PortalUrl=($linhaUrl -split '=',2)[1].Trim()}}catch{}
try{
 Log 'Supervisor iniciado.'
 while(!(Test-Path $PararFile)){
  Iniciar-Processo 'portal' $Npm @('run','start:lan') $Portal;Iniciar-Processo 'emails' $Npm @('run','email:watch') $Portal
  $saudavel=$false;try{$saudavel=((Invoke-RestMethod "$PortalUrl/api/health" -TimeoutSec 3).status-eq'ok')}catch{$saudavel=$false}
  if($saudavel-and!$portalPronto){$portalPronto=$true;Log 'Portal pronto (health ok).';[void](Notificar 'Supply Vision' "Portal no ar em $PortalUrl")}
  elseif(!$saudavel-and$portalPronto){$portalPronto=$false;Log 'Portal deixou de responder.';[void](Notificar 'Supply Vision' 'O Portal parou de responder.')}
  if($alerta-and$alerta.HasExited){if($alerta.ExitCode-eq0){$estado[$alertaChave]=(Get-Date).ToString('o');Log "Alertas concluidos: $alertaChave."}else{Log "Alertas falharam (codigo $($alerta.ExitCode))."};$alerta=$null;Salvar-Estado;try{Start-Process $Python -ArgumentList 'processo\verificar_saude.py',$alertaHora.Replace(':',''),$alertaRunId -WorkingDirectory $Alertas -WindowStyle Hidden -Wait}catch{Log "Verificacao de saude nao executada: $($_.Exception.Message)"}}
  $manutencao=Test-Path $ManutencaoFile
  if(!$manutencao-and!$alerta){$agoraAlerta=Get-Date;$d=Obter-SlotDevido 'alertas' (Obter-HorariosDoDia $config 'ALERTAS_HORARIOS' $agoraAlerta) $estado $agoraAlerta;if($d-and(Pode-Tentar 'alertas')){$estado['tentativa-alertas']=(Get-Date).ToString('o');$alertaChave=$d.chave;$alertaHora=$d.hora;$alertaRunId=(Get-Date).ToString('yyyyMMdd_HHmmss')+'_'+[guid]::NewGuid().ToString('N').Substring(0,6);$env:SUPPLY_VISION_RUN_ID=$alertaRunId;try{$alerta=Start-Process $Python -ArgumentList 'processo\pipeline.py' -WorkingDirectory $Alertas -WindowStyle Hidden -PassThru}finally{Remove-Item Env:SUPPLY_VISION_RUN_ID -ErrorAction SilentlyContinue};Log "Alertas iniciados para $($d.hora) (execucao $alertaRunId, PID $($alerta.Id)).";Salvar-Estado}}
  if($backup-and$backup.HasExited){if($backup.ExitCode-eq0){$estado[$backupChave]=(Get-Date).ToString('o');Log "Backup concluido: $backupChave."}else{Log "Backup falhou (codigo $($backup.ExitCode))."};$backup=$null;Salvar-Estado}
  if(!$manutencao-and!$backup){$d=Obter-SlotDevido 'backup' $config.BACKUP_HORARIOS $estado (Get-Date);if($d-and(Pode-Tentar 'backup')){$estado['tentativa-backup']=(Get-Date).ToString('o');$backupChave=$d.chave;$backup=Start-Process $Node -ArgumentList 'scripts\backup.mjs' -WorkingDirectory $Portal -WindowStyle Hidden -PassThru;Log "Backup iniciado para $($d.hora) (PID $($backup.Id)).";Salvar-Estado}}
  if($limpeza-and$limpeza.HasExited){if($limpeza.ExitCode-eq0){$estado[$limpezaChave]=(Get-Date).ToString('o');Log 'Limpeza concluida.'}else{Log "Limpeza falhou (codigo $($limpeza.ExitCode))."};$limpeza=$null;Salvar-Estado}
  if(!$manutencao-and!$limpeza){$d=Obter-SlotDevido 'limpeza' $config.LIMPEZA_HORARIO $estado (Get-Date);if($d-and(Pode-Tentar 'limpeza')){$estado['tentativa-limpeza']=(Get-Date).ToString('o');$limpezaChave=$d.chave;$limpeza=Start-Process $Python -ArgumentList 'processo\limpeza.py' -WorkingDirectory $Alertas -WindowStyle Hidden -PassThru;Log "Limpeza iniciada (PID $($limpeza.Id)).";Salvar-Estado}}
  $livreGb=[math]::Round((Get-Item $Raiz).PSDrive.Free/1GB,1);$disco=if($livreGb-lt[double]$config.ESPACO_MINIMO_GB){'baixo'}else{'ok'}
  $hoje=(Get-Date).ToString('yyyy-MM-dd');if($disco-eq'baixo'-and$estado['aviso-disco']-ne$hoje){Log "ALERTA: apenas $livreGb GB livres no disco.";$estado['aviso-disco']=$hoje;Salvar-Estado}
  @{atualizado=(Get-Date).ToString('o');portal=!!($processos['portal']-and!$processos['portal'].HasExited);emails=!!($processos['emails']-and!$processos['emails'].HasExited);alertas=if($alerta){'executando'}elseif($manutencao){'pausados'}else{'aguardando'};backup=if($backup){'executando'}elseif($manutencao){'pausado'}else{'aguardando'};limpeza=if($limpeza){'executando'}elseif($manutencao){'pausada'}else{'aguardando'};manutencao=$manutencao;espacoLivreGb=$livreGb;disco=$disco}|ConvertTo-Json -Compress|Set-Content $StatusFile -Encoding UTF8
  Start-Sleep 15
 }
}catch{Log "ERRO FATAL: $($_.Exception.Message)";Log "Origem: $($_.ScriptStackTrace -replace '\s*\r?\n\s*',' | ')"}finally{@{atualizado=(Get-Date).ToString('o');portal=$false;emails=$false;alertas='parado';backup='parado';limpeza='parada';manutencao=$false;disco='desconhecido'}|ConvertTo-Json -Compress|Set-Content $StatusFile -Encoding UTF8;Log 'Encerrando a operacao.';if($portalPronto){[void](Notificar 'Supply Vision' 'Operacao encerrada. O Portal saiu do ar.')};foreach($p in $processos.Values){Encerrar $p};Encerrar $alerta;Encerrar $backup;Encerrar $limpeza;Remove-Item $PidFile,$PararFile -Force -ErrorAction SilentlyContinue;if($LockHandle){$LockHandle.Dispose()}}
