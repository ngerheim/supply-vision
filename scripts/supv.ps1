# CLI Supply Vision, Windows PowerShell 5.1. Toda saida passa pelo filtro ASCII.
# Sem param(): -n, --help e opcoes desconhecidas chegam intactos ao parser.
$supvArgumentos=@($args)
$ErrorActionPreference='Stop'
$supvRaiz=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
foreach($supvNome in @('operacao-logica','inicializacao-logica','administracao-logica','diagnostico-logica','atualizacao-preparo')){
 . (Join-Path $PSScriptRoot ($supvNome+'.ps1'))
}
# A area de transferencia pertence a um processo STA isolado. Nem COM nem
# handles herdados podem impedir o encerramento do cliente supv.
function Obter-CodigoCopiaSupv {
 return @'
$ErrorActionPreference='Stop'
try {
 Add-Type -AssemblyName System.Windows.Forms
 [Windows.Forms.Clipboard]::SetText([IO.File]::ReadAllText($env:SUPV_RELATORIO_COPIA))
 [Environment]::Exit(0)
} catch { [Environment]::Exit(1) }
'@
}
function Copiar-RelatorioSupv([string]$Texto,[int]$LimiteMs=5000) {
 $arquivo=Join-Path ([IO.Path]::GetTempPath()) ('supv-copia-'+[guid]::NewGuid().ToString('N')+'.txt')
 $processo=New-Object Diagnostics.Process
 try{
  [IO.File]::WriteAllText($arquivo,$Texto,[Text.Encoding]::ASCII)
  $info=New-Object Diagnostics.ProcessStartInfo
  $info.FileName=(Get-Process -Id $PID).Path
  $sta=if($env:OS-eq'Windows_NT'){'-STA '}else{''}
  $codigo=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes((Obter-CodigoCopiaSupv)))
  $info.Arguments=$sta+'-NoProfile -NonInteractive -EncodedCommand '+$codigo
  $info.UseShellExecute=$false;$info.CreateNoWindow=$true
  $info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
  $info.EnvironmentVariables['SUPV_RELATORIO_COPIA']=$arquivo
  $processo.StartInfo=$info
  [void]$processo.Start()
  $processo.StandardInput.Close()
  # Drena sem esperar EOF indefinidamente, inclusive no caminho de falha.
  $saida=$processo.StandardOutput.ReadToEndAsync();$erro=$processo.StandardError.ReadToEndAsync()
  if(!$processo.WaitForExit($LimiteMs)){return $false}
  return $processo.ExitCode-eq0
 }catch{return $false}
 finally{
  try{if($processo.Id-and!$processo.HasExited){$processo.Kill();[void]$processo.WaitForExit(250)}}catch{}
  $processo.Dispose()
  Remove-Item -LiteralPath $arquivo -Force -ErrorAction SilentlyContinue
 }
}
function Converter-TextoSupv([string]$Texto){
 $Texto=$Texto.Replace([string][char]0x2705,'[OK]').Replace([string][char]0x274C,'[ERRO]').Replace([string][char]0x26A0,'[AVISO]')
 $normal=$Texto.Normalize([Text.NormalizationForm]::FormD)
 return [regex]::Replace($normal,'[^\x00-\x7F]','')
}
function Escrever-Supv([string]$Texto){
 foreach($linha in ($Texto-split'\r?\n')){Write-Host (Converter-TextoSupv (Mascarar-Homologacao $linha $script:supvSegredos))}
}
function Ajuda-Supv([string]$Comando){
 $ajudas=@{
  status='supv status | Operacao, versao, health, inicializacao, manutencao, preparo e ultimo resumo. Somente leitura.'
  iniciar='supv iniciar | Solicita inicio e aguarda supervisor e health local por ate 60 s.'
  parar='supv parar | Aguarda parada completa da operacao.'
  atualizar='supv atualizar [--completo] | Processo independente; --completo forca todas as suites. Ctrl+C cancela a espera do CI; nas outras fases encerra apenas o acompanhamento. Ex.: supv atualizar --completo'
  acompanhar='supv acompanhar | Reconecta a atualizacao em andamento ou mostra o ultimo resumo. Ctrl+C cancela a espera do CI; nas outras fases encerra apenas o acompanhamento.'
  homologar='supv homologar [--copiar] [--destino arquivo.txt] | Mostra e salva relatorio mascarado. Ex.: supv homologar --copiar --destino "C:\Temp\homologacao.txt"'
  saude='supv saude [--desde "yyyy-MM-dd HH:mm"] | Padrao: ultimas 24 h. Falhas por motivo, partida e reinicios; Portal desde o ultimo reinicio.'
  logs='supv logs <supervisor|portal|atualizacao|emails|relatorios> [-n 80] [--bruto] | Atualizacao sem progresso git e diagnosticos de build; --bruto mostra todas as linhas. Dados sensiveis continuam mascarados. Ex.: supv logs portal -n 120'
  config='supv config validar | Executa validar-operacao.ps1.'
  backup='supv backup senha | supv backup testar | supv backup restaurar [--data AAAA-MM-DD_HHMM] [--configuracao] [--sim] | Lista a rede; padrao mais recente. Restaurar para a operacao e exige RESTAURAR, ou --sim.'
  modo='supv modo <desligado|computador> | Exige operacao parada e terminal como administrador. Ex.: supv modo computador'
  manutencao='supv manutencao <on|off> | Pausa ou libera rotinas automaticas. Ex.: supv manutencao on'
  firewall='supv firewall restringir | Restringe acesso de rede pelo script atual, com teste interativo. Exige administrador.'
 }
 if($Comando){if(!$ajudas.ContainsKey($Comando)){throw "Comando desconhecido: $Comando"};Escrever-Supv $ajudas[$Comando];return}
 Escrever-Supv 'Supply Vision - supv <comando> [opcoes]'
 foreach($chave in @('status','iniciar','parar','atualizar','acompanhar','homologar','saude','logs','config','backup','modo','manutencao','firewall')){Escrever-Supv $ajudas[$chave]}
 Escrever-Supv 'Ajuda: supv help | supv <comando> --help | supv help <comando>'
}
function Ler-ComandoSupv([object[]]$Argumentos){
 if(!$Argumentos.Count){return @{comando='help';posicionais=@();opcoes=@{}}}
 $comando=([string]$Argumentos[0]).ToLowerInvariant();$posicionais=@();$opcoes=@{}
 $permitidas=switch($comando){
  'atualizar' {@('--completo')}
  'homologar' {@('--copiar','--destino')}
  'saude' {@('--desde')}
  'logs' {@('-n','--bruto')}
  'backup' {@('--anterior','--sim','--data','--configuracao')}
  default {@()}
 }
 for($i=1;$i-lt$Argumentos.Count;$i++){
  $arg=[string]$Argumentos[$i]
  if($arg-eq'--help'){return @{comando='help';posicionais=@($comando);opcoes=@{}}}
  if($arg.StartsWith('-')){
   if($arg-notin$permitidas){throw "Opcao desconhecida para ${comando}: $arg. Use supv $comando --help."}
   if($opcoes.ContainsKey($arg)){throw "Opcao repetida: $arg"}
   if($arg-in@('--destino','--desde','--modo','--data','-n')){
    $i++;if($i-ge$Argumentos.Count-or([string]$Argumentos[$i]).StartsWith('-')){throw "Falta valor para $arg"}
    $opcoes[$arg]=[string]$Argumentos[$i]
   }else{$opcoes[$arg]=$true}
  }else{$posicionais+=$arg}
 }
 if($comando-in@('--help','-h')){$comando='help'}
 return @{comando=$comando;posicionais=$posicionais;opcoes=$opcoes}
}
function Exigir-AdministradorSupv {
 if(!(Testar-Elevacao)){throw 'Este comando exige permissao: abra o terminal como administrador.'}
}
function Executar-AcaoSupv([string]$Tipo,$Dados=@{}){
 $valores=@(& {Executar-AcaoAdministrada $script:supvRaiz $script:supvPrivado $Tipo $Dados} 6>&1)
 $r=$null
 foreach($valor in $valores){if($valor-is[hashtable]-and$valor.ContainsKey('ok')){$r=$valor}elseif($valor-is[hashtable]-and$valor.elevar){$r=$valor}else{Escrever-Supv ([string]$valor)}}
 if($r.elevar){Exigir-AdministradorSupv;throw 'Atualizacao nao iniciada.'}
 if($r.mensagem){Escrever-Supv $r.mensagem}
 if(!$r.ok){throw 'Comando nao concluido. Consulte supv logs supervisor ou supv logs atualizacao.'}
 return $r
}
function Mostrar-ProgressoSupv($a,$Exibicao=$null){
 $texto='Aguardando arquivo de andamento...'
 $terminal=$false
 if($a){
  $modo=if($a.modo-in@('rapido','completo')){$a.modo}else{'a definir'}
  if($a.motivoModo-and$modo-ne'a definir'-and($null-eq$Exibicao-or!$Exibicao.motivoMostrado)){
   $motivo=([string]$a.motivoModo -replace '\s+', ' ').Trim()
   Escrever-Supv ("Modo ${modo}: "+$motivo)
   if($null-ne$Exibicao){$Exibicao.motivoMostrado=$true}
  }
  $restante=if($null-eq$a.restanteSegundos){'indisponivel'}else{"$($a.restanteSegundos) s"}
  $texto="Etapa $($a.numero) de $($a.total): $($a.nome) | etapa $($a.etapaSegundos) s | total $($a.totalSegundos) s | restante estimado: $restante | modo $modo"
  if($a.esperaCI.mensagem-and$a.estado-eq'andamento'){$texto=[string]$a.esperaCI.mensagem}
  $terminal=$a.estado-in@('concluido','falhou')
  if($terminal-and$a.erro){$texto+=' | '+(([string]$a.erro-replace'\s+',' ').Trim())}
 }
 if($null-ne$Exibicao){
  # A conclusao fica fixa enquanto o worker termina; os demais textos mudam
  # somente com o andamento visivel, sem repetir a cada consulta do processo.
  if(($terminal-and$Exibicao.terminalMostrado)-or$texto-eq$Exibicao.ultimaLinha){return}
  $Exibicao.ultimaLinha=$texto
  if($terminal){$Exibicao.terminalMostrado=$true}
 }
 Escrever-Supv $texto
}
function Mostrar-ResultadoSupv($Codigo=$null){
 $r=Executar-AcaoAdministrada $script:supvRaiz $script:supvPrivado 'fim-atualizacao' @{codigo=$Codigo;saida='atualizacao-processo-saida.log'}
 Escrever-Supv $r.mensagem
 return [bool]$r.ok
}
function Inicializar-TipoConsoleSupv {
 if(!('SupplyVision.ConsoleAcompanhamento'-as[type])){
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace SupplyVision {
 public sealed class ConsoleAcompanhamento : IDisposable {
  [DllImport("kernel32.dll")] public static extern IntPtr GetStdHandle(int id);
  [DllImport("kernel32.dll")] public static extern bool GetConsoleMode(IntPtr h, out uint mode);
  [DllImport("kernel32.dll")] public static extern bool SetConsoleMode(IntPtr h, uint mode);
  private delegate bool Handler(uint signal);
  [DllImport("kernel32.dll")] private static extern bool SetConsoleCtrlHandler(Handler handler, bool add);
  private readonly IntPtr handle;
  private readonly uint original;
  private readonly Handler handler;
  private bool active;
  private ConsoleAcompanhamento(IntPtr h, uint mode) {
   handle=h; original=mode; handler=OnSignal;
  }
  public static ConsoleAcompanhamento Begin() {
   uint mode; var h=GetStdHandle(-10);
   if(!GetConsoleMode(h, out mode)) return null;
   var guard=new ConsoleAcompanhamento(h, mode);
   // ENABLE_EXTENDED_FLAGS is required to change ENABLE_QUICK_EDIT_MODE.
   if(!SetConsoleCtrlHandler(guard.handler, true)) return null;
   guard.active=true;
   if(!SetConsoleMode(h, (mode | 0x80u) & ~0x40u)) { guard.Dispose(); return null; }
   return guard;
  }
  private bool OnSignal(uint signal) {
   // Restore before PowerShell handles Ctrl+C/Break or console close.
   SetConsoleMode(handle, original);
   return false;
  }
  public void Dispose() {
   if(!active) return;
   SetConsoleMode(handle, original);
   SetConsoleCtrlHandler(handler, false);
   active=false;
   GC.KeepAlive(handler);
  }
 }
}
'@
 }
}
function Suspender-QuickEditSupv {
 if($env:OS-ne'Windows_NT'-or[Console]::IsInputRedirected-or[Console]::IsOutputRedirected){return $null}
 Inicializar-TipoConsoleSupv
 return [SupplyVision.ConsoleAcompanhamento]::Begin()
}

