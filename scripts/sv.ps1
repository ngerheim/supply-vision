# CLI Supply Vision, Windows PowerShell 5.1. Toda saida passa pelo filtro ASCII.
# Sem param(): -n, --help e opcoes desconhecidas chegam intactos ao parser.
$svArgumentos=@($args)
$ErrorActionPreference='Stop'
$svRaiz=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
foreach($svNome in @('operacao-logica','inicializacao-logica','migracao-logica','administracao-logica','diagnostico-logica','atualizacao-preparo')){
 . (Join-Path $PSScriptRoot ($svNome+'.ps1'))
}
function Converter-TextoSv([string]$Texto){
 $Texto=$Texto.Replace([string][char]0x2705,'[OK]').Replace([string][char]0x274C,'[ERRO]').Replace([string][char]0x26A0,'[AVISO]')
 $normal=$Texto.Normalize([Text.NormalizationForm]::FormD)
 return [regex]::Replace($normal,'[^\x00-\x7F]','')
}
function Escrever-Sv([string]$Texto){
 foreach($linha in ($Texto-split'\r?\n')){Write-Host (Converter-TextoSv (Mascarar-Homologacao $linha $script:svSegredos))}
}
function Ajuda-Sv([string]$Comando){
 $ajudas=@{
  status='sv status | Operacao, versao, health, inicializacao, manutencao, preparo e ultimo resumo. Somente leitura.'
  iniciar='sv iniciar | Solicita inicio e aguarda supervisor e health local por ate 60 s.'
  parar='sv parar | Aguarda parada completa da operacao.'
  atualizar='sv atualizar [--completo] | Processo independente; --completo forca todas as suites. Ctrl+C encerra apenas o acompanhamento. Ex.: sv atualizar --completo'
  acompanhar='sv acompanhar | Reconecta a atualizacao em andamento ou mostra o ultimo resumo. Ctrl+C encerra apenas o acompanhamento.'
  homologar='sv homologar [--copiar] [--destino arquivo.txt] | Mostra e salva relatorio mascarado. Ex.: sv homologar --copiar --destino "C:\Temp\homologacao.txt"'
  saude='sv saude [--desde "yyyy-MM-dd HH:mm"] | Padrao: ultimas 24 h. Falhas por motivo, partida e reinicios; Portal desde o ultimo reinicio.'
  logs='sv logs <supervisor|portal|atualizacao|emails|relatorios> [-n 80] | Ultimas linhas de cada log, com dados sensiveis mascarados. Ex.: sv logs portal -n 120'
  config='sv config validar | Executa validar-operacao.ps1.'
  backup='sv backup testar | sv backup restaurar [--anterior] [--sim] | Restaurar para a operacao e exige RESTAURAR, ou --sim para automacao.'
  modo='sv modo <desligado|login|computador> | Exige operacao parada e terminal como administrador. Ex.: sv modo computador'
  manutencao='sv manutencao <on|off> | Pausa ou libera rotinas automaticas. Ex.: sv manutencao on'
  firewall='sv firewall restringir | Restringe acesso de rede pelo script atual, com teste interativo. Exige administrador.'
  migrar='sv migrar --destino <pasta> --modo <ensaio|definitiva> | Exige administrador. Definitiva exige digitar MIGRAR. Ex.: sv migrar --destino "E:\semente" --modo ensaio'
 }
 if($Comando){if(!$ajudas.ContainsKey($Comando)){throw "Comando desconhecido: $Comando"};Escrever-Sv $ajudas[$Comando];return}
 Escrever-Sv 'Supply Vision - sv <comando> [opcoes]'
 foreach($chave in @('status','iniciar','parar','atualizar','acompanhar','homologar','saude','logs','config','backup','modo','manutencao','firewall','migrar')){Escrever-Sv $ajudas[$chave]}
 Escrever-Sv 'Ajuda: sv help | sv <comando> --help | sv help <comando>'
}
function Ler-ComandoSv([object[]]$Argumentos){
 if(!$Argumentos.Count){return @{comando='help';posicionais=@();opcoes=@{}}}
 $comando=([string]$Argumentos[0]).ToLowerInvariant();$posicionais=@();$opcoes=@{}
 $permitidas=switch($comando){
  'atualizar' {@('--completo')}
  'homologar' {@('--copiar','--destino')}
  'saude' {@('--desde')}
  'logs' {@('-n')}
  'backup' {@('--anterior','--sim')}
  'migrar' {@('--destino','--modo')}
  default {@()}
 }
 for($i=1;$i-lt$Argumentos.Count;$i++){
  $arg=[string]$Argumentos[$i]
  if($arg-eq'--help'){return @{comando='help';posicionais=@($comando);opcoes=@{}}}
  if($arg.StartsWith('-')){
   if($arg-notin$permitidas){throw "Opcao desconhecida para ${comando}: $arg. Use sv $comando --help."}
   if($opcoes.ContainsKey($arg)){throw "Opcao repetida: $arg"}
   if($arg-in@('--destino','--desde','--modo','-n')){
    $i++;if($i-ge$Argumentos.Count-or([string]$Argumentos[$i]).StartsWith('-')){throw "Falta valor para $arg"}
    $opcoes[$arg]=[string]$Argumentos[$i]
   }else{$opcoes[$arg]=$true}
  }else{$posicionais+=$arg}
 }
 if($comando-in@('--help','-h')){$comando='help'}
 return @{comando=$comando;posicionais=$posicionais;opcoes=$opcoes}
}
function Exigir-AdministradorSv {
 if(!(Testar-Elevacao)){throw 'Este comando exige permissao: abra o terminal como administrador.'}
}
function Executar-AcaoSv([string]$Tipo,$Dados=@{}){
 $valores=@(& {Executar-AcaoCentral $script:svRaiz $script:svPrivado $script:svStartup $Tipo $Dados} 6>&1)
 $r=$null
 foreach($valor in $valores){if($valor-is[hashtable]-and$valor.ContainsKey('ok')){$r=$valor}elseif($valor-is[hashtable]-and$valor.elevar){$r=$valor}else{Escrever-Sv ([string]$valor)}}
 if($r.elevar){Exigir-AdministradorSv;throw 'Atualizacao nao iniciada.'}
 if($r.mensagem){Escrever-Sv $r.mensagem}
 if(!$r.ok){throw 'Comando nao concluido. Consulte sv logs supervisor ou sv logs atualizacao.'}
 return $r
}
function Mostrar-ProgressoSv($a){
 if(!$a){Escrever-Sv 'Aguardando arquivo de andamento...';return}
 $restante=if($null-eq$a.restanteSegundos){'indisponivel'}else{"$($a.restanteSegundos) s"}
 Escrever-Sv "Etapa $($a.numero) de $($a.total): $($a.nome) | etapa $($a.etapaSegundos) s | total $($a.totalSegundos) s | restante estimado: $restante | modo $($a.modo)"
}
function Mostrar-ResultadoSv($Codigo=$null){
 $r=Executar-AcaoCentral $script:svRaiz $script:svPrivado $script:svStartup 'fim-atualizacao' @{codigo=$Codigo;saida='atualizacao-processo-saida.log'}
 Escrever-Sv $r.mensagem
 return [bool]$r.ok
}
function Acompanhar-AtualizacaoSv($Processo=$null){
 Escrever-Sv 'Ctrl+C ou fechar o terminal encerra apenas o acompanhamento. Para voltar: sv acompanhar.'
 while($true){
  $p=if($Processo){$Processo}else{Consultar-AtualizacaoAdministrada $script:svRaiz $script:svPrivado}
  Mostrar-ProgressoSv (Consultar-AndamentoCentral $script:svPrivado)
  if(!$p-or$p.HasExited){break}
  # O recibo pertence a esta execucao; tambem permite reconectar quando o
  # sistema ainda conserva um processo encerrado na tabela de processos.
  $recibo=Join-Path $script:svPrivado 'operacao/atualizacao-resultado.json'
  if(Test-Path -LiteralPath $recibo){
   try{
    $fim=Get-Content -LiteralPath $recibo -Raw -Encoding UTF8|ConvertFrom-Json
    $registro=Get-Content -LiteralPath (Join-Path $script:svPrivado 'operacao/atualizacao-processo.json') -Raw -Encoding UTF8|ConvertFrom-Json
    if($fim.execucao-eq$registro.execucao-and$registro.pid-eq$p.Id){break}
   }catch{}
  }
  Start-Sleep -Seconds 1
 }
 $codigo=$null
 if($Processo){$Processo.WaitForExit();$Processo.Refresh();$codigo=$Processo.ExitCode}
 else{
  $arquivo=Join-Path $script:svPrivado 'operacao/atualizacao-resultado.json'
  if(Test-Path -LiteralPath $arquivo){$codigo=(Get-Content -LiteralPath $arquivo -Raw -Encoding UTF8|ConvertFrom-Json).codigo}
 }
 return Mostrar-ResultadoSv $codigo
}
function Consultar-HealthSv([string]$Url){
 if(!$Url){return 'nao configurado'}
 try{
  $uri=[uri]($Url.TrimEnd('/')+'/api/health')
  if($uri.Scheme-notin@('http','https')-or$uri.UserInfo){return 'endereco invalido'}
  $h=Invoke-RestMethod -Uri $uri -TimeoutSec 5
  if($h.status-eq'ok'){return 'ok'}
  return 'resposta invalida'
 }catch{return 'indisponivel'}
}
function Mostrar-StatusSv {
 $d=Consultar-EstadoCentral $script:svPrivado 0 $true $script:svRaiz -SomenteLeitura
 $t=Consultar-TarefaCentral $script:svRaiz $script:svPrivado $script:svStartup -SomenteLeitura
 Escrever-Sv ('Operacao: '+$(if($d.ativo){'ativa'}else{'parada'}))
 if($d.migrada){Escrever-Sv 'Esta instalacao foi migrada para outro servidor.'}
 if($d.status){
  $st=$d.status
  Escrever-Sv "Portal: $($st.portal) | E-mails: $($st.emails) | Alertas: $($st.alertas) | Backup: $($st.backup) | Limpeza: $($st.limpeza) | Disco: $($st.espacoLivreGb) GB livres"
 }elseif($d.ativo){Escrever-Sv 'Inicializando modulos...'}
 Escrever-Sv "Versao: $($d.versao)"
 $cfg=@{};$arquivo=Join-Path $script:svPrivado 'portal/configuracao/portal.env'
 if(Test-Path -LiteralPath $arquivo){$cfg=Ler-ConfigOperacao $arquivo}
 Escrever-Sv ('Health local: '+(Consultar-HealthSv ('http://127.0.0.1:'+(Obter-PortaPortalLocal $cfg))))
 Escrever-Sv ('Health rede: '+(Consultar-HealthSv $cfg['PORTAL_URL']))
 Escrever-Sv "Inicializacao: $($t.modo) | $($t.aviso)"
 Escrever-Sv ('Manutencao: '+$(if(Test-Path -LiteralPath (Join-Path $script:svPrivado 'operacao/manutencao.sinal')){'on'}else{'off'}))
 Escrever-Sv ('Ensaio: '+$d.ensaio+' | '+$d.avisoBackup)
 $p=Consultar-AtualizacaoAdministrada $script:svRaiz $script:svPrivado
 Escrever-Sv ('Atualizacao: '+$(if($p){'em andamento'}else{'sem processo ativo'}))
 $andamento=Consultar-AndamentoCentral $script:svPrivado
 if($andamento){Mostrar-ProgressoSv $andamento}
 Escrever-Sv ('Limpeza de preparo em segundo plano: '+(Consultar-LimpezaAdministrada $script:svPrivado))
 $reserva=Pasta-ReservaDependencias $script:svRaiz
 if(Test-Path -LiteralPath $reserva){
  $origem='registro indisponivel'
  try{$j=Get-Content -LiteralPath (Join-Path $reserva 'registro.json') -Raw -Encoding UTF8|ConvertFrom-Json;$origem="commit $($j.sha); data $($j.data)"}catch{}
  Escrever-Sv "Reserva de dependencias: presente; origem $origem"
 }else{Escrever-Sv 'Reserva de dependencias: ausente'}
 Escrever-Sv 'Ultimo resumo de atualizacao:'
 $resumo=@(Get-Content -LiteralPath (Join-Path $script:svPrivado 'operacao/atualizacao-tempos.log') -Tail 80 -Encoding UTF8 -ErrorAction SilentlyContinue|Where-Object {$_-like'*Resumo atualizacao:*'}|Select-Object -Last 1)
 if($resumo){Escrever-Sv ($resumo-join'')}else{Escrever-Sv 'Nenhum resumo registrado.'}
}
function Mostrar-SaudeSv([datetime]$Desde){
 Escrever-Sv ('Saude desde '+$Desde.ToString('yyyy-MM-dd HH:mm'))
 $arquivo=Join-Path $script:svPrivado 'operacao/supervisor.log'
 $linhas=@();if(Test-Path -LiteralPath $arquivo){$linhas=@(Get-Content -LiteralPath $arquivo -Encoding UTF8)}
 $s=Analisar-SaudeSupervisor $linhas $Desde
 Escrever-Sv "Supervisor iniciado no periodo: $($s.reinicios) (inclui a primeira partida registrada)."
 foreach($grupo in @($s.falhas|Group-Object motivo|Sort-Object Name)){Escrever-Sv ("Motivo $($grupo.Name): $($grupo.Count)")}
 Escrever-Sv "Falhas de health: $($s.falhas.Count)"
 foreach($falha in $s.falhas){
  $marca=if($falha.partida){' [partida]'}else{''}
  Escrever-Sv ($falha.hora.ToString('yyyy-MM-dd HH:mm:ss')+$marca+' '+$falha.texto)
 }
 $portal=@(Localizar-LogsOperacao $script:svPrivado 'portal'|ForEach-Object {Get-Content -LiteralPath $_.FullName -Encoding UTF8})
 # Nao aplica --desde a linhas sem timestamp do runtime; declara a cobertura real.
 Escrever-Sv 'Portal: logs atuais cobrem so desde o ultimo reinicio; contagens abaixo abrangem esses arquivos (sem recorte --desde).'
 $http=@($portal|Where-Object {$_-match'(?i)(?:\bHTTP(?:/\d(?:\.\d)?)?\s+|\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\S+\s+|\bstatus(?:Code)?["\s:=]+)5\d\d\b'})
 $d1=@($portal|Where-Object {$_-match'\bD1_ERROR\b'})
 $retry=@($portal|Where-Object {$_-match'(?i)D1.*(retent|retry|tentativa)|(?:retent|retry|tentativa).*D1'})
 Escrever-Sv "HTTP 5xx: $($http.Count) | D1_ERROR: $($d1.Count) | Retentativas D1: $($retry.Count)"
}
function Executar-ComandoSv($c){
 $p=@($c.posicionais);$o=$c.opcoes;$comando=$c.comando
 $quantidade=switch($comando){'help'{-1} 'logs'{1} 'config'{1} 'backup'{1} 'modo'{1} 'manutencao'{1} 'firewall'{1} default{0}}
 if($quantidade-ge0-and$p.Count-ne$quantidade){throw "Argumentos invalidos. Use sv $comando --help."}
 switch($comando){
  'help' {if($p.Count-gt1){throw 'Use sv help [comando].'};Ajuda-Sv ($p|Select-Object -First 1);return 0}
  'status' {Mostrar-StatusSv;return 0}
  'iniciar' {
   if(Obter-TarefaSupplyVision $script:svRaiz){Exigir-AdministradorSv}
   [void](Executar-AcaoSv 'iniciar')
   $cfg=Ler-ConfigOperacao (Join-Path $script:svPrivado 'portal/configuracao/portal.env')
   $url='http://127.0.0.1:'+(Obter-PortaPortalLocal $cfg);$tempo=[Diagnostics.Stopwatch]::StartNew()
   do{
    if(!(Testar-SupervisorEncerrado $script:svPrivado)-and(Consultar-HealthSv $url)-eq'ok'){Escrever-Sv 'Operacao iniciada; health local ok.';return 0}
    Start-Sleep -Seconds 1
   }while($tempo.Elapsed.TotalSeconds-lt60)
   throw 'Inicio nao confirmado em 60 s. Consulte sv status e sv logs supervisor.'
  }
  'parar' {if(Obter-TarefaSupplyVision $script:svRaiz){Exigir-AdministradorSv};[void](Executar-AcaoSv 'parar');Escrever-Sv 'Operacao parada.';return 0}
  'atualizar' {
   if(Obter-TarefaSupplyVision $script:svRaiz){Exigir-AdministradorSv}
   $r=Executar-AcaoSv 'atualizar' @{completo=[bool]$o['--completo']}
   try{if(Acompanhar-AtualizacaoSv $r.processo){return 0};return 1}finally{$r.processo.Dispose()}
  }
  'acompanhar' {
   $processo=Consultar-AtualizacaoAdministrada $script:svRaiz $script:svPrivado
   if(!$processo){
    Escrever-Sv 'Nao ha atualizacao em andamento.'
    $captura=Join-Path $script:svPrivado 'operacao/atualizacao-processo-saida.log'
    if(!(Test-Path -LiteralPath $captura)){Escrever-Sv 'Nenhum resumo registrado.';return 0}
   }
   if(Acompanhar-AtualizacaoSv){return 0};return 1
  }
  'homologar' {
   $destino=$o['--destino']
   if(!$destino){$destino=Join-Path ([Environment]::GetFolderPath('Desktop')) ('Supply-Vision-homologacao-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.txt')}
   & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'homologar.ps1') -Destino $destino 2>&1|ForEach-Object {Escrever-Sv ([string]$_)}
   if($LASTEXITCODE){throw 'Falha ao gerar relatorio de homologacao.'}
   $texto=Get-Content -LiteralPath $destino -Raw -Encoding UTF8
   Escrever-Sv $texto
   if($o['--copiar']){Set-Clipboard -Value $texto;Escrever-Sv 'Relatorio copiado para a area de transferencia.'}
   # A execucao do diagnostico concluiu; itens reprovados tambem sinalizam falha.
   if($texto.Contains([string][char]0x274C)){return 1};return 0
  }
  'saude' {
   $desde=(Get-Date).AddHours(-24)
   if($o['--desde']){$desde=[datetime]::ParseExact($o['--desde'],'yyyy-MM-dd HH:mm',[Globalization.CultureInfo]::InvariantCulture)}
   Mostrar-SaudeSv $desde;return 0
  }
  'logs' {
   if($p[0]-notin@('supervisor','portal','atualizacao','emails','relatorios')){throw 'Tipo de log invalido. Use sv logs --help.'}
   $n=80;if($o['-n']){$n=[int]$o['-n'];if($n-lt1-or$n-gt100000){throw '-n deve estar entre 1 e 100000.'}}
   $arquivos=@(Localizar-LogsOperacao $script:svPrivado $p[0])
   if(!$arquivos.Count){Escrever-Sv 'Nenhum log encontrado.';return 0}
   foreach($arquivo in $arquivos){Escrever-Sv ('--- '+$arquivo.Name+' ---');Get-Content -LiteralPath $arquivo.FullName -Tail $n -Encoding UTF8|ForEach-Object {Escrever-Sv $_}}
   return 0
  }
  'config' {if($p[0]-ne'validar'){throw 'Use sv config validar.'};[void](Executar-AcaoSv 'validar');return 0}
  'backup' {
   if($p[0]-eq'testar'){if($o.Count){throw 'Opcoes de restauracao nao se aplicam a backup testar.'};[void](Executar-AcaoSv 'testar-backup');return 0}
   if($p[0]-ne'restaurar'){throw 'Use sv backup testar ou sv backup restaurar.'}
   if(Obter-TarefaSupplyVision $script:svRaiz){Exigir-AdministradorSv}
   Escrever-Sv 'A operacao sera parada e o banco atual sera substituido pelo backup.'
   if(!$o['--sim']-and(Read-Host 'Digite RESTAURAR para confirmar')-cne'RESTAURAR'){throw 'Restauracao cancelada.'}
   [void](Executar-AcaoSv 'restaurar' @{anterior=[bool]$o['--anterior']});return 0
  }
  'modo' {
   if($p[0]-notin@('desligado','login','computador')){throw 'Modo invalido: use desligado, login ou computador.'}
   Exigir-AdministradorSv;[void](Executar-AcaoSv 'modo' @{modo=$p[0]});Escrever-Sv 'Modo de inicializacao alterado.';return 0
  }
  'manutencao' {
   if($p[0]-notin@('on','off')){throw 'Use sv manutencao on ou off.'}
   [void](Executar-AcaoSv 'manutencao' @{ativo=($p[0]-eq'on')});Escrever-Sv ('Manutencao: '+$p[0]);return 0
  }
  'firewall' {
   if($p[0]-ne'restringir'){throw 'Use sv firewall restringir.'};Exigir-AdministradorSv
   & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $script:svRaiz 'portal/scripts/restringir-firewall.ps1') 2>&1|ForEach-Object {Escrever-Sv ([string]$_)}
   if($LASTEXITCODE){throw 'Restricao de firewall nao concluida.'};return 0
  }
  'migrar' {
   if(!$o['--destino']-or$o['--modo']-notin@('ensaio','definitiva')){throw 'Use sv migrar --destino <pasta> --modo <ensaio|definitiva>.'}
   Exigir-AdministradorSv
   if($o['--modo']-eq'definitiva'-and(Read-Host 'Digite MIGRAR para confirmar a migracao definitiva')-cne'MIGRAR'){throw 'Migracao cancelada.'}
   [void](Executar-AcaoSv 'migrar' @{destino=$o['--destino'];modo=$o['--modo']});return 0
  }
  default {throw "Comando desconhecido: $comando. Use sv help."}
 }
}
# Dot-source permite o harness testar o mesmo dispatcher sem ganchos no produto.
if($MyInvocation.InvocationName-ne'.'){
 $script:svSegredos=@()
 try{
  $c=Ler-ComandoSv $svArgumentos
  if($c.comando-eq'help'){$codigo=Executar-ComandoSv $c}
  else{
   $script:svPrivado=Obter-PastaPrivada $svRaiz
   $inicio=[Environment]::GetFolderPath('Startup');$script:svStartup=if($inicio){Join-Path $inicio 'Supply Vision.cmd'}else{''}
   $script:svSegredos=Obter-SegredosHomologacao $script:svPrivado
   $codigo=Executar-ComandoSv $c
  }
  exit ([int]$codigo)
 }catch{Escrever-Sv ('ERRO: '+$_.Exception.Message);exit 1}
}
