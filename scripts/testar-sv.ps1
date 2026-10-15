# Uma instalacao ficticia; sem tarefa, firewall, clipboard ou dados reais.
$ErrorActionPreference='Stop'
$origem=$PSScriptRoot
. (Join-Path $origem 'sv.ps1')
$base=Join-Path ([IO.Path]::GetTempPath()) ('sv-cli-'+[guid]::NewGuid().ToString('N'))
$anterior=$env:SUPPLY_VISION_PRIVADO
$hostTeste=(Get-Process -Id $PID).Path
$processos=New-Object Collections.ArrayList
function Exigir-Sv([bool]$Ok,[string]$Nome){if(!$Ok){throw "Falhou: $Nome"};Write-Host "OK sv: $Nome"}
function Recusar-Sv([scriptblock]$Codigo,[string]$Padrao){
 $falhou=$false;try{& $Codigo|Out-Null}catch{$falhou=$_.Exception.Message-like$Padrao}
 Exigir-Sv $falhou $Padrao
}
function Capturar-Sv([scriptblock]$Codigo){return (@(& $Codigo 6>&1)-join"`n")}
function Esperar-Sv([scriptblock]$Codigo,[int]$Segundos=25){
 $relogio=[Diagnostics.Stopwatch]::StartNew()
 while($relogio.Elapsed.TotalSeconds-lt$Segundos){if(& $Codigo){return $true};Start-Sleep -Milliseconds 100}
 return $false
}
try{
 $script:svRaiz=Join-Path $base 'instalacao com espacos';$script:svPrivado=Join-Path $base 'privado';$script:svStartup=Join-Path $base 'inicio.cmd'
 $env:SUPPLY_VISION_PRIVADO=$script:svPrivado
 foreach($p in @('scripts','portal/scripts')){[void][IO.Directory]::CreateDirectory((Join-Path $script:svRaiz $p))}
 foreach($p in @('comum','operacao','portal/configuracao','portal/logs')){[void][IO.Directory]::CreateDirectory((Join-Path $script:svPrivado $p))}
 foreach($nome in @('sv','administracao-logica','diagnostico-logica','operacao-logica','inicializacao-logica','migracao-logica','atualizacao-preparo','atualizar-operacao','homologar')){Copy-Item (Join-Path $origem ($nome+'.ps1')) (Join-Path $script:svRaiz 'scripts')}
 $op=Join-Path $script:svPrivado 'operacao'
 Set-Content (Join-Path $script:svPrivado 'comum/operacao.env') 'MODO_ENSAIO=0' -Encoding UTF8
 Set-Content (Join-Path $script:svPrivado 'portal/configuracao/portal.env') "PORTAL_PORTA=31415`nPORTAL_API_TOKEN=segredo-ficticio`nBACKUP_EMAIL_TO=pessoa@example.com" -Encoding UTF8
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
 $script:svSegredos=Obter-SegredosHomologacao $script:svPrivado
 $pathFicticio=Acrescentar-ComandoSvAoPath $script:svRaiz 'primeiro;segundo'
 Exigir-Sv ($pathFicticio-eq('primeiro;segundo;'+$script:svRaiz)) 'PATH preserva entradas existentes'
 Exigir-Sv ((Acrescentar-ComandoSvAoPath $script:svRaiz $pathFicticio)-ceq$pathFicticio) 'PATH idempotente'
 Exigir-Sv ((Acrescentar-ComandoSvAoPath $script:svRaiz ('"'+$script:svRaiz.ToUpperInvariant()+'\"'))-eq('"'+$script:svRaiz.ToUpperInvariant()+'\"')) 'PATH reconhece caixa, aspas e barra final'

 foreach($nome in @('status','iniciar','parar','atualizar','acompanhar','homologar','saude','logs','config','backup','modo','manutencao','firewall','migrar')){
  $c=Ler-ComandoSv @($nome,'--help');$texto=Capturar-Sv {Executar-ComandoSv $c}
  Exigir-Sv ($texto-like"*sv $nome*"-and$texto-notmatch'[^\x00-\x7F]') "help e ASCII: $nome"
 }
 $c=Ler-ComandoSv @('homologar','--destino','C:\uma pasta\arquivo.txt','--copiar')
 Exigir-Sv ($c.opcoes['--destino']-eq'C:\uma pasta\arquivo.txt'-and$c.opcoes['--copiar']) 'parsing de caminho e opcoes'
 Recusar-Sv {Ler-ComandoSv @('atualizar','--invalido')} '*Opcao desconhecida*'
 Recusar-Sv {Ler-ComandoSv @('logs','portal','-n')} '*Falta valor*'
 Recusar-Sv {Ler-ComandoSv @('logs','portal','-n','1','-n','2')} '*Opcao repetida*'
 foreach($caso in @(@('inexistente'),@('logs','portal','-n','0'),@('iniciar','extra'),@('modo','invalido'),@('saude','--desde','ontem'))){
  $c=Ler-ComandoSv $caso;Recusar-Sv {Executar-ComandoSv $c} '*'
 }
 foreach($caso in @(@('help'),@('inexistente'),@('atualizar','--erro'))){
  $texto=(& $hostTeste -NoProfile -File (Join-Path $origem 'sv.ps1') @caso 2>&1)-join"`n";$codigo=$LASTEXITCODE
  Exigir-Sv (($caso[0]-eq'help'-and$codigo-eq0)-or($caso[0]-ne'help'-and$codigo-ne0)) "codigo real do processo: $($caso-join' ')"
  Exigir-Sv ($texto-notmatch'[^\x00-\x7F]') 'saida de processo ASCII'
 }
 # Somente health e agendador simulados. Estado e logs sao lidos de verdade.
 function Consultar-HealthSv {return 'ok'}
 function Get-ScheduledTask {return $null}
 function Consultar-AtualizacaoAdministrada {return $null}
 $antes=@(Get-ChildItem $script:svPrivado -Recurse -File|ForEach-Object {$_.FullName+':'+(Get-FileHash $_.FullName).Hash+':'+$_.LastWriteTimeUtc.Ticks})-join"`n"
 $texto=Capturar-Sv {Executar-ComandoSv (Ler-ComandoSv @('status'))}
 $depois=@(Get-ChildItem $script:svPrivado -Recurse -File|ForEach-Object {$_.FullName+':'+(Get-FileHash $_.FullName).Hash+':'+$_.LastWriteTimeUtc.Ticks})-join"`n"
 Exigir-Sv ($antes-ceq$depois) 'status somente leitura, sem diagnostico nem limpeza de arquivos'
 Exigir-Sv ($texto-like'*Operacao: parada*'-and$texto-like'*Reserva de dependencias: ausente*'-and$texto-like'*Health rede: ok*') 'status apresenta operacao, health e reserva'
 $texto=Capturar-Sv {Executar-ComandoSv (Ler-ComandoSv @('logs','supervisor','-n','80'))}
 Exigir-Sv ($texto-notmatch'segredo-ficticio|pessoa@example.com|abc123|SELECT'-and$texto-like'*conteudo omitido*') 'logs usam mesmo mascaramento da homologacao'
 $texto=Capturar-Sv {Executar-ComandoSv (Ler-ComandoSv @('saude','--desde','2026-10-15 00:00'))}
 Exigir-Sv (([regex]::Matches($texto,'\[partida\]')).Count-eq3-and$texto-like'*Falhas de health: 4*'-and$texto-like'*Supervisor iniciado no periodo: 1*') 'saude: limites de 30 s, inicio antes do recorte e reinicios'
 Exigir-Sv ($texto-like'*HTTP 5xx: 2 | D1_ERROR: 1 | Retentativas D1: 1*'-and$texto-like'*ultimo reinicio*') 'saude: Portal e cobertura dos logs'
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
 Exigir-Sv ((Executar-ComandoSv (Ler-ComandoSv @('iniciar')))-eq0) 'iniciar aguarda supervisor e health'
 Exigir-Sv ((Executar-ComandoSv (Ler-ComandoSv @('parar')))-eq0) 'parar propaga sucesso'
 $script:paradaOk=$false;Recusar-Sv {Executar-ComandoSv (Ler-ComandoSv @('parar'))} '*nao concluido*';$script:paradaOk=$true
 $antesAcoes=$script:chamadas.Count
 Recusar-Sv {Executar-ComandoSv (Ler-ComandoSv @('backup','restaurar'))} '*cancelada*'
 Exigir-Sv ($script:chamadas.Count-eq$antesAcoes) 'recusa RESTAURAR antes de parar'
 $script:resposta='RESTAURAR'
 [void](Executar-ComandoSv (Ler-ComandoSv @('backup','restaurar','--anterior')))
 [void](Executar-ComandoSv (Ler-ComandoSv @('backup','restaurar','--sim')))
 Exigir-Sv (@($script:chamadas|Where-Object {$_-like'node *--anterior*'}).Count-eq1) 'restauracao anterior e --sim delegam ao comportamento atual'
 foreach($caso in @(@('modo','login'),@('firewall','restringir'),@('migrar','--destino',$base,'--modo','ensaio'))){Recusar-Sv {Executar-ComandoSv (Ler-ComandoSv $caso)} '*abra o terminal como administrador*'}
 $script:elevado=$true;$script:resposta='nao'
 Recusar-Sv {Executar-ComandoSv (Ler-ComandoSv @('migrar','--destino',$base,'--modo','definitiva'))} '*cancelada*'
 $script:resposta='MIGRAR';[void](Executar-ComandoSv (Ler-ComandoSv @('migrar','--destino',$base,'--modo','definitiva')))
 Exigir-Sv ($script:chamadas-contains'migrar') 'MIGRAR confirma a migracao definitiva'
 Recusar-Sv {Executar-ComandoSv (Ler-ComandoSv @('modo','login'))} '*Pare a operacao*'
 function Testar-SupervisorEncerrado {return $true}
 [void](Executar-ComandoSv (Ler-ComandoSv @('modo','login')))
 [void](Executar-ComandoSv (Ler-ComandoSv @('manutencao','on')))
 Exigir-Sv (Test-Path (Join-Path $op 'manutencao.sinal')) 'manutencao on'
 [void](Executar-ComandoSv (Ler-ComandoSv @('manutencao','off')))
 Exigir-Sv (!(Test-Path (Join-Path $op 'manutencao.sinal'))) 'manutencao off'
 # Homologar real na fixture, dependencias externas ficticias.
 $relatorio=Join-Path $base 'homologacao.txt'
 $fixtureInit=Join-Path $script:svRaiz 'scripts/inicializacao-logica.ps1'
 Add-Content $fixtureInit 'function Localizar-NodeMaquina {throw "node indisponivel na fixture"}'
 Add-Content $fixtureInit 'function Testar-Elevacao {return $false}'
 $adminTexto=(& $hostTeste -NoProfile -File (Join-Path $script:svRaiz 'scripts/sv.ps1') modo login 2>&1)-join"`n"
 Exigir-Sv ($LASTEXITCODE-ne0-and$adminTexto-like'*abra o terminal como administrador*') 'processo real retorna falha e mensagem de administrador'
 $saida=& $hostTeste -NoProfile -File (Join-Path $script:svRaiz 'scripts/homologar.ps1') -Destino $relatorio 2>&1
 Exigir-Sv (Test-Path -LiteralPath $relatorio) 'homologar mantem arquivo txt'
 $texto=[IO.File]::ReadAllText($relatorio)
 Exigir-Sv ($texto-notmatch'segredo-ficticio|pessoa@example.com|abc123|SELECT') 'relatorio real continua mascarado apos extracao'
 # CLI homologar imprime e copia o mesmo relatorio, sem clipboard real.
 $script:copiado=''
 function powershell.exe {$global:LASTEXITCODE=0}
 function Set-Clipboard {param($Value) $script:copiado=$Value}
 $textoCli=Capturar-Sv {Executar-ComandoSv (Ler-ComandoSv @('homologar','--destino',$relatorio,'--copiar'))}
 Exigir-Sv ($script:copiado-ceq$texto-and$textoCli-like'*Relatorio copiado*'-and$textoCli-notmatch'[^\x00-\x7F]') 'homologar --copiar e console ASCII'
 Remove-Item Function:powershell.exe
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
 Set-Content (Join-Path $script:svRaiz 'scripts/atualizar-servidor.ps1') $atualizador -Encoding UTF8
 $r=Iniciar-AtualizacaoAdministrada $script:svRaiz $script:svPrivado $true;[void]$processos.Add($r.processo)
 Exigir-Sv (!$r.processo.HasExited-and$r.processo.Id-ne$PID) 'atualizar dispara processo independente'
 Exigir-Sv (Esperar-Sv {(Consultar-AndamentoCentral $script:svPrivado).modo-eq'completo'}) '--completo chega como -ForcarCompleto'
 Recusar-Sv {Iniciar-AtualizacaoAdministrada $script:svRaiz $script:svPrivado} '*Atualizacao em andamento*'
 $texto=Capturar-Sv {Executar-ComandoSv (Ler-ComandoSv @('acompanhar'))}
 Exigir-Sv ($texto-like'*Etapa * de *'-and$texto-like'*Tempo total:*'-and$texto-like'*Sistema atualizado*') 'acompanhar reconecta e apresenta resultado real'
 $r.processo.WaitForExit();Exigir-Sv ($r.processo.ExitCode-eq0) 'worker preserva codigo de sucesso'
 $texto=Capturar-Sv {Executar-ComandoSv (Ler-ComandoSv @('acompanhar'))}
 Exigir-Sv ($texto-like'*Nao ha atualizacao*'-and$texto-like'*Sistema atualizado*') 'sem atualizacao mostra ultimo resultado'
 Set-Content (Join-Path $op 'provocar-falha') 'fixture'
 $r=Iniciar-AtualizacaoAdministrada $script:svRaiz $script:svPrivado;[void]$processos.Add($r.processo)
 Exigir-Sv (!(Acompanhar-AtualizacaoSv $r.processo)) 'falha devolve resultado negativo'
 Exigir-Sv ($r.processo.ExitCode-eq7) 'worker preserva codigo de falha'
 Remove-Item (Join-Path $op 'provocar-falha')
 $limpeza=Join-Path $op 'limpeza-preparo.lock'
 @{pid=$PID;inicio=(Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o')}|ConvertTo-Json|Set-Content $limpeza -Encoding UTF8
 Recusar-Sv {Iniciar-AtualizacaoAdministrada $script:svRaiz $script:svPrivado} '*Limpeza de preparo*'
 Remove-Item $limpeza
 $h=[IO.File]::Open($limpeza,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{Recusar-Sv {Iniciar-AtualizacaoAdministrada $script:svRaiz $script:svPrivado} '*Limpeza de preparo*'}finally{$h.Dispose();Remove-Item $limpeza}
 # Abandona um cliente real durante a atualizacao; nao chama Stop no worker.
 $cliente=Join-Path $base 'cliente.ps1'
 $codigoCliente=@'
param($Raiz,$Privado)
$env:SUPPLY_VISION_PRIVADO=$Privado
. (Join-Path $Raiz 'scripts/operacao-logica.ps1')
. (Join-Path $Raiz 'scripts/inicializacao-logica.ps1')
. (Join-Path $Raiz 'scripts/administracao-logica.ps1')
$r=Iniciar-AtualizacaoAdministrada $Raiz $Privado
& (Join-Path $Raiz 'scripts/sv.ps1') acompanhar
'@
 # Linux adapta apenas Start-Process; Windows usa o caminho de producao.
 if($env:OS-ne'Windows_NT'){$codigoCliente=$codigoCliente.Replace('$r=Iniciar-',@'
function Start-Process {param($FilePath,$ArgumentList,$WindowStyle,[switch]$PassThru,$RedirectStandardOutput,$RedirectStandardError)
 Microsoft.PowerShell.Management\Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -PassThru:$PassThru
}
$r=Iniciar-
'@)}
 Set-Content $cliente $codigoCliente -Encoding UTF8
 $argsCliente='-NoProfile -File "'+$cliente+'" "'+$script:svRaiz+'" "'+$script:svPrivado+'"'
 $inicioCliente=@{FilePath=$hostTeste;ArgumentList=$argsCliente;PassThru=$true;RedirectStandardOutput=(Join-Path $base 'cliente-saida.log');RedirectStandardError=(Join-Path $base 'cliente-erro.log')}
 if($env:OS-eq'Windows_NT'){$inicioCliente.WindowStyle='Hidden'}
 $pai=Microsoft.PowerShell.Management\Start-Process @inicioCliente;[void]$pai.Handle;[void]$processos.Add($pai)
 Exigir-Sv (Esperar-Sv {Consultar-AtualizacaoAdministrada $script:svRaiz $script:svPrivado}) 'cliente independente iniciou worker'
 $worker=Consultar-AtualizacaoAdministrada $script:svRaiz $script:svPrivado;[void]$processos.Add($worker)
 if($env:OS-eq'Windows_NT'){
  # Envia CTRL_C_EVENT ao console do cliente usando outro processo.
  $sinal=Join-Path $base 'ctrl-c.ps1'
  Set-Content $sinal @'
param([int]$Cliente)
Add-Type -TypeDefinition @"
using System;using System.Runtime.InteropServices;
public static class SvCtrlC {
 [DllImport("kernel32.dll")] public static extern bool FreeConsole();
 [DllImport("kernel32.dll")] public static extern bool AttachConsole(uint id);
 [DllImport("kernel32.dll")] public static extern bool SetConsoleCtrlHandler(IntPtr handler,bool add);
 [DllImport("kernel32.dll")] public static extern bool GenerateConsoleCtrlEvent(uint e,uint group);
}
"@
[void][SvCtrlC]::FreeConsole()
if(![SvCtrlC]::AttachConsole($Cliente)){exit 1}
[void][SvCtrlC]::SetConsoleCtrlHandler([IntPtr]::Zero,$true)
if(![SvCtrlC]::GenerateConsoleCtrlEvent(0,0)){exit 2}
Start-Sleep -Milliseconds 300
exit 0
'@ -Encoding UTF8
  & $hostTeste -NoProfile -File $sinal -Cliente $pai.Id
  Exigir-Sv ($LASTEXITCODE-eq0-and(Esperar-Sv {$pai.HasExited} 5)) 'Ctrl+C encerra somente cliente'
 }else{
  Stop-Process -Id $pai.Id -Force
  Write-Host 'PULADO: CTRL_C_EVENT exige Windows; fechamento do cliente real testado no Linux.'
 }
 Exigir-Sv (!$worker.HasExited) 'worker continua depois do fechamento/Ctrl+C'
 $texto=Capturar-Sv {Executar-ComandoSv (Ler-ComandoSv @('acompanhar'))}
 if($texto-notlike'*Sistema atualizado*'){Write-Host $texto}
 Exigir-Sv ($texto-like'*Sistema atualizado*') 'reconexao apos abandono conclui com sucesso'
 Write-Host 'PASSOU: CLI sv, leitura, mascaramento, confirmacoes, processo independente e reconexao.'
}finally{
 $env:SUPPLY_VISION_PRIVADO=$anterior
 foreach($processo in $processos){try{if(!$processo.HasExited){Stop-Process -Id $processo.Id -Force};$processo.Dispose()}catch{}}
 Remove-Item -LiteralPath $base -Recurse -Force -ErrorAction SilentlyContinue
}
