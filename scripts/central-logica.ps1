function Testar-ConclusaoAtualizacao($Codigo,[string]$Saida){
 $marcador=($Saida-match'(?m)^=== Atualizado: [0-9a-f]{7} -> [0-9a-f]{7} ===\s*$')-or($Saida-like'*Nada a fazer*')
 # Codigo desconhecido admite marcador; codigo de falha explicito sempre prevalece.
 return (($null-ne$Codigo)-and($Codigo-eq0)-and$marcador)-or(($null-eq$Codigo)-and$marcador)
}
function Filtrar-AvisosAtualizacao($Linhas){
 return @($Linhas|Where-Object {$_-notmatch'(?i)\b(INEFFECTIVE_DYNAMIC_IMPORT|PLUGIN_TIMINGS)\b|^\s*npm\s+warn\b|^\s*(WARNING|AVISO): Nao foi possivel gravar a medicao'})
}
# Consultas e comandos da central executados em runspaces, nunca na thread WinForms.
function Registrar-DiagnosticoCentral([string]$Privado,[string]$Texto){
 try{
  $pasta=Join-Path $Privado 'operacao';[void][IO.Directory]::CreateDirectory($pasta)
  $arquivo=Join-Path $pasta 'central-diagnostico.log'
  if((Test-Path -LiteralPath $arquivo)-and(Get-Item -LiteralPath $arquivo).Length-gt524288){
   $ultimas=@(Get-Content -LiteralPath $arquivo -Encoding UTF8|Select-Object -Last 300)
   [IO.File]::WriteAllLines($arquivo,$ultimas,(New-Object Text.UTF8Encoding($false)))
  }
  [IO.File]::AppendAllText($arquivo,((Get-Date -Format 'yyyy-MM-dd HH:mm:ss')+' '+$Texto+[Environment]::NewLine),(New-Object Text.UTF8Encoding($false)))
 }catch{} # Medicao nao pode impedir leitura nem acao.
}
function Consultar-TarefaCentral([string]$Raiz,[string]$Privado,[string]$Startup){
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
 }catch{$tempoTarefa=if($null-eq$tempoTarefa){$medir.ElapsedMilliseconds}else{$tempoTarefa};$modo=$null;$resultado='erro';$aviso='Agendador indisponivel; consulte central-diagnostico.log e tente novamente.'}
 $total.Stop()
 Registrar-DiagnosticoCentral $Privado "Central tarefa: total_ms=$($total.ElapsedMilliseconds); tarefa_ms=$tempoTarefa; tarefa_info_ms=$tempoInfo; resultado=$resultado."
 return @{modo=$modo;aviso=$aviso;totalMs=$total.ElapsedMilliseconds;tarefaMs=$tempoTarefa;infoMs=$tempoInfo;resultado=$resultado}
}
function Consultar-EstadoCentral([string]$Privado,[double]$InterfaceMs=0,[bool]$Registrar=$false,[string]$Raiz){
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
 if($Registrar-and$Raiz){$medir.Restart();$versao=try{(& git -C $Raiz log -1 --date=format:'%d/%m/%Y' --pretty=format:'%h  %ad' 2>$null)}catch{'versao indisponivel'};$tempoGit=$medir.ElapsedMilliseconds}
 $total.Stop()
 if($Registrar-or$total.ElapsedMilliseconds-ge1000-or$estado-ne'ok'){
  Registrar-DiagnosticoCentral $Privado "Central estado: total_ms=$($total.ElapsedMilliseconds); supervisor_ms=$tempoSupervisor; estado_ms=$tempoEstado; configuracao_ms=$tempoConfig; git_ms=$tempoGit; interface_ms=$([math]::Round($InterfaceMs,2)); resultado=$estado."
 }
 return @{ativo=$ativo;status=$st;ensaio=$ensaio;avisoBackup=$aviso;migrada=$migrada;totalMs=$total.ElapsedMilliseconds;supervisorMs=$tempoSupervisor;estadoMs=$tempoEstado;configMs=$tempoConfig;versao=$versao;gitMs=$tempoGit}
}
function Novo-ControleCentral {
 return @{trabalhos=@{};proximoEstado=[datetime]::MinValue;proximaTarefa=[datetime]::MinValue;proximoRegistro=[datetime]::MinValue;geracao=0;interfaceMs=0}
}
function Iniciar-TrabalhoCentral($Controle,[string]$Chave,[scriptblock]$Codigo,[object[]]$Argumentos=@()){
 if($Controle.trabalhos.ContainsKey($Chave)){return $false}
 $ps=[powershell]::Create();[void]$ps.AddScript($Codigo.ToString())
 foreach($argumento in $Argumentos){[void]$ps.AddArgument($argumento)}
 try{$async=$ps.BeginInvoke()}catch{$ps.Dispose();throw}
 $Controle.trabalhos[$Chave]=@{ps=$ps;async=$async;tempo=[Diagnostics.Stopwatch]::StartNew();geracao=$Controle.geracao;cancelando=$false}
 return $true
}
function Receber-TrabalhoCentral($Controle,[string]$Chave){
 $trabalho=$Controle.trabalhos[$Chave]
 if(!$trabalho-or!$trabalho.async.IsCompleted){return $null}
 try{$valores=$trabalho.ps.EndInvoke($trabalho.async);$valor=@($valores)[-1];return @{ok=$true;valor=$valor;geracao=$trabalho.geracao}}
 catch{return @{ok=$false;mensagem='Consulta ou comando nao concluido.';geracao=$trabalho.geracao}}
 finally{$trabalho.ps.Dispose();$Controle.trabalhos.Remove($Chave)}
}
function Cancelar-ConsultaCentral($Controle,[string]$Chave,[int]$LimiteMs=30000){
 $trabalho=$Controle.trabalhos[$Chave]
 if($trabalho-and!$trabalho.cancelando-and!$trabalho.async.IsCompleted-and$trabalho.tempo.ElapsedMilliseconds-ge$LimiteMs){
  $trabalho.cancelando=$true;[void]$trabalho.ps.BeginStop($null,$null);return $true
 }
 return $false
}
function Invalidar-ConsultasCentral($Controle,[switch]$Tarefa){
 $Controle.geracao++;$Controle.proximoEstado=[datetime]::MinValue
 if($Tarefa){$Controle.proximaTarefa=[datetime]::MinValue}
}
function Codigo-ConsultaCentral {
 return {
  param($Raiz,$Privado,$Startup,$Tipo,$InterfaceMs,$Registrar)
  $ErrorActionPreference='Stop'
  foreach($nome in @('operacao-logica','inicializacao-logica','central-logica')){. (Join-Path $Raiz "scripts/$nome.ps1")}
  if($Tipo-eq'tarefa'){Consultar-TarefaCentral $Raiz $Privado $Startup}
  else{Consultar-EstadoCentral $Privado $InterfaceMs $Registrar $Raiz}
 }
}
function Iniciar-ConsultasCentral($Controle,[string]$Raiz,[string]$Privado,[string]$Startup,[datetime]$Agora=[datetime]::UtcNow){
 $codigo=Codigo-ConsultaCentral
 if($Agora-ge$Controle.proximaTarefa-and!( $Controle.trabalhos.ContainsKey('tarefa'))){
  if(Iniciar-TrabalhoCentral $Controle 'tarefa' $codigo @($Raiz,$Privado,$Startup,'tarefa',0,$false)){$Controle.proximaTarefa=$Agora.AddSeconds(60)}
 }
 if($Agora-ge$Controle.proximoEstado-and!($Controle.trabalhos.ContainsKey('estado'))){
  $registrar=$Agora-ge$Controle.proximoRegistro
  if(Iniciar-TrabalhoCentral $Controle 'estado' $codigo @($Raiz,$Privado,$Startup,'estado',$Controle.interfaceMs,$registrar)){
   $Controle.proximoEstado=$Agora.AddSeconds(5);if($registrar){$Controle.proximoRegistro=$Agora.AddSeconds(60)}
  }
 }
}
function Executar-AcaoCentral([string]$Raiz,[string]$Privado,[string]$Startup,[string]$Tipo,$Dados){
 switch($Tipo){
  'iniciar' {Iniciar-OperacaoConfigurada $Raiz;return @{ok=$true}}
  'parar' {return @{ok=(Parar-Operacao $Raiz)}}
  'validar' {
   $saida=& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Raiz 'scripts/validar-operacao.ps1') 2>&1
   if($LASTEXITCODE){throw ($saida-join"`n")};return @{ok=$true;mensagem='Configuracao aprovada.'}
  }
  'testar-backup' {
   $saida=& (Localizar-NodeMaquina) --experimental-strip-types (Join-Path $Raiz 'portal/scripts/testar-restauracao.mjs') 2>&1
   if($LASTEXITCODE){throw ($saida-join"`n")};return @{ok=$true;mensagem=($saida-join"`n")}
  }
  'restaurar' {
   if(!(Parar-Operacao $Raiz)){throw 'A operacao nao encerrou. Restauracao cancelada para nao mexer no banco com o portal no ar.'}
   $argumentos=@((Join-Path $Raiz 'portal/scripts/restaurar-backup.mjs'),'--sim');if($Dados.anterior){$argumentos+='--anterior'}
   $saida=& (Localizar-NodeMaquina) --experimental-strip-types @argumentos 2>&1
   if($LASTEXITCODE){throw ($saida-join"`n")};return @{ok=$true;mensagem=(($saida-join"`n")+"`n`nInicie a operacao para voltar ao ar.")}
  }
  'atualizar' {
   if((Obter-TarefaSupplyVision $Raiz)-and!(Testar-Elevacao)){return @{elevar=$true}}
   $op=Join-Path $Privado 'operacao';New-Item -ItemType Directory -Force $op|Out-Null
   $saida=Join-Path $op 'atualizacao-processo-saida.log';$erro=Join-Path $op 'atualizacao-erro.log';Remove-Item $saida,$erro -Force -ErrorAction SilentlyContinue
   Remove-Item -LiteralPath (Join-Path $op 'atualizacao-andamento.json') -Force -ErrorAction SilentlyContinue
   $argumentos='-NoProfile -ExecutionPolicy Bypass -File "'+(Join-Path $Raiz 'scripts/atualizar-servidor.ps1')+'"'
   $proc=Start-Process powershell.exe -ArgumentList $argumentos -WindowStyle Hidden -PassThru -RedirectStandardOutput $saida -RedirectStandardError $erro
   [void]$proc.Handle # Conserva o handle para obter ExitCode apos encerrar (PowerShell 5.1).
   return @{ok=$true;processo=$proc;saida='atualizacao-processo-saida.log'}
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
    # Central ja aberta antes da troca: o worker le o codigo novo, mas stdout
    # ainda esta no nome legado. Escolhe a captura mais recente, nao os tempos.
    $captura=@('atualizacao-processo-saida.log','atualizacao-saida.log')|ForEach-Object {Get-Item -LiteralPath (Join-Path $op $_) -ErrorAction SilentlyContinue}|Where-Object {
     # Na G0, este nome tambem podia conter apenas medicoes do pai.
     @(Get-Content -LiteralPath $_.FullName -Tail 12 -ErrorAction SilentlyContinue|Where-Object {$_-match'\S'-and$_-notmatch'^\[\d{4}-\d{2}-\d{2} '}).Count-gt0
    }|Sort-Object LastWriteTimeUtc -Descending|Select-Object -First 1
    if($captura){$arquivoSaida=$captura.FullName}
   }
   $texto=@(Get-Content -LiteralPath $arquivoSaida -ErrorAction SilentlyContinue)-join"`n"
   $concluiu=Testar-ConclusaoAtualizacao $Dados.codigo $texto
   $versao=try{(& git -C $Raiz log -1 --date=format:'%d/%m/%Y' --pretty=format:'%h  %ad' 2>$null)}catch{'versao indisponivel'}
   if($concluiu){$mensagem=if($texto-like'*Nada a fazer*'){'O sistema ja esta na versao mais recente.'}else{'Sistema atualizado e operacao reiniciada.'}}
   else{
    $e=@(Filtrar-AvisosAtualizacao @(Get-Content (Join-Path $op 'atualizacao-erro.log') -ErrorAction SilentlyContinue)|Select-Object -Last 8)
    $s=@(Filtrar-AvisosAtualizacao @(Get-Content $arquivoSaida -ErrorAction SilentlyContinue)|Select-Object -Last 12)
    $mensagem=@("Codigo de saida: $($Dados.codigo). Conclusao nao confirmada.";$(if($e){'ERRO:';$e});$(if($s){'ULTIMAS ETAPAS:';$s}))-join"`n"
    if(!$mensagem){$mensagem='Consulte os registros da operacao para mais detalhes.'}
   }
   $andamento=Consultar-AndamentoCentral $Privado
   if($andamento){$mensagem+="`n`nTempo total: $($andamento.totalSegundos) s.";if($andamento.resumo){$mensagem+="`n$($andamento.resumo)"}}
   return @{ok=$concluiu;mensagem=$mensagem;versao=$versao;andamento=$andamento}
  }
  default {throw 'Comando da central desconhecido.'}
 }
}
function Codigo-AcaoCentral {
 return {
  param($Raiz,$Privado,$Startup,$Tipo,$Dados)
  $ErrorActionPreference='Stop'
  foreach($nome in @('operacao-logica','inicializacao-logica','migracao-logica','central-logica')){. (Join-Path $Raiz "scripts/$nome.ps1")}
  try{Executar-AcaoCentral $Raiz $Privado $Startup $Tipo $Dados}
  catch{return @{ok=$false;erro=$true;mensagem=$_.Exception.Message}}
 }
}

# Leitura pequena em worker proprio: nao disputa o worker do Agendador.
function Consultar-AndamentoCentral([string]$Privado,[datetime]$Agora=[datetime]::UtcNow) {
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
  return @{nome=$j.nome;numero=[int]$j.numero;total=[int]$j.total;modo=$j.modo;estado=$j.estado;etapaSegundos=$etapa;totalSegundos=$total;restanteSegundos=$restante;progresso=$progresso;resumo=$resumo;inicioGeral=$inicio;inicioEtapa=$inicioEtapa}
 }catch{return $null}
}
function Iniciar-ConsultaAndamentoCentral($Controle,[string]$Raiz,[string]$Privado) {
 [void](Iniciar-TrabalhoCentral $Controle 'andamento' {
  param($Raiz,$Privado)
  . (Join-Path $Raiz 'scripts/central-logica.ps1')
  Consultar-AndamentoCentral $Privado
 } @($Raiz,$Privado))
}
