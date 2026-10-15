# Uma instalacao ficticia; sem tarefa, firewall ou dados reais.
$ErrorActionPreference='Stop'
$origem=$PSScriptRoot
. (Join-Path $origem 'supv.ps1')
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
 $script:supvRaiz=Join-Path $base 'instalacao com espacos';$script:supvPrivado=Join-Path $base 'privado';$script:supvStartup=Join-Path $base 'inicio.cmd'
 $env:SUPPLY_VISION_PRIVADO=$script:supvPrivado
 foreach($p in @('scripts','portal/scripts')){[void][IO.Directory]::CreateDirectory((Join-Path $script:supvRaiz $p))}
 foreach($p in @('comum','operacao','portal/configuracao','portal/logs')){[void][IO.Directory]::CreateDirectory((Join-Path $script:supvPrivado $p))}
 foreach($nome in @('supv','administracao-logica','diagnostico-logica','operacao-logica','inicializacao-logica','migracao-logica','atualizacao-preparo','atualizar-operacao','homologar')){Copy-Item (Join-Path $origem ($nome+'.ps1')) (Join-Path $script:supvRaiz 'scripts')}
 Copy-Item (Join-Path $origem '../supv.cmd') (Join-Path $script:supvRaiz 'supv.cmd')
 Set-Content (Join-Path $script:supvRaiz 'sv.cmd') 'legado' -Encoding ASCII
 Remover-ComandoSvLegado $script:supvRaiz
 Remover-ComandoSvLegado $script:supvRaiz
 Exigir-Supv (!(Test-Path (Join-Path $script:supvRaiz 'sv.cmd'))-and(Test-Path (Join-Path $script:supvRaiz 'supv.cmd'))) 'remove sv.cmd legado sem remover supv.cmd; idempotente'
 if($env:OS-eq'Windows_NT'){
  $invocar=Join-Path $base 'invocar-supv.ps1'
  Set-Content $invocar 'param($Raiz) $env:Path=$Raiz+";"+$env:Path;supv help;exit $LASTEXITCODE' -Encoding ASCII
  $r=Executar-NativoOperacao 'powershell.exe' @('-NoProfile','-ExecutionPolicy','Bypass','-File',$invocar,$script:supvRaiz)
  Exigir-Supv ($r.codigo-eq0-and($r.saida-join' ')-like'*Supply Vision - supv <comando>*') 'powershell.exe resolve supv help pelo PATH e retorna 0'
 }else{Write-Host 'PULADO: resolucao de supv.cmd pelo powershell.exe exige Windows.'}

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
 Set-Content (Join-Path $op 'portal-saida.log') @('GET /teste 500 Internal Server Error','HTTP/1.1 503','D1_ERROR: teste','[portal] D1 interno na leitura; nova tentativa unica em 100 ms.') -Encoding UTF8
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

 $pathFicticio=Acrescentar-ComandoSupvAoPath $script:supvRaiz 'primeiro;segundo'
 Exigir-Supv ($pathFicticio-eq('primeiro;segundo;'+$script:supvRaiz)) 'PATH preserva entradas existentes'
 Exigir-Supv ((Acrescentar-ComandoSupvAoPath $script:supvRaiz $pathFicticio)-ceq$pathFicticio) 'PATH idempotente'
 Exigir-Supv ((Acrescentar-ComandoSupvAoPath $script:supvRaiz ('"'+$script:supvRaiz.ToUpperInvariant()+'\"'))-eq('"'+$script:supvRaiz.ToUpperInvariant()+'\"')) 'PATH reconhece caixa, aspas e barra final'

 foreach($nome in @('status','iniciar','parar','atualizar','acompanhar','homologar','saude','logs','config','backup','modo','manutencao','firewall','migrar')){
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
 $texto=Capturar-Supv {Executar-ComandoSupv (Ler-ComandoSupv @('logs','supervisor','-n','80'))}
 Exigir-Supv ($texto-notmatch'segredo-ficticio|pessoa@example.com|abc123|SELECT'-and$texto-like'*conteudo omitido*') 'logs usam mesmo mascaramento da homologacao'
 $texto=Capturar-Supv {Executar-ComandoSupv (Ler-ComandoSupv @('saude','--desde','2026-10-15 00:00'))}
 Exigir-Supv (([regex]::Matches($texto,'\[partida\]')).Count-eq3-and$texto-like'*Falhas de health: 4*'-and$texto-like'*Supervisor iniciado no periodo: 1*') 'saude: limites de 30 s, inicio antes do recorte e reinicios'
 Exigir-Supv ($texto-like'*HTTP 5xx: 2 | D1_ERROR: 1 | Retentativas D1: 1*'-and$texto-like'*ultimo reinicio*') 'saude: Portal e cobertura dos logs'
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
 function Preparar-Migracao {$script:chamadas+='migrar'}
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
 foreach($caso in @(@('modo','login'),@('firewall','restringir'),@('migrar','--destino',$base,'--modo','ensaio'))){Recusar-Supv {Executar-ComandoSupv (Ler-ComandoSupv $caso)} '*abra o terminal como administrador*'}
 $script:elevado=$true;$script:resposta='nao'
 Recusar-Supv {Executar-ComandoSupv (Ler-ComandoSupv @('migrar','--destino',$base,'--modo','definitiva'))} '*cancelada*'
 $script:resposta='MIGRAR';[void](Executar-ComandoSupv (Ler-ComandoSupv @('migrar','--destino',$base,'--modo','definitiva')))
 Exigir-Supv ($script:chamadas-contains'migrar') 'MIGRAR confirma a migracao definitiva'
 Recusar-Supv {Executar-ComandoSupv (Ler-ComandoSupv @('modo','login'))} '*Pare a operacao*'
 function Testar-SupervisorEncerrado {return $true}
 [void](Executar-ComandoSupv (Ler-ComandoSupv @('modo','login')))
 [void](Executar-ComandoSupv (Ler-ComandoSupv @('manutencao','on')))
 Exigir-Supv (Test-Path (Join-Path $op 'manutencao.sinal')) 'manutencao on'
 [void](Executar-ComandoSupv (Ler-ComandoSupv @('manutencao','off')))
 Exigir-Supv (!(Test-Path (Join-Path $op 'manutencao.sinal'))) 'manutencao off'
 # Homologar real na fixture, dependencias externas ficticias.
 $relatorio=Join-Path $base 'homologacao.txt'
 $fixtureInit=Join-Path $script:supvRaiz 'scripts/inicializacao-logica.ps1'
 Add-Content $fixtureInit 'function Localizar-NodeMaquina {throw "node indisponivel na fixture"}'
 Add-Content $fixtureInit 'function Testar-Elevacao {return $false}'
 $r=Executar-NativoOperacao $hostTeste @('-NoProfile','-File',(Join-Path $script:supvRaiz 'scripts/supv.ps1'),'modo','login')
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
Publicar-AndamentoAtualizacao $andamento 'PREPARAR / Build do Portal' -Modo $modo
Start-Sleep -Seconds 4
if(Test-Path (Join-Path $op 'provocar-falha')){Publicar-AndamentoAtualizacao $andamento 'Falha ficticia' 'falhou';Write-Output 'Falha ficticia';exit 7}
Publicar-AndamentoAtualizacao $andamento 'Atualizacao concluida' 'concluido'
Write-Output '=== Atualizado: 1234567 -> abcdef0 ==='
exit 0
'@
 Set-Content (Join-Path $script:supvRaiz 'scripts/atualizar-servidor.ps1') $atualizador -Encoding UTF8
 $r=Iniciar-AtualizacaoAdministrada $script:supvRaiz $script:supvPrivado $true;[void]$processos.Add($r.processo)
 Exigir-Supv (!$r.processo.HasExited-and$r.processo.Id-ne$PID) 'atualizar dispara processo independente'
 Exigir-Supv (Esperar-Supv {(Consultar-AndamentoCentral $script:supvPrivado).modo-eq'completo'}) '--completo chega como -ForcarCompleto'
 Recusar-Supv {Iniciar-AtualizacaoAdministrada $script:supvRaiz $script:supvPrivado} '*Atualizacao em andamento*'
 $texto=Capturar-Supv {Executar-ComandoSupv (Ler-ComandoSupv @('acompanhar'))}
 Exigir-Supv ($texto-like'*Etapa * de *'-and$texto-like'*Tempo total:*'-and$texto-like'*Sistema atualizado*') 'acompanhar reconecta e apresenta resultado real'
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
 $cliente=Join-Path $base 'cliente.ps1'
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
 Set-Content $cliente $codigoCliente -Encoding UTF8
 $argsCliente='-NoProfile -File "'+$cliente+'" "'+$script:supvRaiz+'" "'+$script:supvPrivado+'"'
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
