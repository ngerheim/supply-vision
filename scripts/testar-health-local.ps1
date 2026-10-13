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
 $proc=Start-Process (Get-Command node).Source -ArgumentList @(('"'+$servidor+'"'),('"'+$portaArquivo+'"')) -PassThru
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
 $contador=[regex]::Match($s,'(?m)^  if\(\$saudavel\)\{\$falhasSaude=0\}.*$').Value
 $inicio=$s.IndexOf('  if($saudavel-and!$portalPronto)');$fim=$s.IndexOf('  if($alerta-and', $inicio)
 if(!$contador-or$inicio-lt0-or$fim-lt0){throw 'Blocos de saude nao encontrados.'}
 $bloco=[scriptblock]::Create($contador+"`n"+$s.Substring($inicio,$fim-$inicio))
 $falhasSaude=0;$portalPronto=$true;$PortalUrl='http://portal.example.com';$avisosAdmin=@{};$script:avisos=0;$script:logs=@()
 function Log {param($m);$script:logs+= $m}
 function Notificar {return $false}
 function Avisar-Administrador {$script:avisos++}
 foreach($v in @($false,$true,$false,$false)){$saudavel=$v;$resultadoHealth=@{motivo='timeout';duracaoMs=200;http=0};. $bloco}
 if($falhasSaude-ne2-or$portalPronto-or$script:avisos-ne1){throw 'Duas falhas seguidas nao acionaram o aviso unico.'}
 if(@($script:logs|Where-Object {$_-like'Health falhou:*'}).Count-ne3){throw 'Nem toda falha foi registrada.'}
 Write-Host 'PASSOU: proxy, prazo total, HTTP, corpo, conexao, sigilo e duas falhas consecutivas.'
}finally{
 [Net.WebRequest]::DefaultWebProxy=$proxyAntigo
 if($cliente){$cliente.cliente.Dispose()}
 if($clienteRecusa){$clienteRecusa.cliente.Dispose()}
 if($proc){Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue;[void]$proc.WaitForExit(5000);$proc.Dispose()}
 Remove-Item -LiteralPath $pasta -Recurse -Force -ErrorAction SilentlyContinue
}
