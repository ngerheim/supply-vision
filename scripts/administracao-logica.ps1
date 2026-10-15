. (Join-Path $PSScriptRoot 'atualizacao-preparo.ps1')
function Obter-VersaoAdministrada([string]$Raiz) {
 $r=Executar-NativoOperacao 'git' @('-C',$Raiz,'log','-1','--date=format:%d/%m/%Y','--pretty=format:%h  %ad')
 if($r.codigo-eq0){
  $versao=@($r.stdout|Where-Object {$_-match'^[0-9a-f]{7,40}\s+\d{2}/\d{2}/\d{4}$'}|Select-Object -First 1)
  if($versao.Count){return $versao[0]}
 }
 return 'versao indisponivel'
}
function Testar-ConclusaoAtualizacao($Codigo,[string]$Saida){
 $marcador=($Saida-match'(?m)^=== Atualizado: [0-9a-f]{7} -> [0-9a-f]{7} ===\s*$')-or($Saida-like'*Nada a fazer*')
 # Codigo desconhecido admite marcador; codigo de falha explicito sempre prevalece.
 return (($null-ne$Codigo)-and($Codigo-eq0)-and$marcador)-or(($null-eq$Codigo)-and$marcador)
}
function Filtrar-AvisosAtualizacao($Linhas){
 return @($Linhas|Where-Object {$_-notmatch'(?i)\b(INEFFECTIVE_DYNAMIC_IMPORT|PLUGIN_TIMINGS)\b|^\s*npm\s+warn\b|^\s*(WARNING|AVISO): Nao foi possivel gravar a medicao'})
}
function Consultar-TarefaAdministrada([string]$Raiz,[string]$Startup){
 $total=[Diagnostics.Stopwatch]::StartNew();$medir=[Diagnostics.Stopwatch]::StartNew();$t=$null;$info=$null;$tempoInfo=0;$resultado='ok';$aviso=''
 try{
  if(Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue){
   try{$t=Get-ScheduledTask -TaskName 'Supply Vision' -TaskPath '\' -ErrorAction Stop}
   catch{if($_.CategoryInfo.Category-ne'ObjectNotFound'){throw}}
  }
  $tempoTarefa=$medir.ElapsedMilliseconds
  if($t-and!([string]$t.Actions.Arguments).Contains((Join-Path $Raiz 'scripts\supervisor.ps1'))){$t=$null}
  if($t){
   $medir.Restart();try{$info=Get-ScheduledTaskInfo -TaskName 'Supply Vision' -TaskPath '\' -ErrorAction Stop}finally{$tempoInfo=$medir.ElapsedMilliseconds}
   $aviso=Obter-FalhaLogonTarefa ([long]$info.LastTaskResult)
  }
  $modo=if($t){'computador'}elseif($Startup-and(Test-Path -LiteralPath $Startup)){'login'}else{'desligado'}
 }catch{$tempoTarefa=if($null-eq$tempoTarefa){$medir.ElapsedMilliseconds}else{$tempoTarefa};$modo=$null;$resultado='erro';$aviso='Agendador indisponivel; execute supv homologar e tente novamente.'}
 $total.Stop()
 return @{modo=$modo;aviso=$aviso;totalMs=$total.ElapsedMilliseconds;tarefaMs=$tempoTarefa;infoMs=$tempoInfo;resultado=$resultado}
}
function Consultar-EstadoAdministrado([string]$Privado,[string]$Raiz){
 $total=[Diagnostics.Stopwatch]::StartNew();$medir=[Diagnostics.Stopwatch]::StartNew()
 $ativo=!(Testar-SupervisorEncerrado $Privado);$tempoSupervisor=$medir.ElapsedMilliseconds
 $medir.Restart();$st=$null;$estado='ok';$arquivo=Join-Path $Privado 'operacao/status.json'
 if(Test-Path -LiteralPath $arquivo){try{$st=Get-Content -LiteralPath $arquivo -Raw -Encoding UTF8|ConvertFrom-Json -ErrorAction Stop}catch{$estado='ilegivel'}}
 $tempoEstado=$medir.ElapsedMilliseconds;$medir.Restart();$ensaio=$false
 try{$ensaio=(Ler-ConfigOperacao (Join-Path $Privado 'comum/operacao.env'))['MODO_ENSAIO']-eq'1'}catch{}
 if($ativo-and$st){$ensaio=!!$st.ensaio}
 $aviso=if($ensaio){Obter-AvisoEnsaio $true}else{Obter-AvisoBackup $Privado}
 $migrada=Test-Path -LiteralPath (Join-Path $Privado 'operacao/migrada.sinal')
 $tempoConfig=$medir.ElapsedMilliseconds;$versao=$null;$tempoGit=0
 if($Raiz){$medir.Restart();$versao=Obter-VersaoAdministrada $Raiz;$tempoGit=$medir.ElapsedMilliseconds}
 $total.Stop()
 return @{ativo=$ativo;status=$st;ensaio=$ensaio;avisoBackup=$aviso;migrada=$migrada;totalMs=$total.ElapsedMilliseconds;supervisorMs=$tempoSupervisor;estadoMs=$tempoEstado;configMs=$tempoConfig;versao=$versao;gitMs=$tempoGit}
}
function Executar-AcaoAdministrada([string]$Raiz,[string]$Privado,[string]$Startup,[string]$Tipo,$Dados){
 switch($Tipo){
  'iniciar' {Iniciar-OperacaoConfigurada $Raiz;return @{ok=$true}}
  'parar' {return @{ok=(Parar-Operacao $Raiz)}}
  'validar' {
   $r=Executar-NativoOperacao 'powershell.exe' @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $Raiz 'scripts/validar-operacao.ps1'))
   $saida=$r.saida
   if($r.codigo-ne0){throw ($saida-join"`n")};return @{ok=$true;mensagem='Configuracao aprovada.'}
  }
  'testar-backup' {
   $r=Executar-NativoOperacao (Localizar-NodeMaquina) @('--experimental-strip-types',(Join-Path $Raiz 'portal/scripts/testar-restauracao.mjs'))
   $saida=$r.saida
   if($r.codigo-ne0){throw ($saida-join"`n")};return @{ok=$true;mensagem=($saida-join"`n")}
  }
  'restaurar' {
   if(!(Parar-Operacao $Raiz)){throw 'A operacao nao encerrou. Restauracao cancelada para nao mexer no banco com o portal no ar.'}
   $argumentos=@((Join-Path $Raiz 'portal/scripts/restaurar-backup.mjs'),'--sim');if($Dados.anterior){$argumentos+='--anterior'}
   $r=Executar-NativoOperacao (Localizar-NodeMaquina) (@('--experimental-strip-types')+$argumentos)
   $saida=$r.saida
   if($r.codigo-ne0){throw ($saida-join"`n")};return @{ok=$true;mensagem=(($saida-join"`n")+"`n`nInicie a operacao para voltar ao ar.")}
  }
  'atualizar' {
   if((Obter-TarefaSupplyVision $Raiz)-and!(Testar-Elevacao)){return @{elevar=$true}}
   return Iniciar-AtualizacaoAdministrada $Raiz $Privado ([bool]$Dados.completo)
  }
  'modo' {
   if(!(Testar-SupervisorEncerrado $Privado)){throw 'Pare a operacao antes de mudar o modo de inicializacao.'}
   Definir-ModoInicializacao $Raiz $Privado $Startup $Dados.modo;return @{ok=$true}
  }
  'manutencao' {
   $op=Join-Path $Privado 'operacao';New-Item -ItemType Directory -Force $op|Out-Null
   $arquivo=Join-Path $op 'manutencao.sinal'
   if($Dados.ativo){New-Item -ItemType File -Force $arquivo|Out-Null}else{Remove-Item -LiteralPath $arquivo -Force -ErrorAction SilentlyContinue}
   return @{ok=$true}
  }
  'migrar' {Preparar-Migracao $Raiz $Privado $Startup $Dados.destino $Dados.modo;return @{ok=$true}}
  'fim-atualizacao' {
   $op=Join-Path $Privado 'operacao'
   $arquivoSaida=Join-Path $op 'atualizacao-processo-saida.log'
   if(!$Dados.saida){
    # Atualizador iniciado antes da troca: o worker le o codigo novo, mas stdout
    # ainda esta no nome legado. Escolhe a captura mais recente, nao os tempos.
    $captura=@('atualizacao-processo-saida.log','atualizacao-saida.log')|ForEach-Object {Get-Item -LiteralPath (Join-Path $op $_) -ErrorAction SilentlyContinue}|Where-Object {
     # Na G0, este nome tambem podia conter apenas medicoes do pai.
     @(Get-Content -LiteralPath $_.FullName -Tail 12 -ErrorAction SilentlyContinue|Where-Object {$_-match'\S'-and$_-notmatch'^\[\d{4}-\d{2}-\d{2} '}).Count-gt0
    }|Sort-Object LastWriteTimeUtc -Descending|Select-Object -First 1
    if($captura){$arquivoSaida=$captura.FullName}
   }
   $texto=@(Get-Content -LiteralPath $arquivoSaida -ErrorAction SilentlyContinue)-join"`n"
   $concluiu=Testar-ConclusaoAtualizacao $Dados.codigo $texto
   $versao=Obter-VersaoAdministrada $Raiz
   if($concluiu){$mensagem=if($texto-like'*Nada a fazer*'){'O sistema ja esta na versao mais recente.'}else{'Sistema atualizado e operacao reiniciada.'}}
   else{
    $e=@(Filtrar-AvisosAtualizacao @(Get-Content (Join-Path $op 'atualizacao-erro.log') -ErrorAction SilentlyContinue)|Select-Object -Last 8)
    $s=@(Filtrar-AvisosAtualizacao @(Get-Content $arquivoSaida -ErrorAction SilentlyContinue)|Select-Object -Last 12)
    $mensagem=@("Codigo de saida: $($Dados.codigo). Conclusao nao confirmada.";$(if($e){'ERRO:';$e});$(if($s){'ULTIMAS ETAPAS:';$s}))-join"`n"
    if(!$mensagem){$mensagem='Consulte os registros da operacao para mais detalhes.'}
   }
   $andamento=Consultar-AndamentoAdministrado $Privado
   if($andamento){$mensagem+="`n`nTempo total: $($andamento.totalSegundos) s.";if($andamento.resumo){$mensagem+="`n$($andamento.resumo)"}}
   return @{ok=$concluiu;mensagem=$mensagem;versao=$versao;andamento=$andamento}
  }
  default {throw 'Comando de administracao desconhecido.'}
 }
}
function Consultar-AndamentoAdministrado([string]$Privado,[datetime]$Agora=[datetime]::UtcNow) {
 try{
  $op=Join-Path $Privado 'operacao'
  $j=Get-Content -LiteralPath (Join-Path $op 'atualizacao-andamento.json') -Raw -Encoding UTF8 -ErrorAction Stop|ConvertFrom-Json -ErrorAction Stop
  if(!$j.nome-or$j.numero-lt1-or$j.total-lt$j.numero-or$j.estado-notin@('andamento','concluido','falhou')){return $null}
  $inicio=[datetime]::Parse($j.inicioGeral).ToUniversalTime();$inicioEtapa=[datetime]::Parse($j.inicioEtapa).ToUniversalTime()
  $fim=if($j.estado-eq'andamento'){$Agora}else{[datetime]::Parse($j.fim).ToUniversalTime()}
  $total=[math]::Max(0,[math]::Floor(($fim-$inicio).TotalSeconds));$etapa=[math]::Max(0,[math]::Floor(($fim-$inicioEtapa).TotalSeconds))
  $restante=$null
  if($j.estado-eq'andamento'-and$j.duracoes-and@($j.duracoes.PSObject.Properties).Count){
   $estimativa=0;$conhecidas=0
   for($i=([int]$j.numero-1);$i-lt@($j.plano).Count;$i++){
    $p=$j.duracoes.PSObject.Properties[[string]$j.plano[$i]]
    if($p){$valor=[double]$p.Value;if($i-eq([int]$j.numero-1)){$valor=[math]::Max(0,$valor-$etapa)};$estimativa+=$valor;$conhecidas++}
   }
   if($conhecidas){$restante=[math]::Ceiling($estimativa)}
  }
  $progresso=if($j.estado-eq'concluido'){100}else{[math]::Min(99,[math]::Floor(100*($j.numero-1)/$j.total))}
  $resumo=''
  if($j.estado-ne'andamento'){$resumo=@(Get-Content -LiteralPath (Join-Path $op 'atualizacao-tempos.log') -Tail 80 -Encoding UTF8 -ErrorAction SilentlyContinue|Where-Object {$_-like'*Resumo atualizacao:*'}|Select-Object -Last 1)-join''}
  return @{nome=$j.nome;numero=[int]$j.numero;total=[int]$j.total;modo=$j.modo;motivoModo=$j.motivoModo;estado=$j.estado;etapaSegundos=$etapa;totalSegundos=$total;restanteSegundos=$restante;progresso=$progresso;resumo=$resumo;inicioGeral=$inicio;inicioEtapa=$inicioEtapa}
 }catch{return $null}
}

