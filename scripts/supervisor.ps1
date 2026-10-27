[CmdletBinding()]
param([switch]$Visivel,[switch]$SemLogin,[string]$NodeExecutavel,[string]$PastaPrivada)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
. (Join-Path $PSScriptRoot 'notificacao.ps1')
. (Join-Path $PSScriptRoot 'avisos-admin.ps1')
. (Join-Path $PSScriptRoot 'inicializacao-logica.ps1')
if($PastaPrivada){$env:SUPPLY_VISION_PRIVADO=$PastaPrivada}
if($SemLogin){$env:SUPPLY_VISION_SEM_LOGIN='1';$NodeExecutavel=Localizar-NodeMaquina $NodeExecutavel;$env:Path=(Split-Path $NodeExecutavel)+';'+[Environment]::GetEnvironmentVariable('Path','Machine')}
$Raiz=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Privado=Obter-PastaPrivada $Raiz;$Portal=Join-Path $Raiz 'portal';$Alertas=Join-Path $Raiz 'alertas'
$Operacao=Join-Path $Privado 'operacao';New-Item -ItemType Directory -Force $Operacao|Out-Null
$ConfigOperacao=Join-Path $Privado 'comum\operacao.env'
try { & (Join-Path $PSScriptRoot 'validar-operacao.ps1') -Raiz $Raiz }
catch { Add-Content (Join-Path $Operacao 'supervisor.log') "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  ERRO DE CONFIGURACAO: $($_.Exception.Message)"; throw }
$LockFile=Join-Path $Operacao 'supervisor.lock'
try { $LockHandle=[IO.File]::Open($LockFile,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None) }
catch { Write-Host 'A operacao ja esta ativa.'; exit 0 }
$PidFile=Join-Path $Operacao 'supervisor.pid.json';$EstadoFile=Join-Path $Operacao 'estado.json';$StatusFile=Join-Path $Operacao 'status.json';$PararFile=Join-Path $Operacao 'parar.sinal';$Log=Join-Path $Operacao 'supervisor.log'
# Registrar nunca pode derrubar a operacao: o log pode estar aberto por quem o
# le (supv, antivirus, editor) no instante da gravacao.
function Log([string]$m){$l="$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m";if($Visivel){Write-Host $l};try{Add-Content $Log $l -Encoding UTF8;$linhas=@(Get-Content $Log -ErrorAction SilentlyContinue);if($linhas.Count-gt1200){$linhas|Select-Object -Last 1000|Set-Content $Log -Encoding UTF8}}catch{}}
$avisosLimitados=@{}
function Log-Limitado([string]$chave,[string]$m,[int]$minutos){$agora=Get-Date;if($avisosLimitados[$chave]-and$agora-lt$avisosLimitados[$chave].AddMinutes($minutos)){return};$avisosLimitados[$chave]=$agora;Log $m}
# Grava por arquivo temporario e troca, com novas tentativas. Arquivo em uso
# por um leitor (supv status, antivirus) e transitorio: devolve $false em vez
# de lancar, e quem chamou decide se registra e segue.
function Gravar-Tolerante([string]$caminho,[string]$texto){
 for($t=1;$t-le5;$t++){
  $tmp="$caminho.$PID.tmp"
  try{[IO.File]::WriteAllText($tmp,$texto,(New-Object Text.UTF8Encoding($false)));Move-Item -LiteralPath $tmp -Destination $caminho -Force;return $true}
  catch{Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue;Start-Sleep -Milliseconds 300}
 }
 return $false
}
if(Test-Path $PidFile){
 try{$ant=Get-Content $PidFile -Raw|ConvertFrom-Json;$proc=Get-Process -Id ([int]$ant.pid) -ErrorAction Stop;$inicio=[datetime]::Parse($ant.inicio).ToUniversalTime();if($proc.Path-eq(Get-Process -Id $PID).Path-and[Math]::Abs(($proc.StartTime.ToUniversalTime()-$inicio).TotalSeconds)-le2){Write-Host 'A operacao ja esta ativa.';exit 0}}catch{}
}
Remove-Item $PararFile -Force -ErrorAction SilentlyContinue
@{pid=$PID;inicio=(Get-Date).ToUniversalTime().ToString('o');raiz=$Raiz}|ConvertTo-Json -Compress|Set-Content $PidFile -Encoding UTF8
$config=Ler-ConfigOperacao $ConfigOperacao
$ensaio=Aplicar-ModoEnsaio $config
$ManutencaoFile=Join-Path $Operacao 'manutencao.sinal'
$estado=Ler-EstadoOperacao $EstadoFile
$estadoPendente=$false
function Salvar-Estado{
 $limite=(Get-Date).Date.AddDays(-14)
 foreach($k in @($estado.Keys)){if($k-match '-(\d{4}-\d{2}-\d{2})-' -and [datetime]$Matches[1]-lt$limite){$estado.Remove($k)}}
 # Falha transitoria (arquivo em uso) nao derruba a operacao: o estado segue
 # em memoria e a gravacao e repetida a cada volta ate conseguir.
 for($t=1;$t-le5;$t++){try{Gravar-EstadoOperacao $EstadoFile $estado;$script:estadoPendente=$false;return}catch{$erroEstado=$_.Exception.Message;Start-Sleep -Milliseconds 300}}
 $script:estadoPendente=$true
 Log-Limitado 'estado' "AVISO: estado.json nao gravado ($erroEstado); nova tentativa na proxima volta." 60
}
$processos=@{}
function Iniciar-Processo([string]$nome,[string]$exe,[string[]]$argumentos,[string]$pasta){
 if($processos[$nome]-and!$processos[$nome].HasExited){return};$saida=Join-Path $Operacao "$nome-saida.log";$erro=Join-Path $Operacao "$nome-erro.log"
 $processos[$nome]=Start-Process $exe -ArgumentList $argumentos -WorkingDirectory $pasta -WindowStyle Hidden -PassThru -RedirectStandardOutput $saida -RedirectStandardError $erro;[void]$processos[$nome].Handle;Log "$nome iniciado (PID $($processos[$nome].Id))."
 if($nome-eq'portal'){$script:inicioPartidaPortal=Get-Date;$script:portalJaPronto=$false;$script:aguardandoPortal=$false}
}
# O detalhe e opcional: falha de leitura do log nao pode interromper a operacao.
function Obter-DetalheFalha([string]$nome){
 foreach($tipo in @('erro','saida')){
  try{
   $linha=Get-Content -LiteralPath (Join-Path $Operacao "$nome-$tipo.log") -ErrorAction Stop|Where-Object{!([string]::IsNullOrWhiteSpace($_))}|Select-Object -Last 1
   if($null-ne$linha){$linha=$linha.Trim();return ': '+$linha.Substring(0,[Math]::Min(300,$linha.Length))}
  }catch{}
 }
 return ''
}
function Encerrar($p){
 if(!$p){return}
 try{
  $p.Refresh()
  if(!$p.HasExited){
   # O launcher observa parar.sinal e fecha banco/ponte antes da arvore.
   if((Test-Path $PararFile)-and$p.WaitForExit(2000)){return}
   # O processo pode sair entre a consulta e taskkill. Essa corrida nao pode
   # abortar o finally e deixar as demais arvores, inclusive saude, vivas.
   $encerrador=$null
   try{
    $encerrador=Start-Process taskkill.exe -ArgumentList @('/PID',"$($p.Id)",'/T','/F') -PassThru -WindowStyle Hidden;[void]$encerrador.Handle
    if(!$encerrador.WaitForExit(3000)){$encerrador.Kill();Log "AVISO: taskkill excedeu 3 s para PID $($p.Id)."}
   }catch{}finally{if($encerrador){$encerrador.Dispose()}}
   if(!$p.WaitForExit(5000)){Log "AVISO: processo $($p.Id) nao encerrou; confira antes de reiniciar."}
  }
 }catch{Log "AVISO ao encerrar processo: $($_.Exception.Message)"}
}
function Pode-Tentar([string]$tipo){$k="tentativa-$tipo";if(!$estado[$k]){return $true};return (Get-Date)-ge([datetime]$estado[$k]).AddMinutes(10)}
$Node=if($SemLogin){$NodeExecutavel}else{(Get-Command node.exe).Source};$Python=Join-Path $Alertas '.venv\Scripts\python.exe'
$avisosAdmin=Novo-ControleAvisosAdmin $config $ensaio $Node $Portal
$alerta=$null;$alertaChave='';$alertaHora='';$alertaRunId='';$backup=$null;$backupChave='';$limpeza=$null;$limpezaChave=''
$expurgo=$null
$verificacaoSaude=$null;$inicioSaude=$null
$inicioPortal=Get-Date;$ultimoReinicio=Get-Date
$portalJaPronto=$false;$aguardandoPortal=$false
$portalPronto=$false;$falhasSaude=0;$PortalUrl='http://127.0.0.1:3000'
if($SemLogin){
 $cache=Join-Path $Operacao 'cache';New-Item -ItemType Directory -Force $cache|Out-Null
 $env:XDG_CONFIG_HOME=$cache;$env:XDG_CACHE_HOME=$cache;$env:npm_config_cache=Join-Path $cache 'npm'
 $env:TEMP=$cache;$env:TMP=$cache
}
$configPortalHealth=Ler-ConfigOperacao (Join-Path $Privado 'portal/configuracao/portal.env')
$HealthUrl='http://127.0.0.1:'+(Obter-PortaPortalLocal $configPortalHealth)+'/api/health'
$codigoSupervisor=0
$clienteHealth=$null
try{$linhaUrl=@(Get-Content (Join-Path $Privado 'portal\configuracao\portal.env') -ErrorAction Stop)|Where-Object{$_ -like 'PORTAL_URL=*'}|Select-Object -First 1;if($linhaUrl){$PortalUrl=($linhaUrl -split '=',2)[1].Trim()}}catch{}
try{
 Encerrar-OrfaosInstalacao $Raiz
 $clienteHealth=Novo-ClienteHealth
 Log 'Supervisor iniciado.'
 if($ensaio){Log 'Modo ensaio ATIVO'}
 Avisar-Administrador $avisosAdmin 'supervisor-iniciado'
 while(!(Test-Path $PararFile)){
  # Erro numa volta e registrado e a volta seguinte tenta de novo. Antes, uma
  # falha transitoria qualquer (ex.: status.json em uso) encerrava toda a
  # operacao ate alguem religar.
  try{
  Atualizar-AvisosAdmin $avisosAdmin
  if($estadoPendente){Salvar-Estado}
  Iniciar-Processo 'portal' $Node @(('"'+(Join-Path $Portal 'scripts\iniciar-portal.mjs')+'"'),'lan') $Portal
  Iniciar-Processo 'emails' $Node @('--experimental-strip-types',('"'+(Join-Path $Portal 'scripts\processar-emails.mjs')+'"'),'--watch') $Portal
  Iniciar-Processo 'relatorios' $Node @('--experimental-strip-types',('"'+(Join-Path $Portal 'scripts\processar-relatorios.mjs')+'"')) $Portal
  $resultadoHealth=Consultar-HealthLocal $clienteHealth $HealthUrl
  $saudavel=$resultadoHealth.saudavel
  # Uma falha isolada do health (ex.: banco momentaneamente ocupado) nao e
  # queda: so duas seguidas (~15 s) declaram o portal fora do ar.
  if($saudavel){$falhasSaude=0;$portalJaPronto=$true}else{
   $falhasSaude++
   if(!$portalPronto-and!$portalJaPronto-and((Get-Date)-$inicioPartidaPortal).TotalMinutes-lt3){
    if(!$aguardandoPortal){Log 'aguardando o Portal subir';$aguardandoPortal=$true}
   }else{Log (Formatar-FalhaHealth $resultadoHealth $falhasSaude)}
  }
  # Reinicia apenas o portal apos falhas persistentes e janela de inicializacao.
  # Nao interrompe Qlik/SMTP com resultado incerto para recuperar a interface.
  if(!$saudavel-and$falhasSaude-ge8-and((Get-Date)-$inicioPortal).TotalMinutes-ge3-and((Get-Date)-$ultimoReinicio).TotalMinutes-ge3){
   Log 'Portal sem resposta persistente; reiniciando sua arvore.'
   Avisar-Administrador $avisosAdmin 'portal-reiniciado'
   Encerrar $processos['portal'];$ultimoReinicio=Get-Date;$inicioPortal=Get-Date;$falhasSaude=0
  }
  if($verificacaoSaude){
   if($verificacaoSaude.HasExited){$verificacaoSaude=$null}
   elseif(((Get-Date)-$inicioSaude).TotalMinutes-ge3){Encerrar $verificacaoSaude;$verificacaoSaude=$null;Log 'Verificacao de saude excedeu 3 minutos e foi encerrada.'}
  }
  if($saudavel-and!$portalPronto){$portalPronto=$true;Log 'Portal pronto (health ok).';[void](Notificar 'Supply Vision' "Portal no ar em $PortalUrl")}
  elseif(!$saudavel-and$portalPronto-and$falhasSaude-eq1){Log 'Health sem resposta valida uma vez; aguardando a proxima verificacao.'}
  elseif(!$saudavel-and$portalPronto-and$falhasSaude-ge2){$portalPronto=$false;Log 'Portal deixou de responder.';[void](Notificar 'Supply Vision' 'O Portal parou de responder.');Avisar-Administrador $avisosAdmin 'portal-parou'}
  if($alerta-and$alerta.HasExited){if($alerta.ExitCode-eq0){$estado[$alertaChave]=(Get-Date).ToString('o');$estado.Remove('tentativa-alertas');Log "Alertas concluidos: $alertaChave."}elseif($alerta.ExitCode-eq3){$estado[$alertaChave]='revisao-entrega';$estado.Remove('tentativa-alertas');Log "ALERTA: $alertaChave exige revisao da entrega. Confira privado/alertas/estado-envios; nao sera reenviado automaticamente.";Avisar-Administrador $avisosAdmin 'alertas-revisao'}else{Log "Alertas falharam (codigo $($alerta.ExitCode)).";Avisar-Administrador $avisosAdmin 'alertas-falharam'};$alerta=$null;Salvar-Estado;try{if(!$verificacaoSaude){$inicioSaude=Get-Date;$verificacaoSaude=Start-Process $Python -ArgumentList 'processo\verificar_saude.py',$alertaHora.Replace(':',''),$alertaRunId -WorkingDirectory $Alertas -WindowStyle Hidden -PassThru;[void]$verificacaoSaude.Handle}}catch{Log "Verificacao de saude nao executada: $($_.Exception.Message)"}}
  $manutencao=(Test-Path $ManutencaoFile)-or(Test-Path (Join-Path $Operacao 'validacao-atualizacao.sinal'))
  if(!$manutencao-and!$alerta){
   $agoraAlerta=Get-Date
   $horariosAlerta=Obter-HorariosDoDia $config 'ALERTAS_HORARIOS' $agoraAlerta
   $avisoCorte=@{mensagem=$null}
   $pulados=@(Pular-AlertasRestaurados $Operacao $horariosAlerta $estado $agoraAlerta {param($mensagem) $avisoCorte.mensagem=$mensagem})
   $avisarCorte=$pulados.Count-gt0
   if($avisoCorte.mensagem){
    $diaCorte=$agoraAlerta.ToString('yyyy-MM-dd')
    $avisarCorte=$estado['aviso-corte-restauracao']-ne$diaCorte
    if($avisarCorte){Log $avisoCorte.mensagem;$estado['aviso-corte-restauracao']=$diaCorte}
   }
   foreach($chave in $pulados){Log "Alertas pulados por restauracao: $chave."}
   if($pulados.Count-or$avisarCorte){Salvar-Estado}
   if($avisarCorte){Avisar-Administrador $avisosAdmin 'alertas-restauracao'}
   $d=Obter-SlotDevido 'alertas' $horariosAlerta $estado $agoraAlerta
   if($d-and(Pode-Tentar 'alertas')){$estado['tentativa-alertas']=(Get-Date).ToString('o');$alertaChave=$d.chave;$alertaHora=$d.hora;$alertaRunId=(Get-Date).ToString('yyyyMMdd_HHmmss')+'_'+[guid]::NewGuid().ToString('N').Substring(0,6);$env:SUPPLY_VISION_RUN_ID=$alertaRunId;try{$alerta=Start-Process $Python -ArgumentList (Argumentos-Pipeline $d.hora $ensaio) -WorkingDirectory $Alertas -WindowStyle Hidden -PassThru;[void]$alerta.Handle}finally{Remove-Item Env:SUPPLY_VISION_RUN_ID -ErrorAction SilentlyContinue};Log "Alertas iniciados para $($d.hora) (execucao $alertaRunId, PID $($alerta.Id)).";Salvar-Estado}
  }
  if($backup-and$backup.HasExited){if($backup.ExitCode-eq0){$estado[$backupChave]=(Get-Date).ToString('o');Log "Backup concluido: $backupChave."}else{Log "Backup falhou (codigo $($backup.ExitCode)).$(Obter-DetalheFalha 'backup')";Avisar-Administrador $avisosAdmin 'backup-falhou'};$backup=$null;Salvar-Estado}
  if(!$manutencao-and!$backup){$d=Obter-SlotDoDia 'backup' $config 'BACKUP_HORARIOS' $estado (Get-Date);if($d-and(Pode-Tentar 'backup')){$estado['tentativa-backup']=(Get-Date).ToString('o');$backupChave=$d.chave;$backup=Start-Process $Node -ArgumentList @('--experimental-strip-types','scripts\backup.mjs') -WorkingDirectory $Portal -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $Operacao 'backup-saida.log') -RedirectStandardError (Join-Path $Operacao 'backup-erro.log');[void]$backup.Handle;Log "Backup iniciado para $($d.hora) (PID $($backup.Id)).";Salvar-Estado}}
  if($limpeza-and$limpeza.HasExited){if($limpeza.ExitCode-eq0){$estado[$limpezaChave]=(Get-Date).ToString('o');Log 'Limpeza concluida.'}else{Log "Limpeza falhou (codigo $($limpeza.ExitCode)).$(Obter-DetalheFalha 'limpeza')"};$limpeza=$null;Salvar-Estado}
  if(!$manutencao-and!$limpeza){$d=Obter-SlotDevido 'limpeza' $config.LIMPEZA_HORARIO $estado (Get-Date);if($d-and(Pode-Tentar 'limpeza')){$estado['tentativa-limpeza']=(Get-Date).ToString('o');$limpezaChave=$d.chave;$limpeza=Start-Process $Python -ArgumentList 'processo\limpeza.py' -WorkingDirectory $Alertas -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $Operacao 'limpeza-saida.log') -RedirectStandardError (Join-Path $Operacao 'limpeza-erro.log');[void]$limpeza.Handle;Log "Limpeza iniciada (PID $($limpeza.Id)).";Salvar-Estado}}
  if($expurgo-and$expurgo.HasExited){if($expurgo.ExitCode-eq0){$estado[$expurgoChave]=(Get-Date).ToString('o');Log 'Expurgo concluido.'}else{Log "Expurgo falhou; nenhum slot confirmado.$(Obter-DetalheFalha 'expurgo')"};$expurgo=$null;Salvar-Estado}
  if($config['EXPURGO_HABILITADO']-eq'1'-and!$manutencao-and!$expurgo){$d=Obter-SlotDevido 'expurgo' $config.LIMPEZA_HORARIO $estado (Get-Date);if($d-and(Pode-Tentar 'expurgo')){$estado['tentativa-expurgo']=(Get-Date).ToString('o');$expurgoChave=$d.chave;$expurgo=Start-Process $Node -ArgumentList @('--experimental-strip-types','scripts\expurgar-dados.mjs') -WorkingDirectory $Portal -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $Operacao 'expurgo-saida.log') -RedirectStandardError (Join-Path $Operacao 'expurgo-erro.log');[void]$expurgo.Handle;Log 'Expurgo iniciado; backup de rede confirmado quando necessario.';Salvar-Estado}}
  $livreGb=[math]::Round((Get-Item $Raiz).PSDrive.Free/1GB,1);$disco=if($livreGb-lt[double]$config.ESPACO_MINIMO_GB){'baixo'}else{'ok'}
  $hoje=(Get-Date).ToString('yyyy-MM-dd');if($disco-eq'baixo'-and$estado['aviso-disco']-ne$hoje){Log "ALERTA: apenas $livreGb GB livres no disco.";Avisar-Administrador $avisosAdmin 'disco-baixo';$estado['aviso-disco']=$hoje;Salvar-Estado}
  @{atualizado=(Get-Date).ToString('o');ensaio=$ensaio;portal=!!($processos['portal']-and!$processos['portal'].HasExited);emails=!!($processos['emails']-and!$processos['emails'].HasExited);relatorios=!!($processos['relatorios']-and!$processos['relatorios'].HasExited);alertas=if($alerta){'executando'}elseif($manutencao){'pausados'}else{'aguardando'};backup=if($backup){'executando'}elseif($manutencao){'pausado'}else{'aguardando'};limpeza=if($limpeza){'executando'}elseif($manutencao){'pausada'}else{'aguardando'};manutencao=$manutencao;espacoLivreGb=$livreGb;disco=$disco}|ConvertTo-Json -Compress|ForEach-Object{if(!(Gravar-Tolerante $StatusFile $_)){Log-Limitado 'status' 'AVISO: status.json em uso por outro processo; supv status pode mostrar a situacao com atraso.' 60}}
  }catch{Log-Limitado ("volta:"+$_.Exception.Message) "ERRO na volta do supervisor (a operacao segue): $($_.Exception.Message) | Origem: $($_.ScriptStackTrace -replace '\s*\r?\n\s*',' | ')" 10}
  # Observa parada a cada 100 ms; conserva o ciclo de health de 15 s e
  # a atualizacao dos avisos a cada segundo.
  for($i=0;$i-lt15-and!(Test-Path $PararFile);$i++){
   for($fatia=0;$fatia-lt10-and!(Test-Path $PararFile);$fatia++){Start-Sleep -Milliseconds 100}
   Atualizar-AvisosAdmin $avisosAdmin
  }
 }
}catch{$codigoSupervisor=1;Log "ERRO FATAL: $($_.Exception.Message)";Log "Origem: $($_.ScriptStackTrace -replace '\s*\r?\n\s*',' | ')"}finally{
 if($clienteHealth){$clienteHealth.cliente.Dispose()}
 @{atualizado=(Get-Date).ToString('o');ensaio=$ensaio;portal=$false;emails=$false;relatorios=$false;alertas='parado';backup='parado';limpeza='parada';manutencao=$false;disco='desconhecido'}|ConvertTo-Json -Compress|ForEach-Object{[void](Gravar-Tolerante $StatusFile $_)};Encerrar-AvisosAdmin $avisosAdmin;Log 'Encerrando a operacao.';if($portalPronto){[void](Notificar 'Supply Vision' 'Operacao encerrada. O Portal saiu do ar.')};foreach($p in $processos.Values){Encerrar $p};Encerrar $alerta;Encerrar $backup;Encerrar $limpeza;Encerrar $expurgo;Encerrar $verificacaoSaude;Remove-Item $PidFile,$PararFile -Force -ErrorAction SilentlyContinue;if($LockHandle){$LockHandle.Dispose()}}

if($SemLogin){exit $codigoSupervisor}