function Acompanhar-AtualizacaoSupv($Processo=$null){
 $console=Suspender-QuickEditSupv
 $exibicao=@{};$concluido=$false
 try{
 Escrever-Supv 'Ctrl+C durante a espera do CI cancela a atualizacao sem parar a operacao. Nas outras fases, encerra apenas o acompanhamento. Para voltar: supv acompanhar.'
 while($true){
  $p=if($Processo){$Processo}else{Consultar-AtualizacaoAdministrada $script:supvRaiz $script:supvPrivado}
  Mostrar-ProgressoSupv (Consultar-AndamentoAdministrado $script:supvPrivado) $exibicao
  if(!$p-or$p.HasExited){break}
  # O recibo pertence a esta execucao; tambem permite reconectar quando o
  # sistema ainda conserva um processo encerrado na tabela de processos.
  $recibo=Join-Path $script:supvPrivado 'operacao/atualizacao-resultado.json'
  if(Test-Path -LiteralPath $recibo){
   try{
    $fim=Get-Content -LiteralPath $recibo -Raw -Encoding UTF8|ConvertFrom-Json
    $registro=Get-Content -LiteralPath (Join-Path $script:supvPrivado 'operacao/atualizacao-processo.json') -Raw -Encoding UTF8|ConvertFrom-Json
    if($fim.execucao-eq$registro.execucao-and$registro.pid-eq$p.Id){break}
   }catch{}
  }
  Start-Sleep -Seconds 1
 }
 $codigo=$null
 if($Processo){$Processo.WaitForExit();$Processo.Refresh();$codigo=$Processo.ExitCode}
 else{
  $arquivo=Join-Path $script:supvPrivado 'operacao/atualizacao-resultado.json'
  if(Test-Path -LiteralPath $arquivo){$codigo=(Get-Content -LiteralPath $arquivo -Raw -Encoding UTF8|ConvertFrom-Json).codigo}
 }
 $concluido=$true
 return Mostrar-ResultadoSupv $codigo
 }finally{
  if(!$concluido){Solicitar-CancelamentoEsperaCI (Join-Path $script:supvPrivado 'operacao/atualizacao-andamento.json')}
  if($console){$console.Dispose()}
 }
}
function Consultar-HealthSupv([string]$Url){
 if(!$Url){return 'nao configurado'}
 try{
  $uri=[uri]($Url.TrimEnd('/')+'/api/health')
  if($uri.Scheme-notin@('http','https')-or$uri.UserInfo){return 'endereco invalido'}
  $h=Invoke-RestMethod -Uri $uri -TimeoutSec 5
  if($h.status-eq'ok'){return 'ok'}
  return 'resposta invalida'
 }catch{return 'indisponivel'}
}
function Mostrar-StatusSupv {
 $d=Consultar-EstadoAdministrado $script:supvPrivado $script:supvRaiz
 $t=Consultar-TarefaAdministrada $script:supvRaiz
 Escrever-Supv ('Operacao: '+$(if($d.ativo){'ativa'}else{'parada'}))
 if($d.status){
  $st=$d.status
  Escrever-Supv "Portal: $($st.portal) | E-mails: $($st.emails) | Alertas: $($st.alertas) | Backup: $($st.backup) | Limpeza: $($st.limpeza) | Disco: $($st.espacoLivreGb) GB livres"
 }elseif($d.ativo){Escrever-Supv 'Inicializando modulos...'}
 Escrever-Supv "Versao: $($d.versao)"
 $cfg=@{};$arquivo=Join-Path $script:supvPrivado 'portal/configuracao/portal.env'
 if(Test-Path -LiteralPath $arquivo){$cfg=Ler-ConfigOperacao $arquivo}
 Escrever-Supv ('Health local: '+(Consultar-HealthSupv ('http://127.0.0.1:'+(Obter-PortaPortalLocal $cfg))))
 Escrever-Supv ('Health rede: '+(Consultar-HealthSupv $cfg['PORTAL_URL']))
 Escrever-Supv ('Inicializacao: '+(@($t.modo,$t.aviso|Where-Object {$_})-join' | '))
 Escrever-Supv ('Manutencao: '+$(if(Test-Path -LiteralPath (Join-Path $script:supvPrivado 'operacao/manutencao.sinal')){'on'}else{'off'}))
 Escrever-Supv ('Ensaio: '+(@([string]$d.ensaio,$d.avisoBackup|Where-Object {$_})-join' | '))
 $p=Consultar-AtualizacaoAdministrada $script:supvRaiz $script:supvPrivado
 Escrever-Supv ('Atualizacao: '+$(if($p){'em andamento'}else{'sem processo ativo'}))
 $ultima=Ler-EstadoOperacao (Join-Path $script:supvPrivado 'operacao/atualizacao.json')
 if($ultima.fase-eq'concluido'-and$ultima.modo-eq'sem-parada'){Escrever-Supv 'Ultima atualizacao: sem parada (so testes/CI/documentacao mudaram)'}
 $andamento=Consultar-AndamentoAdministrado $script:supvPrivado
 if($andamento){Mostrar-ProgressoSupv $andamento}
 Escrever-Supv ('Limpeza de preparo em segundo plano: '+(Consultar-LimpezaAdministrada $script:supvPrivado))
 $reserva=Pasta-ReservaDependencias $script:supvRaiz
 if(Test-Path -LiteralPath $reserva){
  $origem='registro indisponivel'
  try{$j=Get-Content -LiteralPath (Join-Path $reserva 'registro.json') -Raw -Encoding UTF8|ConvertFrom-Json;$origem="commit $($j.sha); data $($j.data)"}catch{}
  Escrever-Supv "Reserva de dependencias: presente; origem $origem"
 }else{Escrever-Supv 'Reserva de dependencias: ausente'}
 Escrever-Supv 'Ultimo resumo de atualizacao:'
 $resumo=@(Get-Content -LiteralPath (Join-Path $script:supvPrivado 'operacao/atualizacao-tempos.log') -Tail 80 -Encoding UTF8 -ErrorAction SilentlyContinue|Where-Object {$_-like'*Resumo atualizacao:*'}|Select-Object -Last 1)
 if($resumo){Escrever-Supv ($resumo-join'')}else{Escrever-Supv 'Nenhum resumo registrado.'}
}
function Mostrar-SaudeSupv([datetime]$Desde){
 Escrever-Supv ('Saude desde '+$Desde.ToString('yyyy-MM-dd HH:mm'))
 $arquivo=Join-Path $script:supvPrivado 'operacao/supervisor.log'
 $linhas=@();if(Test-Path -LiteralPath $arquivo){$linhas=@(Get-Content -LiteralPath $arquivo -Encoding UTF8)}
 $s=Analisar-SaudeSupervisor $linhas $Desde
 Escrever-Supv "Supervisor iniciado no periodo: $($s.reinicios) (inclui a primeira partida registrada)."
 foreach($grupo in @($s.falhas|Group-Object motivo|Sort-Object Name)){Escrever-Supv ("Motivo $($grupo.Name): $($grupo.Count)")}
 Escrever-Supv "Falhas de health: $($s.falhas.Count)"
 foreach($falha in $s.falhas){
  $marca=if($falha.partida){' [partida]'}else{''}
  Escrever-Supv ($falha.hora.ToString('yyyy-MM-dd HH:mm:ss')+$marca+' '+$falha.texto)
 }
 $portal=@(Localizar-LogsOperacao $script:supvPrivado 'portal'|ForEach-Object {Get-Content -LiteralPath $_.FullName -Encoding UTF8})
 # Nao aplica --desde a linhas sem timestamp do runtime; declara a cobertura real.
 Escrever-Supv 'Portal: logs atuais cobrem so desde o ultimo reinicio; contagens abaixo abrangem esses arquivos (sem recorte --desde).'
 $http=@($portal|Where-Object {$_-match'(?i)(?:\bHTTP(?:/\d(?:\.\d)?)?\s+|\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\S+\s+|\bstatus(?:Code)?["\s:=]+)5\d\d\b'})
 Escrever-Supv "HTTP 5xx: $($http.Count)"
}
function Executar-ComandoSupv($c){
 $p=@($c.posicionais);$o=$c.opcoes;$comando=$c.comando
 $quantidade=switch($comando){'help'{-1} 'logs'{1} 'config'{1} 'backup'{1} 'modo'{1} 'manutencao'{1} 'firewall'{1} default{0}}
 if($quantidade-ge0-and$p.Count-ne$quantidade){throw "Argumentos invalidos. Use supv $comando --help."}
 switch($comando){
  'help' {if($p.Count-gt1){throw 'Use supv help [comando].'};Ajuda-Supv ($p|Select-Object -First 1);return 0}
  'status' {Mostrar-StatusSupv;return 0}
  'iniciar' {
   if(Obter-TarefaSupplyVision $script:supvRaiz){Exigir-AdministradorSupv}
   [void](Executar-AcaoSupv 'iniciar')
   $cfg=Ler-ConfigOperacao (Join-Path $script:supvPrivado 'portal/configuracao/portal.env')
   $url='http://127.0.0.1:'+(Obter-PortaPortalLocal $cfg);$tempo=[Diagnostics.Stopwatch]::StartNew()
   do{
    if(!(Testar-SupervisorEncerrado $script:supvPrivado)-and(Consultar-HealthSupv $url)-eq'ok'){Escrever-Supv 'Operacao iniciada; health local ok.';return 0}
    Start-Sleep -Seconds 1
   }while($tempo.Elapsed.TotalSeconds-lt60)
   throw 'Inicio nao confirmado em 60 s. Consulte supv status e supv logs supervisor.'
  }
  'parar' {if(Obter-TarefaSupplyVision $script:supvRaiz){Exigir-AdministradorSupv};[void](Executar-AcaoSupv 'parar');Escrever-Supv 'Operacao parada.';return 0}
  'atualizar' {
   if(Obter-TarefaSupplyVision $script:supvRaiz){Exigir-AdministradorSupv}
   $r=Executar-AcaoSupv 'atualizar' @{completo=[bool]$o['--completo']}
   try{if(Acompanhar-AtualizacaoSupv $r.processo){return 0};return 1}finally{$r.processo.Dispose()}
  }
  'acompanhar' {
   $processo=Consultar-AtualizacaoAdministrada $script:supvRaiz $script:supvPrivado
   if(!$processo){
    Escrever-Supv 'Nao ha atualizacao em andamento.'
    $captura=Join-Path $script:supvPrivado 'operacao/atualizacao-processo-saida.log'
    if(!(Test-Path -LiteralPath $captura)){Escrever-Supv 'Nenhum resumo registrado.';return 0}
   }
   if(Acompanhar-AtualizacaoSupv){return 0};return 1
  }
  'homologar' {
   $destino=$o['--destino']
   if(!$destino){$destino=Join-Path ([Environment]::GetFolderPath('Desktop')) ('Supply-Vision-homologacao-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.txt')}
   $r=Executar-NativoOperacao 'powershell.exe' @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'homologar.ps1'),'-Destino',$destino) -AoReceber {param($linha) Escrever-Supv $linha}
   if($r.codigo-ne0){throw 'Falha ao gerar relatorio de homologacao.'}
   $original=[IO.File]::ReadAllText([IO.Path]::GetFullPath($destino))
   $reprovado=$original.Contains([string][char]0x274C)
   # Uma unica execucao e um unico texto canonico para console, arquivo e copia.
   $texto=(@($original-split'\r?\n'|ForEach-Object {Converter-TextoSupv (Mascarar-Homologacao $_ $script:supvSegredos)})-join[Environment]::NewLine)
   [IO.File]::WriteAllText([IO.Path]::GetFullPath($destino),$texto,[Text.Encoding]::ASCII)
   Write-Host $texto -NoNewline
   if($o['--copiar']){
    if(Copiar-RelatorioSupv $texto){Escrever-Supv 'Relatorio copiado para a area de transferencia.'}
    else{Escrever-Supv 'AVISO: copia indisponivel ou prazo de 5 s excedido. Relatorio salvo no destino informado.'}
   }
   # A execucao do diagnostico concluiu; itens reprovados tambem sinalizam falha.
   if($reprovado){return 1};return 0
  }
  'saude' {
   $desde=(Get-Date).AddHours(-24)
   if($o['--desde']){$desde=[datetime]::ParseExact($o['--desde'],'yyyy-MM-dd HH:mm',[Globalization.CultureInfo]::InvariantCulture)}
   Mostrar-SaudeSupv $desde;return 0
  }
  'logs' {
   if($p[0]-notin@('supervisor','portal','atualizacao','emails','relatorios')){throw 'Tipo de log invalido. Use supv logs --help.'}
   $n=80;if($o['-n']){$n=[int]$o['-n'];if($n-lt1-or$n-gt100000){throw '-n deve estar entre 1 e 100000.'}}
   $arquivos=@(Localizar-LogsOperacao $script:supvPrivado $p[0])
   if(!$arquivos.Count){Escrever-Supv 'Nenhum log encontrado.';return 0}
   foreach($arquivo in $arquivos){
    Escrever-Supv ('--- '+$arquivo.Name+' ---')
    if($p[0]-eq'atualizacao'-and!$o['--bruto']-and$arquivo.Name-in@('atualizacao-erro.log','atualizacao-processo-saida.log')){
     $linhas=@(Get-Content -LiteralPath $arquivo.FullName -Encoding UTF8)
     Filtrar-LogsAtualizacao $linhas|Select-Object -Last $n|ForEach-Object {Escrever-Supv $_}
    }else{Get-Content -LiteralPath $arquivo.FullName -Tail $n -Encoding UTF8|ForEach-Object {Escrever-Supv $_}}
   }
   return 0
  }
  'config' {if($p[0]-ne'validar'){throw 'Use supv config validar.'};[void](Executar-AcaoSupv 'validar');return 0}
  'backup' {
   if($p[0]-eq'senha'){if($o.Count){throw 'backup senha nao aceita opcoes.'};& (Join-Path $script:supvRaiz 'scripts/backup-senha.ps1');return 0}
   if($p[0]-eq'testar'){if($o.Count){throw 'Opcoes de restauracao nao se aplicam a backup testar.'};[void](Executar-AcaoSupv 'testar-backup');return 0}
   if($p[0]-ne'restaurar'){throw 'Use supv backup senha, testar ou restaurar.'}
   if($o['--data']-and$o['--data']-notmatch'^\d{4}-\d{2}-\d{2}_\d{4}$'){throw 'Use --data AAAA-MM-DD_HHMM.'}
   if($o['--data']-and$o['--anterior']){throw 'Escolha --data ou --anterior.'}
   if(Obter-TarefaSupplyVision $script:supvRaiz){Exigir-AdministradorSupv}
   Escrever-Supv 'A operacao sera parada e o banco atual sera substituido pelo backup.'
   if(!$o['--sim']-and(Read-Host 'Digite RESTAURAR para confirmar')-cne'RESTAURAR'){throw 'Restauracao cancelada.'}
   [void](Executar-AcaoSupv 'listar-backups')
   [void](Executar-AcaoSupv 'restaurar' @{anterior=[bool]$o['--anterior'];data=$o['--data'];configuracao=[bool]$o['--configuracao']});return 0
  }
  'modo' {
   if($p[0]-notin@('desligado','computador')){throw 'Modo invalido: use desligado ou computador.'}
   Exigir-AdministradorSupv;[void](Executar-AcaoSupv 'modo' @{modo=$p[0]});Escrever-Supv 'Modo de inicializacao alterado.';return 0
  }
  'manutencao' {
   if($p[0]-notin@('on','off')){throw 'Use supv manutencao on ou off.'}
   [void](Executar-AcaoSupv 'manutencao' @{ativo=($p[0]-eq'on')});Escrever-Supv ('Manutencao: '+$p[0]);return 0
  }
  'firewall' {
   if($p[0]-ne'restringir'){throw 'Use supv firewall restringir.'};Exigir-AdministradorSupv
   $r=Executar-NativoOperacao 'powershell.exe' @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $script:supvRaiz 'portal/scripts/restringir-firewall.ps1')) -AoReceber {param($linha) Escrever-Supv $linha}
   if($r.codigo-ne0){throw 'Restricao de firewall nao concluida.'};return 0
  }
  default {throw "Comando desconhecido: $comando. Use supv help."}
 }
}
# Dot-source permite o harness testar o mesmo dispatcher sem ganchos no produto.
if($MyInvocation.InvocationName-ne'.'){
 $script:supvSegredos=@()
 try{
  $c=Ler-ComandoSupv $supvArgumentos
  if($c.comando-eq'help'){$codigo=Executar-ComandoSupv $c}
  else{
   $script:supvPrivado=Obter-PastaPrivada $supvRaiz
   $script:supvSegredos=Obter-SegredosHomologacao $script:supvPrivado
   $codigo=Executar-ComandoSupv $c
  }
  exit ([int]$codigo)
 }catch{Escrever-Supv ('ERRO: '+$_.Exception.Message);exit 1}
}
