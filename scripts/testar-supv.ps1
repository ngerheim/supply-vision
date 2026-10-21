# Uma instalacao ficticia; sem tarefa, firewall ou dados reais.
param([Alias('Modo')][ValidateSet('suite','teste','cliente','sinal')][string]$ModoConsole='suite',[Alias('Pasta')][string]$PastaConsole,[Alias('Cliente')][int]$IdClienteConsole)
$ErrorActionPreference='Stop'
$origem=$PSScriptRoot
. (Join-Path $origem 'supv.ps1')
# O escopo filho impede que tipos/variaveis do console contaminem a suite.
& {
# Console real descartavel; subprocessos voltam a este arquivo nos modos abaixo.
function Testar-ConsoleSupv {
 param([ValidateSet('teste','cliente','sinal')][string]$Modo='teste',[string]$Pasta,[Alias('Cliente')][int]$IdClienteConsole)
if($env:OS-ne'Windows_NT'){Write-Host 'PULADO: console nativo e Ctrl+C exigem Windows.';return}
Inicializar-TipoConsoleSupv
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SupvConsoleTeste {
 [DllImport("kernel32.dll")] public static extern bool AllocConsole();
 [DllImport("kernel32.dll")] public static extern bool FreeConsole();
 [DllImport("kernel32.dll")] public static extern bool AttachConsole(uint id);
 [DllImport("kernel32.dll")] public static extern bool SetStdHandle(int id, IntPtr h);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr CreateFile(string name,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
 [DllImport("kernel32.dll")] public static extern bool SetConsoleCtrlHandler(IntPtr handler,bool add);
 [DllImport("kernel32.dll")] public static extern bool GenerateConsoleCtrlEvent(uint e,uint group);
 public static IntPtr Input() { return CreateFile("CONIN$",0xC0000000u,3,IntPtr.Zero,3,0,IntPtr.Zero); }
}
'@
if($Modo-eq'cliente'){
 [void][SupvConsoleTeste]::FreeConsole()
 if(![SupvConsoleTeste]::AllocConsole()){throw 'AllocConsole falhou.'}
 $h=[SupvConsoleTeste]::Input();[void][SupvConsoleTeste]::SetStdHandle(-10,$h)
 [uint32]$original=0
 if(![SupplyVision.ConsoleAcompanhamento]::GetConsoleMode($h,[ref]$original)){throw 'Console sem modo.'}
 $original=$original-bor0xC0
 [void][SupplyVision.ConsoleAcompanhamento]::SetConsoleMode($h,$original)
 # stdout redirecionado: wrapper nao altera modo nem precisa de console.
 if(Suspender-QuickEditSupv){throw 'Redirecionamento alterou console.'}
 $g=[SupplyVision.ConsoleAcompanhamento]::Begin()
 if(!$g){throw 'Guard nao iniciou.'}
 [uint32]$atual=0;[void][SupplyVision.ConsoleAcompanhamento]::GetConsoleMode($h,[ref]$atual)
 if($atual-band0x40){throw 'QuickEdit continuou ligado.'}
 $g.Dispose();[void][SupplyVision.ConsoleAcompanhamento]::GetConsoleMode($h,[ref]$atual)
 if($atual-ne$original){throw 'Dispose nao restaurou modo completo.'}
 $g=[SupplyVision.ConsoleAcompanhamento]::Begin()
 [IO.File]::WriteAllText((Join-Path $Pasta 'pronto'),[string]$original)
 try{while($true){Start-Sleep -Milliseconds 100}}finally{if($g){$g.Dispose()}}
 exit 0
}
if($Modo-eq'sinal'){
 [void][SupvConsoleTeste]::FreeConsole()
 if(![SupvConsoleTeste]::AttachConsole($IdClienteConsole)){throw 'AttachConsole falhou.'}
 [void][SupvConsoleTeste]::SetConsoleCtrlHandler([IntPtr]::Zero,$true)
 $h=[SupvConsoleTeste]::Input()
 if(![SupvConsoleTeste]::GenerateConsoleCtrlEvent(0,0)){throw 'CTRL_C_EVENT falhou.'}
 $p=Get-Process -Id $IdClienteConsole -ErrorAction SilentlyContinue
 if($p-and!$p.WaitForExit(5000)){throw 'Ctrl+C nao encerrou cliente.'}
 [uint32]$atual=0
 if(![SupplyVision.ConsoleAcompanhamento]::GetConsoleMode($h,[ref]$atual)){throw 'Leitura apos Ctrl+C falhou.'}
 $original=[uint32][IO.File]::ReadAllText((Join-Path $Pasta 'pronto'))
 if($atual-ne$original){throw 'Ctrl+C nao restaurou modo completo.'}
 exit 0
}
$base=Join-Path ([IO.Path]::GetTempPath()) ('supv-console-'+[guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($base)
$p=$null
try{
 $hostTeste=(Get-Process -Id $PID).Path
 $p=Start-Process $hostTeste -ArgumentList ('-NoProfile -File "'+$PSCommandPath+'" -Modo cliente -Pasta "'+$base+'"') -PassThru -RedirectStandardOutput (Join-Path $base 'saida.log') -RedirectStandardError (Join-Path $base 'erro.log');[void]$p.Handle
 $tempo=[Diagnostics.Stopwatch]::StartNew()
 while(!(Test-Path (Join-Path $base 'pronto'))){
  if($p.HasExited-or$tempo.Elapsed.TotalSeconds-gt15){throw ('Cliente sem console: '+(Get-Content (Join-Path $base 'erro.log') -Raw))}
  Start-Sleep -Milliseconds 100
 }
 $sinal=Executar-NativoOperacao $hostTeste @('-NoProfile','-File',$PSCommandPath,'-Modo','sinal','-Pasta',$base,'-Cliente',[string]$p.Id)
 if($sinal.codigo-ne0){throw ($sinal.saida-join"`n")}
 Write-Host 'PASSOU: QuickEdit desativado, modo integral restaurado por Dispose e Ctrl+C real; redirecionamento sem efeito.'
}finally{
 if($p){if(!$p.HasExited){$p.Kill()};$p.Dispose()}
 Remove-Item -LiteralPath $base -Recurse -Force -ErrorAction SilentlyContinue
}
}
if($ModoConsole-ne'suite'){Testar-ConsoleSupv -Modo $ModoConsole -Pasta $PastaConsole -IdClienteConsole $IdClienteConsole;return}
Testar-ConsoleSupv
}
if($ModoConsole-ne'suite'){return}
$base=Join-Path ([IO.Path]::GetTempPath()) ('supv-cli-'+[guid]::NewGuid().ToString('N'))
$anterior=$env:SUPPLY_VISION_PRIVADO
$hostTeste=(Get-Process -Id $PID).Path
$processos=New-Object Collections.ArrayList
function Exigir-Supv([bool]$Ok,[string]$Nome){if(!$Ok){throw "Falhou: $Nome"};Write-Host "OK supv: $Nome"}
function Recusar-Supv([scriptblock]$Codigo,[string]$Padrao){
 $falhou=$false;try{& $Codigo|Out-Null}catch{$falhou=$_.Exception.Message-like$Padrao}
 Exigir-Supv $falhou $Padrao
}
function Capturar-Supv([scriptblock]$Codigo){return (@(& $Codigo 6>&1)-join"`n")}
function Esperar-Supv([scriptblock]$Codigo,[int]$Segundos=25){
 $relogio=[Diagnostics.Stopwatch]::StartNew()
 while($relogio.Elapsed.TotalSeconds-lt$Segundos){if(& $Codigo){return $true};Start-Sleep -Milliseconds 100}
 return $false
}
try{
 $script:supvRaiz=Join-Path $base 'instalacao com espacos';$script:supvPrivado=Join-Path $base 'privado'
 $env:SUPPLY_VISION_PRIVADO=$script:supvPrivado
 foreach($p in @('scripts','portal/scripts')){[void][IO.Directory]::CreateDirectory((Join-Path $script:supvRaiz $p))}
 foreach($p in @('comum','operacao','portal/configuracao','portal/logs')){[void][IO.Directory]::CreateDirectory((Join-Path $script:supvPrivado $p))}
 foreach($nome in @('supv','administracao-logica','diagnostico-logica','operacao-logica','inicializacao-logica','atualizacao-preparo','atualizar-operacao','homologar')){Copy-Item (Join-Path $origem ($nome+'.ps1')) (Join-Path $script:supvRaiz 'scripts')}
 Copy-Item (Join-Path $origem '../supv.cmd') (Join-Path $script:supvRaiz 'supv.cmd')
 if($env:OS-eq'Windows_NT'){
  $invocar=Join-Path $base 'invocar-supv.ps1'
  Set-Content $invocar 'param($Raiz) $env:Path=$Raiz+";"+$env:Path;supv help;exit $LASTEXITCODE' -Encoding ASCII
  $r=Executar-NativoOperacao 'powershell.exe' @('-NoProfile','-ExecutionPolicy','Bypass','-File',$invocar,$script:supvRaiz)
  Exigir-Supv ($r.codigo-eq0-and($r.saida-join' ')-like'*Supply Vision - supv <comando>*') 'powershell.exe resolve supv help pelo PATH e retorna 0'
 }else{Write-Host 'PULADO: resolucao de supv.cmd pelo powershell.exe exige Windows.'}

 # Comando de consulta preserva o dispatcher e o filtro de saida.
 & {
  $segredosAntes=$script:supvSegredos
  $script:supvSegredos=@('credencial-ficticia-legado')
  try {
   function Executar-NativoOperacao($Executavel,$Argumentos,[scriptblock]$AoReceber) {
    Exigir-Supv ($Executavel-eq'node'-and$Argumentos[0]-eq'--experimental-strip-types'-and[IO.Path]::GetFileName($Argumentos[1])-eq'usuarios-legados.mjs') 'usuarios legados chama apenas o leitor Node'
    & $AoReceber 'Fixture | editor | Sim | credencial-ficticia-legado'
    return @{codigo=0;saida=@()}
   }
   $texto=Capturar-Supv {Executar-ComandoSupv (Ler-ComandoSupv @('usuarios','legados'))}
   Exigir-Supv ($texto-like'*Fixture | editor*'-and$texto-notlike'*credencial-ficticia-legado*') 'usuarios legados preserva mascaramento'
   $ajuda=Capturar-Supv {Ajuda-Supv 'usuarios'}
   Exigir-Supv ($ajuda-like'*usuarios legados*'-and$ajuda-like'*Somente leitura*') 'usuarios legados tem ajuda explicita'
  }finally{$script:supvSegredos=$segredosAntes}
 }

 # Acompanhamento restaura o guard em sucesso, erro e interrupcao da pipeline.
 Add-Type -TypeDefinition 'public sealed class SupvGuardTeste : System.IDisposable { public bool Disposed; public void Dispose(){Disposed=true;} }'
 $suspenderReal=(Get-Command Suspender-QuickEditSupv).ScriptBlock
 $progressoReal=(Get-Command Mostrar-ProgressoSupv).ScriptBlock
 $resultadoReal=(Get-Command Mostrar-ResultadoSupv).ScriptBlock
 $consultaReal=(Get-Command Consultar-AtualizacaoAdministrada).ScriptBlock
 try{
  function Suspender-QuickEditSupv {return $script:guardTeste}
  function Consultar-AtualizacaoAdministrada {return $null}
  function Mostrar-ResultadoSupv {return $true}
  foreach($casoConsole in @('sucesso','erro','interrupcao')){
   $script:guardTeste=New-Object SupvGuardTeste
   $script:casoConsole=$casoConsole
   function Mostrar-ProgressoSupv {
    if($script:casoConsole-eq'erro'){throw 'erro ficticio'}
    if($script:casoConsole-eq'interrupcao'){throw (New-Object OperationCanceledException)}
   }
   try{[void](Acompanhar-AtualizacaoSupv)}catch{}
   Exigir-Supv $script:guardTeste.Disposed ("QuickEdit restaurado: $casoConsole")
  }
 }finally{
  Set-Item Function:Suspender-QuickEditSupv $suspenderReal
  Set-Item Function:Mostrar-ProgressoSupv $progressoReal
  Set-Item Function:Mostrar-ResultadoSupv $resultadoReal
  Set-Item Function:Consultar-AtualizacaoAdministrada $consultaReal
 }
 # O modo permanece indefinido ate a decisao; o motivo viaja com o JSON.
 & {
  $privadoTeste=Join-Path $base 'andamento-ficticio'
  $arquivo=Join-Path $privadoTeste 'operacao/atualizacao-andamento.json'
  $andamento=Novo-AndamentoAtualizacao $arquivo (Join-Path $privadoTeste 'tempos.log')
  $consulta=[array]::IndexOf([object[]]$andamento.plano,'PREPARAR / Consulta CI')
  foreach($etapa in $andamento.plano[0..$consulta]){
   Publicar-AndamentoAtualizacao $andamento $etapa
   $lido=Consultar-AndamentoAdministrado $privadoTeste
   Exigir-Supv ($lido.modo-eq'a definir'-and!$lido.motivoModo) "modo a definir: $etapa"
  }
  foreach($modoTeste in @('rapido','completo')){
   $motivo=if($modoTeste-eq'rapido'){'CI da PR #321 (abcdef0) verde, conteudo identico ao da main (1234567)'}else{'check obrigatorio ausente: Portal'}
   Publicar-AndamentoAtualizacao $andamento 'PREPARAR / Build do Portal' -Modo $modoTeste -MotivoModo $motivo
   $lido=Consultar-AndamentoAdministrado $privadoTeste
   Exigir-Supv ($lido.modo-eq$modoTeste-and$lido.motivoModo-eq$motivo) "decisao $modoTeste preserva motivo"
   Publicar-AndamentoAtualizacao $andamento 'PREPARAR / Configuracao dos testes operacionais'
   Exigir-Supv ((Consultar-AndamentoAdministrado $privadoTeste).motivoModo-eq$motivo) "etapas seguintes preservam motivo $modoTeste"
  }
 }
 # Retomada usa o mesmo publicador do atualizador e preserva tempos/estimativa.
 & {
  $privadoTeste=Join-Path $base 'retomada-ficticia'
  $arquivo=Join-Path $privadoTeste 'operacao/atualizacao-andamento.json'
  $a=Novo-AndamentoAtualizacao $arquivo '' ([datetime]::UtcNow.AddSeconds(-180))
  foreach($nome in $a.plano){$a.duracoes[$nome]=5}
  Publicar-AndamentoAtualizacao $a 'Seguindo com o script da nova versao' -Modo 'rapido'
  $antes=Consultar-AndamentoAdministrado $privadoTeste
  $script:AndamentoAtualizacao=Ler-AndamentoAtualizacao $arquivo
  $inicioEtapa=$script:AndamentoAtualizacao.inicioEtapa
  $ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $origem 'atualizar-servidor.ps1'),[ref]$null,[ref]$null)
  $funcao=$ast.Find({param($n) $n-is[Management.Automation.Language.FunctionDefinitionAst]-and$n.Name-eq'Etapa'},$true)
  . ([scriptblock]::Create($funcao.Extent.Text))
  function Inicializar-MedicaoAtualizacao {}
  function Iniciar-EtapaMedida {}
  $JaAtualizado=$true;$Simular=$false
  Etapa 'Conferindo ambiente de atualizacao'
  Etapa 'Conferindo o repositorio'
  $depois=Consultar-AndamentoAdministrado $privadoTeste
  Exigir-Supv ($depois.numero-eq$antes.numero-and$depois.restanteSegundos-le$antes.restanteSegundos-and$depois.inicioGeral-eq$antes.inicioGeral-and$script:AndamentoAtualizacao.inicioEtapa-eq$inicioEtapa) 'filho preserva numero, inicio e estimativa do pai'
  Etapa 'Conferindo a configuracao privada'
  Exigir-Supv ((Consultar-AndamentoAdministrado $privadoTeste).numero-eq$antes.numero+1) 'filho continua na proxima etapa'
  $a=Novo-AndamentoAtualizacao $arquivo ''
  Publicar-AndamentoAtualizacao $a 'PREPARAR / Build do Portal'
  $a.erro='Falha ficticia unica: Portal (failure). Saidas: re-run no GitHub, PR de correcao, ou supv atualizar --completo.'
  Publicar-AndamentoAtualizacao $a 'PREPARAR reprovado' 'falhou'
  $reprovado=Get-Content $arquivo -Raw
  $a=Ler-AndamentoAtualizacao $arquivo
  Publicar-AndamentoAtualizacao $a 'PREPARAR / Aprovacao e conferencia'
  Publicar-AndamentoAtualizacao $a 'Atualizacao falhou' 'falhou'
  Exigir-Supv ((Get-Content $arquivo -Raw)-ceq$reprovado) 'reprovacao permanece terminal com numero, erro e fim fixos'
  $falha=Consultar-AndamentoAdministrado $privadoTeste
  Set-Content (Join-Path $script:supvPrivado 'operacao/atualizacao-processo-saida.log') 'Falha ficticia unica' -Encoding UTF8
  function Consultar-AndamentoAdministrado {return $falha}
  function Consultar-AtualizacaoAdministrada {return $null}
  function Obter-TarefaSupplyVision {return $null}
  function Executar-AcaoAdministrada {return @{ok=$false;mensagem=($falha.erro+"`n"+$falha.erro);andamento=$falha}}
  $processo=[pscustomobject]@{HasExited=$true;ExitCode=1}
  foreach($metodo in @('WaitForExit','Refresh','Dispose')){$processo|Add-Member ScriptMethod $metodo {}}
  function Executar-AcaoSupv {return @{processo=$processo}}
  $texto=Capturar-Supv {[void](Executar-ComandoSupv (Ler-ComandoSupv @('acompanhar')))}
  Exigir-Supv ($texto.Contains($falha.erro)-and$texto-like'*Etapa *PREPARAR reprovado*Portal (failure)*supv atualizar --completo*') 'acompanhar apos falha conserva check e alternativas no progresso'
  Exigir-Supv (([regex]::Matches($texto,'Falha ficticia unica')).Count-eq1) 'acompanhar nao repete a causa no resultado'
  $texto=Capturar-Supv {[void](Executar-ComandoSupv (Ler-ComandoSupv @('atualizar')))}
  Exigir-Supv ($texto.Contains($falha.erro)-and([regex]::Matches($texto,'Falha ficticia unica')).Count-eq1) 'atualizar mostra causa e alternativas uma unica vez'
  $texto=Capturar-Supv {[void](Mostrar-ResultadoSupv 1 @{})}
  Exigir-Supv ($texto.Contains($falha.erro)) 'resultado mostra erro quando o ultimo progresso nao o exibiu'
 }
 # Retencao numerica nao vira segredo por conter EMAIL na chave.
 & {
  $privadoTeste=Join-Path $base 'mascara-ficticia'
  New-Item -ItemType Directory -Force $privadoTeste|Out-Null
  $envTeste=Join-Path $privadoTeste 'operacao.env'
  Set-Content $envTeste 'EXPURGO_EMAILS_DIAS=180' -Encoding UTF8
  $segredos=Obter-SegredosHomologacao $privadoTeste
  Exigir-Supv ((Mascarar-Homologacao 'total 180 s' $segredos)-eq'total 180 s') 'dias de retencao nao mascaram duracao'
  Add-Content $envTeste "SMTP_PORT=587`nBACKUP_EMAIL_MAX_MB=15`nSMTP_SECURE=false`nSMTP_HOST=smtp.exemplo.test`nSMTP_USER=conta-ficticia" -Encoding UTF8
  $segredos=Obter-SegredosHomologacao $privadoTeste
  $numeros='total 587 s, 15 MB, false, a3d153f; 154.1 GB; 11:15'
  Exigir-Supv ((Mascarar-Homologacao $numeros $segredos)-eq$numeros) 'parametros numericos e booleanos nao mascaram duracao, tamanho, SHA ou horario'
  Exigir-Supv ((Mascarar-Homologacao 'smtp.exemplo.test conta-ficticia' $segredos)-eq'[mascarado] [mascarado]') 'host e conta SMTP continuam secretos'
  foreach($valor in @('true','FALSE','0','1')){
   Add-Content $envTeste ("SMTP_TESTE="+$valor) -Encoding UTF8
  }
  $segredos=Obter-SegredosHomologacao $privadoTeste
  Exigir-Supv ((Mascarar-Homologacao 'true FALSE 0 1' $segredos)-eq'true FALSE 0 1') 'booleanos SMTP nao viram segredos independentemente da caixa'
  Add-Content $envTeste "SMTP_PASSWORD=180`nPORTAL_API_TOKEN=segredo-ficticio`nEMAIL_FROM=pessoa@example.com" -Encoding UTF8
  $segredos=Obter-SegredosHomologacao $privadoTeste
  $texto=Mascarar-Homologacao '180 segredo-ficticio pessoa@example.com Bearer abc123' $segredos
  Exigir-Supv ($texto-notmatch'180|segredo-ficticio|pessoa@example.com|abc123') 'segredos reais inclusive numericos continuam mascarados'
 }
 # Resumos operacionais e rotulos de matriz passam pelo mesmo mascaramento dos logs/status.
 & {
  $r=Executar-NativoOperacao (Get-Command node.exe).Source @('--experimental-strip-types',(Join-Path $origem '../portal/scripts/testar-restauracao.mjs'),'--fixture')
  Exigir-Supv ($r.codigo-eq0) 'restauracao em copia descartavel aprovada'
  $resumo=@($r.stdout|Where-Object {$_-like'Preparacao da restauracao aprovada*'})
  Exigir-Supv ($resumo.Count-eq1-and$resumo[0]-like'*users=1, tickets=0*') 'resumo da restauracao exibe contagens legiveis'
  Exigir-Supv ((Mascarar-Homologacao $resumo[0])-eq$resumo[0]) 'resumo real da restauracao nao e omitido'
  foreach($modo in @('rapido','completo')){
   $motivo=Formatar-MotivoPreparo 'check nao aprovado: Atualizacao real - ${{ matrix.grupo }} (completed/skipped); modo completo'
   $linha="PREPARAR: modo $modo - motivo: $motivo"
   Exigir-Supv ((Mascarar-Homologacao $linha)-eq$linha-and$linha.Contains('(matrix.grupo)')) 'linha do modo PREPARAR preserva motivo nos logs'
   $a=@{numero=1;total=37;nome='PREPARAR / Build do Portal';modo=$modo;motivoModo='check nao aprovado: Atualizacao real - ${{ matrix.grupo }} (completed/skipped)';estado='andamento';etapaSegundos=0;totalSegundos=0;restanteSegundos=$null}
   $texto=Capturar-Supv {Mostrar-ProgressoSupv $a @{}}
   Exigir-Supv ($texto.Contains("Modo ${modo}: check nao aprovado: Atualizacao real - (matrix.grupo)")-and$texto-notlike'*conteudo omitido*') 'status preserva motivo do modo com rotulo de matriz'
  }
  foreach($linha in @('{"users":11}','SELECT * FROM users','usuario=exemplo','payload: sigiloso','preco=10','chamado: exemplo')){
   Exigir-Supv ((Mascarar-Homologacao $linha)-eq'[conteudo omitido]') 'regra de omissao integral permanece restritiva'
  }
 }
 # A largura afeta somente o andamento do console, nunca o texto completo guardado.
 & {
  $larguraReal=(Get-Command Obter-LarguraConsoleSupv).ScriptBlock
  try{
   $a=@{numero=1;total=37;nome=('etapa longa '*30);modo='rapido';estado='andamento';etapaSegundos=0;totalSegundos=0;restanteSegundos=$null}
   foreach($largura in @(1,40,80,0)){
    $script:larguraTeste=$largura
    function Obter-LarguraConsoleSupv {return $script:larguraTeste}
    $exibicao=@{}
    $texto=Capturar-Supv {Mostrar-ProgressoSupv $a $exibicao}
    Exigir-Supv ($largura-eq0-or$texto.Length-le$largura) 'andamento cabe na largura disponivel sem quebrar linha'
    Exigir-Supv ($exibicao.ultimaLinha.Contains($a.nome)) 'andamento completo permanece disponivel'
    if($largura-eq0){Exigir-Supv ($texto-eq$exibicao.ultimaLinha) 'sem largura legivel conserva texto completo'}
    $normal=Capturar-Supv {Escrever-Supv $a.nome}
    Exigir-Supv ($normal-eq$a.nome) 'outras mensagens nao sao truncadas'
   }
  }finally{Set-Item Function:Obter-LarguraConsoleSupv $larguraReal}
  if([Console]::IsOutputRedirected){Exigir-Supv ((Obter-LarguraConsoleSupv)-eq0) 'saida redirecionada usa fallback sem largura'}
  $fonteSupervisor=[IO.File]::ReadAllText((Join-Path $origem 'testar-supervisor-isolado.ps1'))
  $astSupervisor=[Management.Automation.Language.Parser]::ParseInput($fonteSupervisor,[ref]$null,[ref]$null)
  $partidas=@($astSupervisor.FindAll({param($n) $n-is[Management.Automation.Language.CommandAst]-and$n.GetCommandName()-eq'Start-Process'},$true))
  Exigir-Supv ($partidas.Count-eq2) 'duas partidas do supervisor isolado conferidas'
  foreach($partida in $partidas){Exigir-Supv ($partida.Extent.Text-match'-NoNewWindow'-and$partida.Extent.Text-notmatch'-WindowStyle') 'supervisor isolado inicia sem criar janela'}
 }
 # Consultas identicas nao imprimem de novo; segundos e modo ainda atualizam.
 & {
  $a=@{numero=1;total=37;nome='Conferindo ambiente de atualizacao';modo='a definir';motivoModo='';estado='andamento';etapaSegundos=0;totalSegundos=0;restanteSegundos=$null}
  $exibicao=@{}
  $motivo='CI da PR #321 (abcdef0) verde, conteudo identico ao da main (1234567)'
  $texto=Capturar-Supv {
   Mostrar-ProgressoSupv $a $exibicao;Mostrar-ProgressoSupv $a $exibicao
   $a.etapaSegundos=1;$a.totalSegundos=1;Mostrar-ProgressoSupv $a $exibicao
   $a.nome='PREPARAR / Consulta CI';Mostrar-ProgressoSupv $a $exibicao;Mostrar-ProgressoSupv $a $exibicao
   $a.modo='rapido';$a.motivoModo=$motivo;Mostrar-ProgressoSupv $a $exibicao
   $a.nome='PREPARAR / Build do Portal';Mostrar-ProgressoSupv $a $exibicao
   foreach($i in 1..17){Mostrar-ProgressoSupv $a $exibicao}
   $a.numero=37;$a.nome='Atualizacao concluida';$a.estado='concluido';Mostrar-ProgressoSupv $a $exibicao
   foreach($i in 2..18){$a.totalSegundos=$i;Mostrar-ProgressoSupv $a $exibicao}
  }
  $linhas=@($texto-split"`n")
  Exigir-Supv (@($linhas|Where-Object {$_-like'Etapa *'}).Count-eq6) 'andamento imprime apenas mudanca de etapa, segundos ou modo'
  Exigir-Supv (@($linhas|Where-Object {$_-like'*Consulta CI*modo a definir'}).Count-eq1) 'consulta CI ainda mostra modo a definir'
  Exigir-Supv (@($linhas|Where-Object {$_-like'Modo rapido:*'}).Count-eq1-and$texto.Contains("Modo rapido: $motivo")) 'motivo rapido aparece exatamente uma vez'
  Exigir-Supv ($texto.IndexOf('Consulta CI')-lt$texto.IndexOf('Modo rapido:')-and$texto.IndexOf('Modo rapido:')-lt$texto.IndexOf('Build do Portal')) 'motivo vem apos consulta CI e antes do build'
  Exigir-Supv (@($linhas|Where-Object {$_-like'Etapa 37 de 37: Atualizacao concluida*'}).Count-eq1) 'conclusao aparece uma vez mesmo aguardando o processo'
  $a.modo='completo';$a.estado='andamento';$a.nome='PREPARAR / Build do Portal';$a.motivoModo="preparo completo forcado`r`npor fixture"
  $exibicao=@{}
  $texto=Capturar-Supv {Mostrar-ProgressoSupv $a $exibicao;Mostrar-ProgressoSupv $a $exibicao}
  Exigir-Supv (@($texto-split"`n"|Where-Object {$_-eq'Modo completo: preparo completo forcado por fixture'}).Count-eq1) 'motivo completo aparece exatamente uma vez'
 }
 $op=Join-Path $script:supvPrivado 'operacao'
 Set-Content (Join-Path $script:supvPrivado 'comum/operacao.env') 'MODO_ENSAIO=0' -Encoding UTF8
 Set-Content (Join-Path $script:supvPrivado 'portal/configuracao/portal.env') "PORTAL_PORTA=31415`nPORTAL_API_TOKEN=segredo-ficticio`nBACKUP_EMAIL_TO=pessoa@example.com" -Encoding UTF8
 Set-Content (Join-Path $op 'status.json') '{"portal":true,"emails":true,"alertas":"ok","espacoLivreGb":20}' -Encoding UTF8
 Set-Content (Join-Path $op 'supervisor.log') @(
  '[2026-10-14 23:59:50] Supervisor iniciado.',
  '[2026-10-15 00:00:10] Health falhou: motivo=timeout; http=0;',
  '[2026-10-15 00:00:20] Health falhou: motivo=conexao-recusada; http=0;',
  '[2026-10-15 00:00:21] Health falhou: motivo=timeout; http=0;',
  '[2026-10-15 01:00:00] Supervisor iniciado.',
  '[2026-10-15 01:00:01] Health falhou: motivo=status-http; http=500;',
  'segredo-ficticio pessoa@example.com Bearer abc123',
  'SELECT * FROM banco') -Encoding UTF8
 Set-Content (Join-Path $op 'portal-saida.log') @('GET /teste 500 Internal Server Error','HTTP/1.1 503') -Encoding UTF8
 $script:supvSegredos=Obter-SegredosHomologacao $script:supvPrivado
 # ErrorRecord sob Stop reproduz o risco do PS5.1 tambem no pwsh/Linux.
 function Nativo-ErroTeste {Write-Error 'stderr ficticio';$global:LASTEXITCODE=$script:codigoNativoTeste}
 foreach($valor in @(0,9)){
  $script:codigoNativoTeste=$valor;$global:LASTEXITCODE=42
  $r=Executar-NativoOperacao 'Nativo-ErroTeste'
  Exigir-Supv ($r.codigo-eq$valor-and($r.saida-join' ')-like'*stderr ficticio*') "stderr ErrorRecord preserva codigo $valor"
  Exigir-Supv ($ErrorActionPreference-eq'Stop'-and$LASTEXITCODE-eq42) 'captura restaura preferencia e codigo do chamador'
 }
 Remove-Item Function:Nativo-ErroTeste
 $nativo=Join-Path $base 'nativo-stderr.ps1'
 Set-Content $nativo 'param([int]$Codigo) [Console]::Error.WriteLine("stderr ficticio");Write-Output "stdout ficticio";exit $Codigo' -Encoding UTF8
 foreach($valor in @(0,9)){
  $r=Executar-NativoOperacao $hostTeste @('-NoProfile','-File',$nativo,'-Codigo',[string]$valor)
  Exigir-Supv ($r.codigo-eq$valor-and($r.saida-join' ')-like'*stderr ficticio*'-and($r.stdout-join' ')-eq'stdout ficticio') "processo real: stdout, stderr e codigo $valor"
 }
 function git {Write-Error 'Git ficticio falhou';$global:LASTEXITCODE=9}
 try{Exigir-Supv ((Obter-VersaoAdministrada $script:supvRaiz)-eq'versao indisponivel') 'git falhando nao interrompe consulta de versao'}finally{Remove-Item Function:git}
 $r=Executar-NativoOperacao $hostTeste @('-NoProfile','-File',(Join-Path $script:supvRaiz 'scripts/supv.ps1'),'status')
 $statusSemGit=$r.saida-join"`n"
 Exigir-Supv ($r.codigo-eq0-and$statusSemGit-like'*Versao: versao indisponivel*'-and$statusSemGit-notmatch'fatal:|NativeCommandError') 'supv status sem .git retorna 0 e versao indisponivel sem stderr'

 # O manifesto da instalacao compoe o mesmo texto no status e no fim da atualizacao.
 $manifestoVersao=Join-Path $script:supvRaiz 'portal/package.json'
 function git {Write-Output '42e09a3  21/10/2026';$global:LASTEXITCODE=0}
 try{
  Exigir-Supv ((Obter-VersaoAdministrada $script:supvRaiz)-ceq'42e09a3  21/10/2026') 'manifesto ausente preserva formato anterior'
  foreach($conteudo in @('{invalido','{}','{"version":42}','{"version":""}')){
   Set-Content $manifestoVersao $conteudo -Encoding UTF8
   Exigir-Supv ((Obter-VersaoAdministrada $script:supvRaiz)-ceq'42e09a3  21/10/2026') 'manifesto invalido preserva commit sem erro'
  }
  Set-Content $manifestoVersao '{"version":"2.9.0"}' -Encoding UTF8
  Exigir-Supv ((Obter-VersaoAdministrada $script:supvRaiz)-ceq'2.9.0 | 42e09a3  21/10/2026') 'versao e commit no formato novo'
  $texto=Capturar-Supv {Mostrar-StatusSupv}
  Exigir-Supv ($texto-like'*Versao: 2.9.0 | 42e09a3  21/10/2026*') 'status mostra versao da instalacao e commit'
  Set-Content (Join-Path $op 'atualizacao-processo-saida.log') '=== Atualizado: 1234567 -> abcdef0 ==='
  $fim=Executar-AcaoAdministrada $script:supvRaiz $script:supvPrivado 'fim-atualizacao' @{codigo=0}
  Exigir-Supv ($fim.ok-and$fim.versao-ceq'2.9.0 | 42e09a3  21/10/2026') 'resultado da atualizacao conserva versao composta'
  Set-Content $manifestoVersao '{"version":"2.9.1"}' -Encoding UTF8
  Exigir-Supv ((Obter-VersaoAdministrada $script:supvRaiz)-ceq'2.9.1 | 42e09a3  21/10/2026') 'mudanca do manifesto e lida sem versao fixa no script'
  $bloqueio=[IO.File]::Open($manifestoVersao,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
  try{Exigir-Supv ((Obter-VersaoAdministrada $script:supvRaiz)-ceq'42e09a3  21/10/2026') 'manifesto ilegivel preserva commit sem erro'}finally{$bloqueio.Dispose()}
 }finally{Remove-Item Function:git}
 foreach($casoManifesto in @('valido','invalido','bloqueado','ausente')){
  $bloqueio=$null
  try{
   if($casoManifesto-eq'ausente'){Remove-Item $manifestoVersao}else{
    $conteudo=if($casoManifesto-eq'invalido'){'{invalido'}else{'{"version":"2.9.0"}'}
    Set-Content $manifestoVersao $conteudo -Encoding UTF8
    if($casoManifesto-eq'bloqueado'){$bloqueio=[IO.File]::Open($manifestoVersao,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)}
   }
   $r=Executar-NativoOperacao $hostTeste @('-NoProfile','-File',(Join-Path $script:supvRaiz 'scripts/supv.ps1'),'status')
   $esperado=if($casoManifesto-eq'valido'){'2.9.0 | versao indisponivel'}else{'versao indisponivel'}
   Exigir-Supv ($r.codigo-eq0-and($r.stdout-join"`n")-like"*Versao: $esperado*"-and($r.saida-join"`n")-ceq($r.stdout-join"`n")) "status sem .git e manifesto $casoManifesto retorna 0 sem stderr"
  }finally{if($bloqueio){$bloqueio.Dispose()}}
 }

 $pathFicticio=Acrescentar-ComandoSupvAoPath $script:supvRaiz 'primeiro;segundo'
 Exigir-Supv ($pathFicticio-eq('primeiro;segundo;'+$script:supvRaiz)) 'PATH preserva entradas existentes'
 Exigir-Supv ((Acrescentar-ComandoSupvAoPath $script:supvRaiz $pathFicticio)-ceq$pathFicticio) 'PATH idempotente'
 Exigir-Supv ((Acrescentar-ComandoSupvAoPath $script:supvRaiz ('"'+$script:supvRaiz.ToUpperInvariant()+'\"'))-eq('"'+$script:supvRaiz.ToUpperInvariant()+'\"')) 'PATH reconhece caixa, aspas e barra final'

 foreach($nome in @('status','iniciar','parar','atualizar','acompanhar','homologar','saude','logs','config','backup','modo','manutencao','firewall')){
  $c=Ler-ComandoSupv @($nome,'--help');$texto=Capturar-Supv {Executar-ComandoSupv $c}
  Exigir-Supv ($texto-like"*supv $nome*"-and$texto-notmatch'[^\x00-\x7F]') "help e ASCII: $nome"
 }
 $c=Ler-ComandoSupv @('homologar','--destino','C:\uma pasta\arquivo.txt','--copiar')
 Exigir-Supv ($c.opcoes['--destino']-eq'C:\uma pasta\arquivo.txt'-and$c.opcoes['--copiar']) 'parsing de caminho e opcoes'
 Recusar-Supv {Ler-ComandoSupv @('atualizar','--invalido')} '*Opcao desconhecida*'
 Recusar-Supv {Ler-ComandoSupv @('logs','portal','-n')} '*Falta valor*'
 Recusar-Supv {Ler-ComandoSupv @('logs','portal','-n','1','-n','2')} '*Opcao repetida*'
 foreach($caso in @(@('inexistente'),@('logs','portal','-n','0'),@('iniciar','extra'),@('modo','invalido'),@('saude','--desde','ontem'))){
  $c=Ler-ComandoSupv $caso;Recusar-Supv {Executar-ComandoSupv $c} '*'
 }
 foreach($caso in @(@('help'),@('inexistente'),@('atualizar','--erro'))){
  $r=Executar-NativoOperacao $hostTeste (@('-NoProfile','-File',(Join-Path $origem 'supv.ps1'))+$caso)
  $texto=$r.saida-join"`n";$codigo=$r.codigo
  Exigir-Supv (($caso[0]-eq'help'-and$codigo-eq0)-or($caso[0]-ne'help'-and$codigo-ne0)) "codigo real do processo: $($caso-join' ')"
  Exigir-Supv ($texto-notmatch'[^\x00-\x7F]') 'saida de processo ASCII'
 }
 # Somente health e agendador simulados. Estado e logs sao lidos de verdade.
 function Consultar-HealthSupv {return 'ok'}
 function Get-ScheduledTask {return $null}
 function Consultar-AtualizacaoAdministrada {return $null}
 $antes=@(Get-ChildItem $script:supvPrivado -Recurse -File|ForEach-Object {$_.FullName+':'+(Get-FileHash $_.FullName).Hash+':'+$_.LastWriteTimeUtc.Ticks})-join"`n"
 $texto=Capturar-Supv {Executar-ComandoSupv (Ler-ComandoSupv @('status'))}
 $depois=@(Get-ChildItem $script:supvPrivado -Recurse -File|ForEach-Object {$_.FullName+':'+(Get-FileHash $_.FullName).Hash+':'+$_.LastWriteTimeUtc.Ticks})-join"`n"
 Exigir-Supv ($antes-ceq$depois) 'status somente leitura, sem diagnostico nem limpeza de arquivos'
 Exigir-Supv ($texto-notmatch'(?m)^(Inicializacao|Ensaio):.*\|\s*$') 'status sem separador final em Inicializacao/Ensaio'
 Exigir-Supv ($texto-like'*Operacao: parada*'-and$texto-like'*Reserva de dependencias: ausente*'-and$texto-like'*Health rede: ok*') 'status apresenta operacao, health e reserva'
 Gravar-EstadoOperacao (Join-Path $op 'atualizacao.json') @{fase='concluido';modo='sem-parada';anterior=('1'*40);remoto=('2'*40)}
 $texto=Capturar-Supv {Mostrar-StatusSupv}
 Exigir-Supv ($texto-like'*Ultima atualizacao: sem parada*') 'status mostra a ultima atualizacao sem parada'
 Gravar-EstadoOperacao (Join-Path $op 'atualizacao.json') @{fase='concluido';anterior=('2'*40);remoto=('3'*40)}
 $texto=Capturar-Supv {Mostrar-StatusSupv}
 Exigir-Supv ($texto-notlike'*Ultima atualizacao: sem parada*') 'atualizacao normal posterior substitui modo sem parada'
 $texto=Capturar-Supv {Executar-ComandoSupv (Ler-ComandoSupv @('logs','supervisor','-n','80'))}
 Exigir-Supv ($texto-notmatch'segredo-ficticio|pessoa@example.com|abc123|SELECT'-and$texto-like'*conteudo omitido*') 'logs usam mesmo mascaramento da homologacao'
 $texto=Capturar-Supv {Executar-ComandoSupv (Ler-ComandoSupv @('saude','--desde','2026-10-15 00:00'))}
 Exigir-Supv (([regex]::Matches($texto,'\[partida\]')).Count-eq3-and$texto-like'*Falhas de health: 4*'-and$texto-like'*Supervisor iniciado no periodo: 1*') 'saude: limites de 30 s, inicio antes do recorte e reinicios'
 Exigir-Supv ($texto-like'*HTTP 5xx: 2*'-and$texto-like'*ultimo reinicio*') 'saude: Portal e cobertura dos logs'
 # Filtro antes do -n: progressos e blocos nao expulsam erros reais do final.
 $ruido=@(
  'Updating files: 12% (12/100)',
  'segredo-ficticio pessoa@example.com',
  ([string][char]27+'[33m[PLUGIN_TIMINGS] diagnostico'+[char]27+'[0m'),
  'The following plugins spent time:',
  '13 callbacks are listed without a time...',
  'sem indentacao: continuacao desconhecida do diagnostico',
  '   and 7 more',
  'The slowest callbacks...',
  'Additional callback time...',
  '  plugin lento: 88 s',
  '- plugin tabela: 123 ms',
  '',
  'build progrediu entre diagnosticos',
  '13 callbacks are listed without a time...',
  '  - plugin tabela: 5 ms',
  '   and 7 more',
  'The slowest callbacks...',
  'Additional callback time...',
  'See https://rolldown.rs/diagnostics',
  '`output.codeSplitting.groups` is a function...',
  'Learn more: https://nextjs.org/docs/messages/middleware-to-proxy',
  'npx @next/codemod@canary middleware-to-proxy .',
  '[INEFFECTIVE_DYNAMIC_IMPORT] diagnostico',
  '  caminho do modulo',
  ([string][char]0x2502+' continuacao de codigo'),
  '  Error: erro real preservado',
  'Updating files: 100% (100/100), done.',
  'ERRO REAL final'
 )
 foreach($nome in @('atualizacao-erro.log','atualizacao-processo-saida.log')){Set-Content (Join-Path $op $nome) $ruido -Encoding UTF8}
 $completo=Capturar-Supv {Executar-ComandoSupv (Ler-ComandoSupv @('logs','atualizacao','-n','80'))}
 Exigir-Supv ($completo-like'*build progrediu entre diagnosticos*'-and$completo-like'*erro real preservado*'-and$completo-notmatch'Updating files|PLUGIN_TIMINGS|INEFFECTIVE_DYNAMIC_IMPORT|plugin lento|plugin tabela|caminho do modulo|continuacao de codigo|callbacks|and 7 more|sem indentacao|rolldown|codeSplitting|Learn more|codemod') 'bloco completo ate linha vazia e mensagens avulsas filtrados; erros e progresso real preservados'
 $limpo=Capturar-Supv {Executar-ComandoSupv (Ler-ComandoSupv @('logs','atualizacao','-n','2'))}
 Exigir-Supv ($limpo-like'*erro real preservado*'-and$limpo-like'*ERRO REAL final*'-and$limpo-notmatch'Updating files|PLUGIN_TIMINGS|INEFFECTIVE_DYNAMIC_IMPORT|plugin lento|plugin tabela|caminho do modulo|continuacao de codigo|callbacks|and 7 more|sem indentacao|rolldown|codeSplitting|Learn more|codemod') 'logs atualizacao filtra blocos e progresso antes do tail; preserva erros'
 $bruto=Capturar-Supv {Executar-ComandoSupv (Ler-ComandoSupv @('logs','atualizacao','--bruto'))}
 Exigir-Supv ($bruto-like'*Updating files*'-and$bruto-like'*PLUGIN_TIMINGS*'-and$bruto-like'*caminho do modulo*'-and$bruto-like'*ERRO REAL final*'-and$bruto-notmatch'segredo-ficticio|pessoa@example.com') '--bruto conserva diagnosticos, continuacoes e erros com mascaramento'
 $script:chamadas=@();$script:elevado=$false;$script:resposta='nao';$script:paradaOk=$true
 function Testar-Elevacao {return $script:elevado}
 function Read-Host {return $script:resposta}
 function Iniciar-OperacaoConfigurada {$script:chamadas+='iniciar'}
 function Parar-Operacao {$script:chamadas+='parar';return $script:paradaOk}
 function Localizar-NodeMaquina {return 'node-ficticio'}
 function node-ficticio {$script:chamadas+=('node '+($args-join' '));$global:LASTEXITCODE=0;return 'backup aprovado'}
 function Definir-ModoInicializacao {$script:chamadas+='modo'}
 function Testar-SupervisorEncerrado {return $false}
 Exigir-Supv ((Executar-ComandoSupv (Ler-ComandoSupv @('iniciar')))-eq0) 'iniciar aguarda supervisor e health'
 Exigir-Supv ((Executar-ComandoSupv (Ler-ComandoSupv @('parar')))-eq0) 'parar propaga sucesso'
 $script:paradaOk=$false;Recusar-Supv {Executar-ComandoSupv (Ler-ComandoSupv @('parar'))} '*nao concluido*';$script:paradaOk=$true
 $antesAcoes=$script:chamadas.Count
 Recusar-Supv {Executar-ComandoSupv (Ler-ComandoSupv @('backup','restaurar'))} '*cancelada*'
 Exigir-Supv ($script:chamadas.Count-eq$antesAcoes) 'recusa RESTAURAR antes de parar'
 $script:resposta='RESTAURAR'
 [void](Executar-ComandoSupv (Ler-ComandoSupv @('backup','restaurar','--anterior')))
 [void](Executar-ComandoSupv (Ler-ComandoSupv @('backup','restaurar','--sim')))
 Exigir-Supv (@($script:chamadas|Where-Object {$_-like'node *--anterior*'}).Count-eq1) 'restauracao anterior e --sim delegam ao comportamento atual'
 foreach($caso in @(@('modo','desligado'),@('firewall','restringir'))){Recusar-Supv {Executar-ComandoSupv (Ler-ComandoSupv $caso)} '*abra o terminal como administrador*'}
 $script:elevado=$true;$script:resposta='nao'
 Recusar-Supv {Executar-ComandoSupv (Ler-ComandoSupv @('modo','login'))} '*Modo invalido*'
 Recusar-Supv {Executar-ComandoSupv (Ler-ComandoSupv @('modo','desligado'))} '*Pare a operacao*'
 function Testar-SupervisorEncerrado {return $true}
 [void](Executar-ComandoSupv (Ler-ComandoSupv @('modo','desligado')))
 $script:credencialPedida=$false
 function Get-Credential {
  $script:credencialPedida=$true;$senha=New-Object Security.SecureString
  foreach($caractere in 'ficticia'.ToCharArray()){$senha.AppendChar($caractere)}
  return [pscredential]::new('DOMINIO\ficticio',$senha)
 }
 function Definir-ModoInicializacao {param($Raiz,$Privado,$Modo,$Credencial);if($Modo-eq'computador'-and!$Credencial){throw 'Conta ausente.'};$script:chamadas+='modo'}
 [void](Executar-ComandoSupv (Ler-ComandoSupv @('modo','computador')))
 Exigir-Supv $script:credencialPedida 'modo computador solicita a conta do dono'
 [void](Executar-ComandoSupv (Ler-ComandoSupv @('manutencao','on')))
 Exigir-Supv (Test-Path (Join-Path $op 'manutencao.sinal')) 'manutencao on'
 [void](Executar-ComandoSupv (Ler-ComandoSupv @('manutencao','off')))
 Exigir-Supv (!(Test-Path (Join-Path $op 'manutencao.sinal'))) 'manutencao off'
 # Homologar real na fixture, dependencias externas ficticias.
 $relatorio=Join-Path $base 'homologacao.txt'
 $fixtureInit=Join-Path $script:supvRaiz 'scripts/inicializacao-logica.ps1'
 Add-Content $fixtureInit 'function Localizar-NodeMaquina {throw "node indisponivel na fixture"}'
 Add-Content $fixtureInit 'function Testar-Elevacao {return $false}'
 $r=Executar-NativoOperacao $hostTeste @('-NoProfile','-File',(Join-Path $script:supvRaiz 'scripts/supv.ps1'),'modo','desligado')
 $adminTexto=$r.saida-join"`n"
 Exigir-Supv ($r.codigo-ne0-and$adminTexto-like'*abra o terminal como administrador*') 'processo real retorna falha e mensagem de administrador'
 $r=Executar-NativoOperacao $hostTeste @('-NoProfile','-File',(Join-Path $script:supvRaiz 'scripts/homologar.ps1'),'-Destino',$relatorio)
 Exigir-Supv ($r.codigo-eq0-and(Test-Path -LiteralPath $relatorio)) 'homologar mantem arquivo txt'
 $texto=[IO.File]::ReadAllText($relatorio)
 Exigir-Supv ($texto-notmatch'segredo-ficticio|pessoa@example.com|abc123|SELECT') 'relatorio real continua mascarado apos extracao'
 # CLI homologar imprime e copia o mesmo relatorio, sem clipboard real.
 $script:copiado=''
 $script:homologacoes=0
 function powershell.exe {
  $script:homologacoes++
  $i=[array]::IndexOf($args,'-Destino')
  $conteudo=([string][char]0x2705+' Relatorio da execucao '+$script:homologacoes+' - '+(Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fffffff')+' - '+[char]0xE7+[Environment]::NewLine)
  [IO.File]::WriteAllText($args[$i+1],$conteudo,(New-Object Text.UTF8Encoding($false)))
  $global:LASTEXITCODE=0
 }
 $copiarReal=(Get-Command Copiar-RelatorioSupv).ScriptBlock
 function Copiar-RelatorioSupv {param($Texto) $script:copiado=$Texto;return $true}
 $textoCli=Capturar-Supv {Executar-ComandoSupv (Ler-ComandoSupv @('homologar','--destino',$relatorio,'--copiar'))}
 $salvo=[IO.File]::ReadAllText($relatorio)
 Exigir-Supv ($script:homologacoes-eq1-and$script:copiado-ceq$salvo-and$textoCli.Contains($salvo)-and$salvo-notmatch'[^\x00-\x7F]') 'homologar --copiar: uma execucao; mesmo texto e horario ASCII no console, arquivo e copia'
 Remove-Item Function:powershell.exe
 Set-Item Function:Copiar-RelatorioSupv $copiarReal
 # Processos reais exercitam sucesso, erro e bloqueio do worker sem clipboard real.
 $codigoCopiaReal=(Get-Command Obter-CodigoCopiaSupv).ScriptBlock
 try{
  function Obter-CodigoCopiaSupv {return '[Environment]::Exit(0)'}
  Exigir-Supv (Copiar-RelatorioSupv $salvo) 'worker da copia termina com codigo 0'
  function Obter-CodigoCopiaSupv {return '[Environment]::Exit(1)'}
  Exigir-Supv (!(Copiar-RelatorioSupv $salvo)) 'falha da copia retorna sem excecao'
  $script:pidCopia=Join-Path $base 'copia.pid'
  function Obter-CodigoCopiaSupv {return ("[IO.File]::WriteAllText('"+$script:pidCopia.Replace("'","''")+"',[string]`$PID);Start-Sleep -Seconds 30")}
  $tempo=[Diagnostics.Stopwatch]::StartNew()
  $copiou=Copiar-RelatorioSupv $salvo -LimiteMs 3000
  Exigir-Supv (!$copiou-and$tempo.Elapsed.TotalSeconds-lt5-and(Test-Path $script:pidCopia)) 'copia bloqueada respeita timeout e retorna'
  $pidWorker=[int][IO.File]::ReadAllText($script:pidCopia)
  Exigir-Supv (!(Get-Process -Id $pidWorker -ErrorAction SilentlyContinue)) 'timeout encerra worker da copia'
 }finally{Set-Item Function:Obter-CodigoCopiaSupv $codigoCopiaReal}
 # CLI inteira em processo filho: caminho real de clipboard/STA no CI Windows.
 if($env:OS-eq'Windows_NT'){
  $homologador=Join-Path $script:supvRaiz 'scripts/homologar.ps1'
  $originalHomologador=[IO.File]::ReadAllText($homologador)
  Set-Content $homologador 'param($Destino) [IO.File]::WriteAllText($Destino,"Relatorio ASCII da fixture");exit 0' -Encoding ASCII
  $cliFixture=Join-Path $script:supvRaiz 'scripts/supv.ps1'
  $originalCli=[IO.File]::ReadAllText($cliFixture)
  try{
   foreach($casoCopia in @('normal','bloqueada')){
    $fonteCli=$originalCli
    if($casoCopia-eq'bloqueada'){$fonteCli=$fonteCli.Replace('[Windows.Forms.Clipboard]::SetText([IO.File]::ReadAllText($env:SUPV_RELATORIO_COPIA))','Start-Sleep -Seconds 30')}
    [IO.File]::WriteAllText($cliFixture,$fonteCli,(New-Object Text.UTF8Encoding($true)))
    $filhoCopia=New-Object Diagnostics.Process
    try{
     $filhoCopia.StartInfo.FileName=$hostTeste
     $filhoCopia.StartInfo.Arguments='-NoProfile -File "'+$cliFixture+'" homologar --copiar --destino "'+$relatorio+'"'
     $filhoCopia.StartInfo.UseShellExecute=$false;$filhoCopia.StartInfo.CreateNoWindow=$true
     $filhoCopia.StartInfo.RedirectStandardOutput=$true;$filhoCopia.StartInfo.RedirectStandardError=$true
     [void]$filhoCopia.Start()
     $stdoutCopia=$filhoCopia.StandardOutput.ReadToEndAsync();$stderrCopia=$filhoCopia.StandardError.ReadToEndAsync()
     Exigir-Supv ($filhoCopia.WaitForExit(15000)) ("homologar --copiar encerra processo em ate 15 s: $casoCopia")
     $textoCopia=$stdoutCopia.Result
     Exigir-Supv ($filhoCopia.ExitCode-eq0-and$textoCopia-like'*Relatorio ASCII da fixture*') ("homologar --copiar retorna codigo 0: $casoCopia")
     if($casoCopia-eq'bloqueada'){Exigir-Supv ($textoCopia-like'*AVISO: copia indisponivel ou prazo de 5 s excedido*') 'timeout da copia avisa sem travar a CLI'}
    }finally{
     if($filhoCopia.Id-and!$filhoCopia.HasExited){$filhoCopia.Kill()}
     $filhoCopia.Dispose()
    }
   }
  }finally{
   [IO.File]::WriteAllText($homologador,$originalHomologador)
   [IO.File]::WriteAllText($cliFixture,$originalCli,(New-Object Text.UTF8Encoding($true)))
  }
 }
 # Restaura consulta real para testar disparo, reconexao e recusa por identidade.
 . (Join-Path $origem 'administracao-logica.ps1')
 if($env:OS-ne'Windows_NT'){
  # Somente a opcao de janela e especifica do Windows; o worker e real no Linux.
  function Start-Process {
   param($FilePath,$ArgumentList,$WindowStyle,[switch]$PassThru,$RedirectStandardOutput,$RedirectStandardError)
   Microsoft.PowerShell.Management\Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -PassThru:$PassThru
  }
 }
 $atualizador=@'
param([switch]$ForcarCompleto)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
. (Join-Path $PSScriptRoot 'atualizacao-preparo.ps1')
$op=Join-Path (Obter-PastaPrivada (Split-Path $PSScriptRoot)) 'operacao'
$andamento=Novo-AndamentoAtualizacao (Join-Path $op 'atualizacao-andamento.json') (Join-Path $op 'atualizacao-tempos.log')
$modo=if($ForcarCompleto){'completo'}else{'rapido'}
Publicar-AndamentoAtualizacao $andamento 'PREPARAR / Consulta CI'
Publicar-AndamentoAtualizacao $andamento 'PREPARAR / Build do Portal' -Modo $modo -MotivoModo 'decisao ficticia do CI'
Start-Sleep -Seconds 4
if(Test-Path (Join-Path $op 'provocar-falha')){Publicar-AndamentoAtualizacao $andamento 'Falha ficticia' 'falhou';Write-Output 'Falha ficticia';exit 7}
Publicar-AndamentoAtualizacao $andamento 'Atualizacao concluida' 'concluido'
Start-Sleep -Seconds 3
Write-Output '=== Atualizado: 1234567 -> abcdef0 ==='
exit 0
'@
 Set-Content (Join-Path $script:supvRaiz 'scripts/atualizar-servidor.ps1') $atualizador -Encoding UTF8
 $r=Iniciar-AtualizacaoAdministrada $script:supvRaiz $script:supvPrivado $true;[void]$processos.Add($r.processo)
 Exigir-Supv (!$r.processo.HasExited-and$r.processo.Id-ne$PID) 'atualizar dispara processo independente'
 Exigir-Supv (Esperar-Supv {(Consultar-AndamentoAdministrado $script:supvPrivado).modo-eq'completo'}) '--completo chega como -ForcarCompleto'
 Recusar-Supv {Iniciar-AtualizacaoAdministrada $script:supvRaiz $script:supvPrivado} '*Atualizacao em andamento*'
 $texto=Capturar-Supv {Executar-ComandoSupv (Ler-ComandoSupv @('acompanhar'))}
 Exigir-Supv ($texto-like'*Etapa * de *'-and$texto-like'*Tempo total:*'-and$texto-like'*Sistema atualizado*') 'acompanhar reconecta e apresenta resultado real'
 Exigir-Supv (@($texto-split"`n"|Where-Object {$_-eq'Modo completo: decisao ficticia do CI'}).Count-eq1) 'reconexao exibe motivo da decisao uma vez'
 Exigir-Supv (@($texto-split"`n"|Where-Object {$_-like'Etapa *: Atualizacao concluida*'}).Count-eq1) 'worker real aguardado sem repetir conclusao'
 $r.processo.WaitForExit();Exigir-Supv ($r.processo.ExitCode-eq0) 'worker preserva codigo de sucesso'
 $texto=Capturar-Supv {Executar-ComandoSupv (Ler-ComandoSupv @('acompanhar'))}
 Exigir-Supv ($texto-like'*Nao ha atualizacao*'-and$texto-like'*Sistema atualizado*') 'sem atualizacao mostra ultimo resultado'
 Set-Content (Join-Path $op 'provocar-falha') 'fixture'
 $r=Iniciar-AtualizacaoAdministrada $script:supvRaiz $script:supvPrivado;[void]$processos.Add($r.processo)
 Exigir-Supv (!(Acompanhar-AtualizacaoSupv $r.processo)) 'falha devolve resultado negativo'
 Exigir-Supv ($r.processo.ExitCode-eq7) 'worker preserva codigo de falha'
 Remove-Item (Join-Path $op 'provocar-falha')
 $limpeza=Join-Path $op 'limpeza-preparo.lock'
 @{pid=$PID;inicio=(Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o')}|ConvertTo-Json|Set-Content $limpeza -Encoding UTF8
 Recusar-Supv {Iniciar-AtualizacaoAdministrada $script:supvRaiz $script:supvPrivado} '*Limpeza de preparo*'
 Remove-Item $limpeza
 $h=[IO.File]::Open($limpeza,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{Recusar-Supv {Iniciar-AtualizacaoAdministrada $script:supvRaiz $script:supvPrivado} '*Limpeza de preparo*'}finally{$h.Dispose();Remove-Item $limpeza}
 # Abandona um cliente real durante a atualizacao; nao chama Stop no worker.
 $scriptCliente=Join-Path $base 'cliente.ps1'
 $codigoCliente=@'
param($Raiz,$Privado)
$env:SUPPLY_VISION_PRIVADO=$Privado
. (Join-Path $Raiz 'scripts/operacao-logica.ps1')
. (Join-Path $Raiz 'scripts/inicializacao-logica.ps1')
. (Join-Path $Raiz 'scripts/administracao-logica.ps1')
$r=Iniciar-AtualizacaoAdministrada $Raiz $Privado
& (Join-Path $Raiz 'scripts/supv.ps1') acompanhar
'@
 # Linux adapta apenas Start-Process; Windows usa o caminho de producao.
 if($env:OS-ne'Windows_NT'){$codigoCliente=$codigoCliente.Replace('$r=Iniciar-',@'
function Start-Process {param($FilePath,$ArgumentList,$WindowStyle,[switch]$PassThru,$RedirectStandardOutput,$RedirectStandardError)
 Microsoft.PowerShell.Management\Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -PassThru:$PassThru
}
$r=Iniciar-
'@)}
 Set-Content $scriptCliente $codigoCliente -Encoding UTF8
 $argsCliente='-NoProfile -File "'+$scriptCliente+'" "'+$script:supvRaiz+'" "'+$script:supvPrivado+'"'
 $inicioCliente=@{FilePath=$hostTeste;ArgumentList=$argsCliente;PassThru=$true;RedirectStandardOutput=(Join-Path $base 'cliente-saida.log');RedirectStandardError=(Join-Path $base 'cliente-erro.log')}
 if($env:OS-eq'Windows_NT'){$inicioCliente.WindowStyle='Hidden'}
 $pai=Microsoft.PowerShell.Management\Start-Process @inicioCliente;[void]$pai.Handle;[void]$processos.Add($pai)
 Exigir-Supv (Esperar-Supv {Consultar-AtualizacaoAdministrada $script:supvRaiz $script:supvPrivado}) 'cliente independente iniciou worker'
 $worker=Consultar-AtualizacaoAdministrada $script:supvRaiz $script:supvPrivado;[void]$processos.Add($worker)
 if($env:OS-eq'Windows_NT'){
  # Envia CTRL_C_EVENT ao console do cliente usando outro processo.
  $sinal=Join-Path $base 'ctrl-c.ps1'
  Set-Content $sinal @'
param([int]$Cliente)
Add-Type -TypeDefinition @"
using System;using System.Runtime.InteropServices;
public static class SupvCtrlC {
 [DllImport("kernel32.dll")] public static extern bool FreeConsole();
 [DllImport("kernel32.dll")] public static extern bool AttachConsole(uint id);
 [DllImport("kernel32.dll")] public static extern bool SetConsoleCtrlHandler(IntPtr handler,bool add);
 [DllImport("kernel32.dll")] public static extern bool GenerateConsoleCtrlEvent(uint e,uint group);
}
"@
[void][SupvCtrlC]::FreeConsole()
if(![SupvCtrlC]::AttachConsole($Cliente)){exit 1}
[void][SupvCtrlC]::SetConsoleCtrlHandler([IntPtr]::Zero,$true)
if(![SupvCtrlC]::GenerateConsoleCtrlEvent(0,0)){exit 2}
Start-Sleep -Milliseconds 300
exit 0
'@ -Encoding UTF8
  $rSinal=Executar-NativoOperacao $hostTeste @('-NoProfile','-File',$sinal,'-Cliente',[string]$pai.Id)
  Exigir-Supv ($rSinal.codigo-eq0-and(Esperar-Supv {$pai.HasExited} 5)) 'Ctrl+C encerra somente cliente'
 }else{
  Stop-Process -Id $pai.Id -Force
  Write-Host 'PULADO: CTRL_C_EVENT exige Windows; fechamento do cliente real testado no Linux.'
 }
 Exigir-Supv (!$worker.HasExited) 'worker continua depois do fechamento/Ctrl+C'
 $texto=Capturar-Supv {Executar-ComandoSupv (Ler-ComandoSupv @('acompanhar'))}
 if($texto-notlike'*Sistema atualizado*'){Write-Host $texto}
 Exigir-Supv ($texto-like'*Sistema atualizado*') 'reconexao apos abandono conclui com sucesso'
 Write-Host 'PASSOU: CLI supv, leitura, mascaramento, confirmacoes, processo independente e reconexao.'
}finally{
 $env:SUPPLY_VISION_PRIVADO=$anterior
 foreach($processo in $processos){try{if(!$processo.HasExited){Stop-Process -Id $processo.Id -Force};$processo.Dispose()}catch{}}
 Remove-Item -LiteralPath $base -Recurse -Force -ErrorAction SilentlyContinue
}