# Consultas nao removem travas antigas nem gravam diagnosticos.
function Consultar-LimpezaAdministrada([string]$Privado) {
 $arquivo=Join-Path $Privado 'operacao/limpeza-preparo.lock'
 if(!(Test-Path -LiteralPath $arquivo)){return 'ausente'}
 $h=$null
 try{
  $h=[IO.File]::Open($arquivo,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  if(Obter-ProcessoRegistrado $arquivo){return 'em andamento'}
  return 'registro pendente (sem processo ativo)'
 }catch{return 'em andamento ou inacessivel'}finally{if($h){$h.Dispose()}}
}
function Consultar-AtualizacaoAdministrada([string]$Raiz,[string]$Privado) {
 $op=Join-Path $Privado 'operacao'
 $processo=Obter-ProcessoRegistrado (Join-Path $op 'atualizacao-processo.json')
 if($processo){return $processo}
 # Abrange atualizador iniciado diretamente pelo atalho antigo ou pelo script.
 if(Get-Command Get-CimInstance -ErrorAction SilentlyContinue){
  $scriptAtualizador=Join-Path $Raiz 'scripts\atualizar-servidor.ps1'
  $processos=@(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction Stop)
  foreach($p in $processos){
   if($p.ProcessId-ne$PID-and([string]$p.CommandLine).IndexOf($scriptAtualizador,[StringComparison]::OrdinalIgnoreCase)-ge0){
    return Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue
   }
  }
 }
 return $null
}
function Iniciar-AtualizacaoAdministrada([string]$Raiz,[string]$Privado,[bool]$Completo=$false) {
 $op=Join-Path $Privado 'operacao';[void][IO.Directory]::CreateDirectory($op)
 $trava=$null
 try{
  try{$trava=[IO.File]::Open((Join-Path $op 'atualizacao-disparo.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)}
  catch{throw 'Disparo de atualizacao em andamento. Use supv acompanhar.'}
  if(Consultar-AtualizacaoAdministrada $Raiz $Privado){throw 'Atualizacao em andamento. Use supv acompanhar.'}
  try{Confirmar-LimpezaAnterior (Join-Path $op 'limpeza-preparo.lock')}
  catch{throw ('Limpeza de preparo: '+$_.Exception.Message)}
  $saida=Join-Path $op 'atualizacao-processo-saida.log';$erro=Join-Path $op 'atualizacao-erro.log'
  Remove-Item $saida,$erro,(Join-Path $op 'atualizacao-resultado.json'),(Join-Path $op 'atualizacao-andamento.json') -Force -ErrorAction SilentlyContinue
  $id=[guid]::NewGuid().ToString('N')
  $argumentos='-NoProfile -ExecutionPolicy Bypass -File "'+(Join-Path $Raiz 'scripts/atualizar-operacao.ps1')+'" -Execucao '+$id
  if($Completo){$argumentos+=' -Completo'}
  # Start-Process no Windows usa um console independente; nao herda Ctrl+C.
  $proc=Start-Process powershell.exe -ArgumentList $argumentos -WindowStyle Hidden -PassThru
  [void]$proc.Handle
  $registro=@{pid=$proc.Id;inicio=$proc.StartTime.ToUniversalTime().ToString('o');execucao=$id}
  Gravar-EstadoOperacao (Join-Path $op 'atualizacao-processo.json') $registro
  return @{ok=$true;processo=$proc;saida='atualizacao-processo-saida.log';execucao=$id}
 }finally{if($trava){$trava.Dispose()}}
}
