$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
. (Join-Path $PSScriptRoot 'espera-testes.ps1')
$pasta=Join-Path ([IO.Path]::GetTempPath()) ('sv-health-'+[guid]::NewGuid().ToString('N'))
$proc=$null;$cliente=$null;$clienteRecusa=$null;$proxyAntigo=[Net.WebRequest]::DefaultWebProxy
try{
 New-Item -ItemType Directory $pasta|Out-Null
 $servidor=Join-Path $pasta 'servidor.mjs';$portaArquivo=Join-Path $pasta 'porta.txt'
 $fonte=@'
import fs from 'node:fs';import http from 'node:http';
const server=http.createServer((req,res)=>{
 res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.url==='/lento'){setTimeout(()=>res.end('{"status":"ok"}'),2000);return}
 if(req.url==='/status'){res.statusCode=503;res.end('{"status":"erro"}');return}
 if(req.url==='/redirect'){res.statusCode=302;res.setHeader('Location','http://portal.example.com');res.end('{}');return}
 if(req.url==='/invalido'){res.end('segredo-ficticio');return}
 if(req.url==='/array'){res.end('[{"status":"ok"}]');return}
 res.end('{"status":"ok"}');
});server.listen(0,'127.0.0.1',()=>fs.writeFileSync(process.argv[2],String(server.address().port)));
'@
 [IO.File]::WriteAllText($servidor,$fonte,(New-Object Text.UTF8Encoding($false)))
 $proc=Start-Process (Get-Command node).Source -ArgumentList @(('"'+$servidor+'"'),('"'+$portaArquivo+'"')) -PassThru;[void]$proc.Handle
 if(!(Esperar-CondicaoTeste {Test-Path $portaArquivo})){throw 'Servidor ficticio nao iniciou.'}
 $porta=[int][IO.File]::ReadAllText($portaArquivo)
 # Proxy que daria erro; o handler deve ignora-lo mesmo no Windows 5.1.
 [Net.WebRequest]::DefaultWebProxy=New-Object Net.WebProxy('http://127.0.0.1:1')
 $cliente=Novo-ClienteHealth 1000
 if($cliente.handler.UseProxy-or$cliente.handler.AllowAutoRedirect-or$cliente.handler.UseCookies){throw 'Cliente nao esta isolado.'}
 foreach($caso in @(@('ok','ok',200),@('status','status-http',503),@('redirect','status-http',302),@('invalido','corpo-invalido',200),@('array','corpo-invalido',200),@('lento','timeout',0))){
  $r=Consultar-HealthLocal $cliente ("http://127.0.0.1:$porta/"+$caso[0])
  if($r.motivo-ne$caso[1]-or$r.http-ne$caso[2]-or$r.saudavel-ne($caso[0]-eq'ok')){throw "Resultado incorreto: $($caso[0])"}
  if($r.duracaoMs-lt0-or$r.duracaoMs-gt2000){throw 'Prazo nao limitado.'}
  $registro=Formatar-FalhaHealth $r 1
  if($registro-match'segredo-ficticio|example.com'){throw 'Registro vazou dados da resposta.'}
  Write-Host "OK health: $($caso[0]) $($r.duracaoMs) ms"
 }
 # Mesmo prazo da producao: Windows pode levar 1-2 s para recusar a porta.
 # O caso lento acima permanece com prazo de 1 s e exige timeout.
 $clienteRecusa=Novo-ClienteHealth
 $escuta=New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,0);$escuta.Start();$fechada=$escuta.LocalEndpoint.Port;$escuta.Stop()
 $r=Consultar-HealthLocal $clienteRecusa "http://127.0.0.1:$fechada/api/health"
 if($r.motivo-ne'conexao-recusada'-or$r.saudavel-or$r.http-ne0){throw "Conexao recusada nao identificada: motivo=$($r.motivo); duracao_ms=$($r.duracaoMs); http=$($r.http)."}
 if($r.duracaoMs-lt0-or$r.duracaoMs-gt6000){throw 'Recusa excedeu prazo limitado.'}
 Write-Host "OK health: conexao-recusada $($r.duracaoMs) ms"
 # Tipos/codigos do .NET Framework, com textos deliberadamente contraditorios.
 $socket=[Net.Sockets.SocketException]::new(10061)
 $web=[Net.WebException]::new('texto sem significado',$socket,[Net.WebExceptionStatus]::ConnectFailure,$null)
 $aninhada=[Net.Http.HttpRequestException]::new('timeout ficticio na mensagem',$web)
 $casosErro=@(
  @($aninhada,'conexao-recusada'),
  @([Net.WebException]::new('tempo esgotado ficticio',$null,[Net.WebExceptionStatus]::ConnectFailure,$null),'conexao-recusada'),
  @([Net.WebException]::new('conexao recusada ficticia',$null,[Net.WebExceptionStatus]::Timeout,$null),'timeout'),
  @([Net.Sockets.SocketException]::new(10060),'timeout'),
  @([OperationCanceledException]::new('recusada ficticia',$web),'timeout'),
  @([Net.Http.HttpRequestException]::new('conexao recusada ficticia'),'falha-conexao'),
  @([Exception]::new('timeout e recusa ficticios'),'erro-cliente')
 )
 foreach($caso in $casosErro){if((Classificar-ErroHealth $caso[0])-ne$caso[1]){throw "Classificacao por tipo/codigo falhou: $($caso[1])"}}
 Write-Host 'OK health: excecoes aninhadas, codigos Windows e mensagens independentes do idioma'
 $recusou=$false;try{Consultar-HealthLocal $cliente 'http://portal.example.com/api/health'|Out-Null}catch{$recusou=$true}
 if(!$recusou){throw 'Health nao local foi aceito.'}
 # Executa os blocos REAIS de contagem/notificacao do supervisor.
 $s=Get-Content (Join-Path $PSScriptRoot 'supervisor.ps1') -Raw -Encoding UTF8
 $inicioContador=$s.IndexOf('  if($saudavel){$falhasSaude=0')
 $fimContador=$s.IndexOf('  # Reinicia apenas', $inicioContador)
 $contador=$s.Substring($inicioContador,$fimContador-$inicioContador)
 $inicio=$s.IndexOf('  if($saudavel-and!$portalPronto)');$fim=$s.IndexOf('  if($alerta-and', $inicio)
 if(!$contador-or$inicio-lt0-or$fim-lt0){throw 'Blocos de saude nao encontrados.'}
 $bloco=[scriptblock]::Create($contador+"`n"+$s.Substring($inicio,$fim-$inicio))
 $inicioPartidaPortal=Get-Date;$portalJaPronto=$true;$aguardandoPortal=$false
 $falhasSaude=0;$portalPronto=$true;$PortalUrl='http://portal.example.com';$avisosAdmin=@{};$script:avisos=0;$script:logs=@()
 function Log {param($m);$script:logs+= $m}
 function Notificar {return $false}
 function Avisar-Administrador {$script:avisos++}
 foreach($v in @($false,$true,$false,$false)){$saudavel=$v;$resultadoHealth=@{motivo='timeout';duracaoMs=200;http=0};. $bloco}
 if($falhasSaude-ne2-or$portalPronto-or$script:avisos-ne1){throw 'Duas falhas seguidas nao acionaram o aviso unico.'}
 if(@($script:logs|Where-Object {$_-like'Health falhou:*'}).Count-ne3){throw 'Nem toda falha foi registrada.'}
 # Partida: conta todas as falhas para preservar o reinicio; uma unica linha.
 $portalPronto=$false;$portalJaPronto=$false;$aguardandoPortal=$false;$falhasSaude=0;$script:logs=@();$script:avisos=0
 foreach($v in @($false,$false,$false)){$saudavel=$v;. $bloco}
 if($falhasSaude-ne3-or$script:logs.Count-ne1-or$script:logs[0]-cne'aguardando o Portal subir'-or$script:avisos){throw 'Partida gerou ruido/aviso ou perdeu contagem.'}
 $inicioPartidaPortal=(Get-Date).AddMinutes(-3);$saudavel=$false;. $bloco
 if($script:logs[-1]-notlike'Health falhou:*'-or$falhasSaude-ne4){throw 'Estouro da janela nao registrou erro.'}
 $saudavel=$true;. $bloco
 if(!$portalPronto-or!$portalJaPronto){throw 'Primeiro health nao marcou prontidao.'}
 $inicioPartidaPortal=Get-Date
 foreach($v in @($false,$false,$false)){$saudavel=$v;. $bloco}
 if(@($script:logs|Where-Object {$_-like'Health falhou:*'}).Count-ne4-or$script:avisos-ne1){throw 'Queda depois de pronto foi silenciada ou aviso mudou.'}
 # Nova partida real reinicia apenas a guarda de log, sem alterar cooldown.
 $ast=[Management.Automation.Language.Parser]::ParseInput($s,[ref]$null,[ref]$null)
 $iniciar=$ast.Find({param($n) $n-is[Management.Automation.Language.FunctionDefinitionAst]-and$n.Name-eq'Iniciar-Processo'},$true).Extent.Text
 . ([scriptblock]::Create($iniciar))
 function Start-Process {return [pscustomobject]@{Id=123;HasExited=$false}}
 $processos=@{};$Operacao=$pasta;$inicioPortal=(Get-Date).AddMinutes(-5);$ultimoReinicio=$inicioPortal
 Iniciar-Processo 'portal' 'ficticio' @() $pasta
 if($portalJaPronto-or$aguardandoPortal-or$inicioPortal-ne$ultimoReinicio){throw 'Partida nao reiniciou guarda ou mudou cooldown.'}
 $script:logs=@();$saudavel=$false;. $bloco
 if($script:logs[0]-cne'aguardando o Portal subir'){throw 'Nova partida nao recebeu janela silenciosa.'}
 Remove-Item Function:Start-Process
 # A espera real do supervisor deixa a parada interromper a primeira fatia.
 $inicioEspera=$s.IndexOf('  for($i=0;$i-lt15-and!(Test-Path $PararFile);$i++)')
 $fimEspera=$s.IndexOf("`n }",$inicioEspera)
 $espera=[scriptblock]::Create($s.Substring($inicioEspera,$fimEspera-$inicioEspera))
 $PararFile=Join-Path $pasta 'parar.sinal';$script:fatias=0;$script:pulsos=0
 function Start-Sleep {param($Milliseconds);if($Milliseconds-ne100){throw 'Fatia de parada inesperada.'};$script:fatias++;[IO.File]::WriteAllText($PararFile,'fixture')}
 function Atualizar-AvisosAdmin {$script:pulsos++}
 . $espera
 if($script:fatias-ne1-or$script:pulsos-ne1){throw 'Parada nao interrompeu espera do supervisor.'}
 Remove-Item $PararFile,Function:Start-Sleep,Function:Atualizar-AvisosAdmin
 Write-Host 'OK health: partida silenciosa unica, prazo, nova partida, queda e parada em 100 ms'
 # Timer de HttpClient que nao conclui/cancela nao pode prender o supervisor.
 $pendente=New-Object 'System.Threading.Tasks.TaskCompletionSource[System.Net.Http.HttpResponseMessage]'
 $falso=New-Object PSObject -Property @{pedido=$pendente.Task;cancelou=$false}
 $falso|Add-Member ScriptMethod GetAsync {param($Endereco);return $this.pedido}
 $falso|Add-Member ScriptMethod CancelPendingRequests {$this.cancelou=$true}
 $r=Consultar-HealthLocal @{cliente=$falso;prazoMs=100}
 if($r.motivo-ne'timeout'-or!$falso.cancelou-or$r.duracaoMs-gt1500){throw 'Espera ignorou prazo quando cancelamento do HttpClient atrasou.'}
 Write-Host 'OK health: espera limitada mesmo com timer/cancelamento pendente'
 # Executa os consumidores reais do health sem tarefa, SMTP ou conta reais.
 & {
  . (Join-Path $PSScriptRoot 'inicializacao-logica.ps1')
  . (Join-Path $PSScriptRoot 'avisos-admin.ps1')
  function Obter-TarefaSupplyVision {return $null}
  function Localizar-NodeMaquina {return 'node-ficticio'}
  function Log {param($Texto);throw $Texto}
  function Obter-EventoVigilancia {param($FalhaTarefa,$Saudavel);$script:saudeVigilancia=$Saudavel;return ''}
  $privado=Join-Path $pasta 'vigilancia';$raiz=$pasta
  foreach($dir in @('comum','portal/configuracao')){[void][IO.Directory]::CreateDirectory((Join-Path $privado $dir))}
  Set-Content (Join-Path $privado 'comum/operacao.env') "ADMIN_ALERTA_EMAIL=admin@example.com`nMODO_ENSAIO=1"
  $configPortal=Join-Path $privado 'portal/configuracao/portal.env'
  $astVigilancia=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'vigiar-operacao.ps1'),[ref]$null,[ref]$null)
  $blocoVigilancia=$astVigilancia.Find({param($n) $n-is[Management.Automation.Language.TryStatementAst]-and$n.Extent.Text.Contains('Obter-EventoVigilancia')},$true)
  if(!$blocoVigilancia){throw 'Bloco real de vigilancia nao encontrado.'}
  foreach($portaTeste in @($porta,0)){
   Set-Content $configPortal ("PORTAL_PORTA="+$portaTeste)
   $controle=$null;$clienteHealth=$null;$script:saudeVigilancia=$null
   . ([scriptblock]::Create($blocoVigilancia.Extent.Text))
   if($script:saudeVigilancia-ne($portaTeste-eq$porta)){throw 'Vigilancia ignorou porta configurada ou aprovou porta invalida.'}
   if($clienteHealth){
    $descartado=$false;try{[void]$clienteHealth.cliente.GetAsync("http://127.0.0.1:$porta/api/health")}catch{$descartado=$true}
    if(!$descartado){throw 'Vigilancia deixou cliente HTTP aberto.'}
   }
  }
  $astHomologacao=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'homologar.ps1'),[ref]$null,[ref]$null)
  $itemLocal=$astHomologacao.Find({param($n) $n-is[Management.Automation.Language.CommandAst]-and$n.GetCommandName()-eq'Item-Homologacao'-and$n.CommandElements[1].Value-eq'Health local'},$true)
  if(!$itemLocal){throw 'Item real de health local nao encontrado.'}
  function Item-Homologacao {param($Nome,$Conferir);& $Conferir}
  $cfg=@{PORTAL_PORTA=$porta}
  if((& ([scriptblock]::Create($itemLocal.Extent.Text)))-ne'respondendo'){throw 'Homologacao ignorou porta local configurada.'}
  $cfg=@{PORTAL_PORTA=0};$recusou=$false
  try{& ([scriptblock]::Create($itemLocal.Extent.Text))|Out-Null}catch{$recusou=$true}
  if(!$recusou){throw 'Homologacao aprovou porta invalida.'}
 }
 Write-Host 'OK health: vigilancia e homologacao usam porta configurada; porta invalida recusada e cliente descartado'
 Write-Host 'PASSOU: proxy, prazo total, HTTP, corpo, conexao, sigilo e duas falhas consecutivas.'
}finally{
 [Net.WebRequest]::DefaultWebProxy=$proxyAntigo
 if($cliente){$cliente.cliente.Dispose()}
 if($clienteRecusa){$clienteRecusa.cliente.Dispose()}
 if($proc){Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue;[void]$proc.WaitForExit(5000);$proc.Dispose()}
 Remove-Item -LiteralPath $pasta -Recurse -Force -ErrorAction SilentlyContinue
}
