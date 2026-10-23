# Integracao real do launcher em PS5.1, com porta e banco descartaveis.
$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
. (Join-Path $raiz 'portal/scripts/portal-ensaio.ps1')
$tempDemo = Join-Path ([IO.Path]::GetTempPath()) ('sv-demo-launcher-'+[guid]::NewGuid().ToString('N'))
$processo = $null; $inicio = $null; $script:passaram = 0
function Exigir-Demo([bool]$Ok,[string]$Nome) { if (!$Ok) { throw "Falhou: $Nome" }; $script:passaram++; Write-Host "OK: $Nome" }
function Recusar-Demo([string]$Destino,[switch]$Recriar) {
  $argsDemo = @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'demonstracao.ps1'),'-Pasta',$Destino)
  if ($Recriar) { $argsDemo += '-Recriar' }
  $r = Executar-NativoOperacao 'powershell.exe' $argsDemo
  Exigir-Demo ($r.codigo -ne 0) "recusa $Destino recriar=$Recriar"
}
function Subir-Demo([switch]$Recriar) {
  $script:portaDemo = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Parse('127.0.0.1'),0)
  $script:portaDemo.Start(); $script:porta = $script:portaDemo.LocalEndpoint.Port; $script:portaDemo.Stop()
  $pronto = Join-Path $pastaDemo 'pronto.json'
  if (Test-Path -LiteralPath $pronto) { Remove-Item -LiteralPath $pronto }
  $sinal = Join-Path $pastaDemo 'operacao/parar.sinal'
  if (Test-Path -LiteralPath $sinal) { Remove-Item -LiteralPath $sinal }
  $argsDemo = '-NoProfile -ExecutionPolicy Bypass -File "'+(Join-Path $PSScriptRoot 'demonstracao.ps1')+'" -Porta '+$script:porta+' -Pasta "'+$pastaDemo+'"'
  if ($Recriar) { $argsDemo += ' -Recriar' }
  $script:processo = Start-Process powershell.exe -ArgumentList $argsDemo -WindowStyle Hidden -RedirectStandardOutput (Join-Path $tempDemo 'launcher.log') -RedirectStandardError (Join-Path $tempDemo 'launcher.erro') -PassThru
  [void]$script:processo.Handle
  $script:inicio = $script:processo.StartTime.ToUniversalTime()
  $relogio = [Diagnostics.Stopwatch]::StartNew()
  while (!(Test-Path -LiteralPath $pronto)) {
    if ($script:processo.HasExited -or $relogio.Elapsed.TotalSeconds -gt 180) { throw ('Launcher falhou: '+(Get-Content (Join-Path $tempDemo 'launcher.erro') -Raw)) }
    Start-Sleep -Milliseconds 250
  }
  $script:baseUrl = "http://127.0.0.1:$script:porta"
}
function Parar-Demo {
  # O runtime compartilhado observa este sinal local; o launcher deve entao
  # terminar e executar seu finally, sem matar processos de outra instalacao.
  [void][IO.Directory]::CreateDirectory((Join-Path $pastaDemo 'operacao'))
  [IO.File]::WriteAllText((Join-Path $pastaDemo 'operacao/parar.sinal'),'fixture')
  Exigir-Demo ($script:processo.WaitForExit(15000)) 'launcher encerra apos parada do seu Portal'
  Exigir-Demo ($script:processo.ExitCode -eq 0) 'launcher encerra com sucesso'
  $script:processo.Dispose(); $script:processo = $null
  $conexao = New-Object Net.Sockets.TcpClient
  try { $conexao.Connect('127.0.0.1',$script:porta); throw 'Porta ainda ocupada.' } catch [Net.Sockets.SocketException] { $script:passaram++ } finally { $conexao.Dispose() }
}
try {
  [void][IO.Directory]::CreateDirectory($tempDemo)
  $pastaDemo = Join-Path $tempDemo 'demo'
  Recusar-Demo $raiz
  Recusar-Demo (Join-Path $raiz 'privado')
  $privadoAntes = $env:SUPPLY_VISION_PRIVADO
  try { $env:SUPPLY_VISION_PRIVADO=Join-Path $tempDemo 'real'; Recusar-Demo (Join-Path $env:SUPPLY_VISION_PRIVADO 'sub') } finally { $env:SUPPLY_VISION_PRIVADO=$privadoAntes }
  Recusar-Demo $pastaDemo -Recriar
  [void][IO.Directory]::CreateDirectory($pastaDemo)
  [IO.File]::WriteAllText((Join-Path $pastaDemo 'portal.sqlite'),'preservar')
  Recusar-Demo $pastaDemo
  Recusar-Demo $pastaDemo -Recriar
  Exigir-Demo ((Get-Content (Join-Path $pastaDemo 'portal.sqlite') -Raw) -eq 'preservar') 'banco alheio preservado'
  Remove-Item -LiteralPath (Join-Path $pastaDemo 'portal.sqlite')
  Subir-Demo
  Recusar-Demo $pastaDemo -Recriar
  $escutas = @(Get-NetTCPConnection -State Listen -LocalPort $script:porta)
  Exigir-Demo ($escutas.Count -eq 1 -and $escutas[0].LocalAddress -eq '127.0.0.1') 'escuta somente em 127.0.0.1'
  $credenciais = Get-Content (Join-Path $pastaDemo 'credenciais.json') -Raw | ConvertFrom-Json
  foreach ($usuario in $credenciais.usuarios) {
    $sessao = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    Invoke-WebRequest "$baseUrl/api/login" -Method POST -Body ($usuario|ConvertTo-Json) -ContentType 'application/json' -WebSession $sessao -UseBasicParsing -TimeoutSec 60 | Out-Null
    $b = (Invoke-WebRequest "$baseUrl/api/bootstrap" -WebSession $sessao -UseBasicParsing -TimeoutSec 60).Content | ConvertFrom-Json
    Exigir-Demo ($b.user.role -eq $usuario.role) "login $($usuario.role)"
    if ($usuario.role -eq 'admin') { $script:acordo = $b.agreements[0].id }
  }
  $detalhe = (Invoke-WebRequest "$baseUrl/api/agreements/$acordo" -WebSession $sessao -UseBasicParsing -TimeoutSec 60).Content | ConvertFrom-Json
  $a = $detalhe.agreement
  $edicao = @{number=$a.number;supplierId=$a.supplier_id;status=$a.status;startDate=$a.start_date;endDate=$a.end_date;locationIds=@($detalhe.locations|ForEach-Object {$_.id});notes='Edicao preservada no teste';expectedRevision=$a.revision}
  Invoke-WebRequest "$baseUrl/api/agreements/$acordo" -Method PUT -WebSession $sessao -Body ($edicao|ConvertTo-Json) -ContentType 'application/json' -UseBasicParsing -TimeoutSec 60 | Out-Null
  $pidPortal = (Get-Content (Join-Path $pastaDemo 'pronto.json') -Raw|ConvertFrom-Json).pid
  $portalCim = Get-CimInstance Win32_Process -Filter ("ProcessId="+$pidPortal)
  Exigir-Demo ($portalCim.CommandLine.Contains('demonstracao') -and $portalCim.CommandLine.Contains('servidor.mjs')) 'somente runtime de demonstracao iniciado'
  $pPortal = Get-Process -Id $pidPortal
  Encerrar-PortalEnsaio ([pscustomobject]@{Processo=$pPortal;Inicio=$pPortal.StartTime.ToUniversalTime().AddMinutes(-1);Entrada=(Join-Path $raiz 'portal/demonstracao/servidor.mjs')})
  Exigir-Demo ([bool](Get-Process -Id $pidPortal -ErrorAction SilentlyContinue)) 'PID com horario diferente preservado'
  $pPortal = Get-Process -Id $pidPortal
  Encerrar-PortalEnsaio ([pscustomobject]@{Processo=$pPortal;Inicio=$pPortal.StartTime.ToUniversalTime();Entrada='entrada-alheia.mjs'})
  Exigir-Demo ([bool](Get-Process -Id $pidPortal -ErrorAction SilentlyContinue)) 'PID com entrada diferente preservado'
  Parar-Demo
  Subir-Demo
  Invoke-WebRequest "$baseUrl/api/login" -Method POST -Body ($credenciais.inicial|ConvertTo-Json) -ContentType 'application/json' -SessionVariable sessao -UseBasicParsing -TimeoutSec 60 | Out-Null
  $detalhe = (Invoke-WebRequest "$baseUrl/api/agreements/$acordo" -WebSession $sessao -UseBasicParsing -TimeoutSec 60).Content | ConvertFrom-Json
  Exigir-Demo ($detalhe.agreement.notes -eq 'Edicao preservada no teste') 'reutiliza dados e edicoes sem recriar'
  Parar-Demo
  Subir-Demo -Recriar
  Invoke-WebRequest "$baseUrl/api/login" -Method POST -Body ($credenciais.inicial|ConvertTo-Json) -ContentType 'application/json' -SessionVariable sessao -UseBasicParsing -TimeoutSec 60 | Out-Null
  $b = (Invoke-WebRequest "$baseUrl/api/bootstrap" -WebSession $sessao -UseBasicParsing -TimeoutSec 60).Content | ConvertFrom-Json
  Exigir-Demo ($b.totalAcordos -eq 5 -and !@($b.agreements|Where-Object id -EQ $acordo).Count) 'recriar gera outra base sem alterar a quantidade esperada'
  Parar-Demo
  Write-Host "PASSOU: $script:passaram verificacoes da demonstracao."
} finally {
  if ($script:processo) {
    $p = Get-Process -Id $script:processo.Id -ErrorAction SilentlyContinue
    if ($p -and $p.StartTime.ToUniversalTime() -eq $script:inicio) { [void](Executar-NativoOperacao 'taskkill.exe' @('/PID',[string]$p.Id,'/T','/F')) }
    $script:processo.Dispose()
  }
  $absoluto = [IO.Path]::GetFullPath($tempDemo)
  if (!$absoluto.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()),[StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $absoluto) -notlike 'sv-demo-launcher-*') { throw 'Limpeza fora da fixture recusada.' }
  if (Test-Path -LiteralPath $absoluto) { Remove-Item -LiteralPath $absoluto -Recurse -Force }
}
