$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
. (Join-Path $PSScriptRoot 'espera-testes.ps1')
$pasta=Join-Path ([IO.Path]::GetTempPath()) ('sv-health-'+[guid]::NewGuid().ToString('N'))
$proc=$null;$cliente=$null;$proxyAntigo=[Net.WebRequest]::DefaultWebProxy
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
 $escuta=New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,0);$escuta.Start();$fechada=$escuta.LocalEndpoint.Port;$escuta.Stop()
 $r=Consultar-HealthLocal $cliente "http://127.0.0.1:$fechada/api/health"
 if($r.motivo-ne'conexao-recusada'){throw 'Conexao recusada nao identificada.'}
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
 if($proc){Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue;[void]$proc.WaitForExit(5000);$proc.Dispose()}
 Remove-Item -LiteralPath $pasta -Recurse -Force -ErrorAction SilentlyContinue
}
