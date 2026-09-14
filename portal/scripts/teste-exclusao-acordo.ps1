# Testa a exclusao de acordo numa instancia DESCARTAVEL, sem tocar na base
# real. Cria um acordo com condicao e um chamado ligado a ele, confere que a
# exclusao apaga o acordo mas PRESERVA o chamado (so perde o vinculo).
param([switch]$Manter)

$projeto = Split-Path -Parent $PSScriptRoot
$porta = 3195
$baseUrl = "http://127.0.0.1:$porta"
$senha = 'senha-de-ensaio-1234567'
$temp = Join-Path $env:TEMP "excl-$(Get-Random)"
$script:servidor = $null
$script:ok = 0
$script:falhou = 0

function Verifica($nome, [scriptblock]$teste) {
  try {
    $r = & $teste
    if ($r -eq $true) { $script:ok++; Write-Host "  [OK]    $nome" -ForegroundColor Green }
    else { $script:falhou++; Write-Host "  [FALHA] $nome  ->  $r" -ForegroundColor Red }
  } catch {
    $script:falhou++
    Write-Host "  [FALHA] $nome  ->  EXCECAO: $($_.Exception.Message)" -ForegroundColor Red
  }
}

function Codigo([scriptblock]$c) {
  try { return (& $c).StatusCode }
  catch {
    $e = $_.Exception
    if ($e.Response) { return [int]$e.Response.StatusCode.value__ }
    return "SEM RESPOSTA [$($e.GetType().Name)] $($e.Message)"
  }
}

function Encerrar {
  if ($script:servidor) { & taskkill.exe /PID $script:servidor /T /F 2>$null | Out-Null }
  Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='workerd.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*$temp*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
  if (-not $Manter) { Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue }
}

if (Get-NetTCPConnection -LocalPort $porta -State Listen -ErrorAction SilentlyContinue) {
  Write-Host "  A porta $porta esta ocupada." -ForegroundColor Red
  exit 2
}

$env:NODE_ENV = 'development'
Set-Location $projeto
New-Item -ItemType Directory -Force -Path $temp | Out-Null

try {
  if (-not (Test-Path -LiteralPath "$projeto\dist\server\wrangler.json")) {
    Write-Host '  Compilando (build nao encontrado)...' -ForegroundColor DarkGray
    npm run build *> (Join-Path $temp 'build.log')
    if ($LASTEXITCODE -ne 0) { Write-Host '  Build falhou.' -ForegroundColor Red; Get-Content (Join-Path $temp 'build.log') | Select-Object -Last 15; exit 1 }
  }

  $log = Join-Path $temp 'servidor.log'
  $cmd = "Set-Location '$projeto'; npx wrangler dev --config dist/server/wrangler.json " +
    "--persist-to '$temp' --var INITIAL_ADMIN_PASSWORD:'$senha' --ip 127.0.0.1 --port $porta *> '$log'"
  $script:servidor = (Start-Process powershell.exe -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-Command',$cmd -WindowStyle Hidden -PassThru).Id

  $subiu = $false
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 2
    try { if ((Invoke-WebRequest "$baseUrl/api/health" -UseBasicParsing -TimeoutSec 4).StatusCode -eq 200) { $subiu = $true; break } } catch { }
  }
  if (-not $subiu) {
    Write-Host '  Instancia de ensaio nao subiu.' -ForegroundColor Red
    Get-Content -LiteralPath $log -ErrorAction SilentlyContinue | Select-Object -Last 15
    exit 1
  }

  Write-Host ''
  Write-Host '  EXCLUSAO DE ACORDO' -ForegroundColor Cyan
  Write-Host '  ------------------'

  $adminCorpo = @{ email = 'admin@portal.local'; password = $senha } | ConvertTo-Json
  Invoke-WebRequest "$baseUrl/api/login" -Method POST -Body $adminCorpo -ContentType 'application/json' -SessionVariable adm -UseBasicParsing -TimeoutSec 60 | Out-Null

  function Novo($rota, $corpo) {
    try {
      $r = Invoke-WebRequest "$baseUrl/api/$rota" -Method POST -Body $corpo -ContentType 'application/json' -WebSession $adm -UseBasicParsing -TimeoutSec 60
      return $r.Content | ConvertFrom-Json
    } catch {
      throw "POST $rota falhou: HTTP $($_.Exception.Response.StatusCode.value__) - $($_.ErrorDetails.Message)"
    }
  }

  $forn = Novo 'catalogs/suppliers' '{"tradeName":"FORNECEDOR EXCLUSAO","cnpj":"11222333000181","city":"GOIANIA","state":"GO"}'
  $loc  = Novo 'catalogs/locations' '{"city":"GOIANIA","state":"GO"}'
  $item = Novo 'catalogs/items' '{"name":"PECA DE TESTE"}'
  $mod  = Novo 'catalogs/models' '{"name":"MODELO DE TESTE"}'
  $uni  = Novo 'catalogs/units' '{"code":"UN","name":"Unidade"}'
  $ac   = Novo 'agreements' (@{ number = 'ACORDO-EXCLUSAO'; supplierId = $forn.id; startDate = '2026-01-01'; locationIds = @($loc.id); status = 'active' } | ConvertTo-Json)
  Novo "agreements/$($ac.id)/items" (@{ catalogItemId = $item.id; locationId = $loc.id; unitId = $uni.id; modelIds = @($mod.id); price = 100 } | ConvertTo-Json) | Out-Null
  $ch   = Novo 'tickets' (@{ supplierName = 'CHAMADO LIGADO AO ACORDO'; agreementId = $ac.id } | ConvertTo-Json)

  Verifica 'Cenario montado: acordo com condicao e chamado ligado' {
    $d = (Invoke-WebRequest "$baseUrl/api/agreements/$($ac.id)" -WebSession $adm -UseBasicParsing -TimeoutSec 60).Content | ConvertFrom-Json
    if ($d.items.Count -ge 1) { $true } else { 'o acordo ficou sem condicoes' }
  }

  Invoke-WebRequest "$baseUrl/api/users" -Method POST -WebSession $adm -ContentType 'application/json' -UseBasicParsing -TimeoutSec 60 `
    -Body '{"name":"Comprador Teste","email":"comprador@teste.local","password":"senha-comprador-123","role":"editor"}' | Out-Null
  Invoke-WebRequest "$baseUrl/api/login" -Method POST -ContentType 'application/json' -SessionVariable comp -UseBasicParsing -TimeoutSec 60 `
    -Body '{"email":"comprador@teste.local","password":"senha-comprador-123"}' | Out-Null

  Verifica 'Comprador nao consegue excluir acordo' {
    $c = Codigo { Invoke-WebRequest "$baseUrl/api/agreements/$($ac.id)" -Method DELETE -WebSession $comp -UseBasicParsing -TimeoutSec 60 }
    if ($c -eq 403) { $true } else { "esperado 403, veio $c" }
  }

  Verifica 'Acordo continua existindo apos a tentativa negada' {
    $c = Codigo { Invoke-WebRequest "$baseUrl/api/agreements/$($ac.id)" -WebSession $adm -UseBasicParsing -TimeoutSec 60 }
    if ($c -eq 200) { $true } else { "o acordo sumiu: $c" }
  }

  Verifica 'Administrador exclui o acordo' {
    $r = Invoke-WebRequest "$baseUrl/api/agreements/$($ac.id)" -Method DELETE -WebSession $adm -UseBasicParsing -TimeoutSec 60
    $j = $r.Content | ConvertFrom-Json
    if ($j.success -and $j.condicoes -ge 1) { $true } else { "resposta inesperada: $($r.Content)" }
  }

  Verifica 'Acordo realmente sumiu' {
    $c = Codigo { Invoke-WebRequest "$baseUrl/api/agreements/$($ac.id)" -WebSession $adm -UseBasicParsing -TimeoutSec 60 }
    if ($c -eq 404) { $true } else { "esperado 404, veio $c" }
  }

  Verifica 'Chamado foi PRESERVADO, apenas sem o vinculo' {
    $d = (Invoke-WebRequest "$baseUrl/api/tickets/$($ch.id)" -WebSession $adm -UseBasicParsing -TimeoutSec 60).Content | ConvertFrom-Json
    if (-not $d.ticket) { return 'o chamado foi apagado junto com o acordo' }
    if ($d.ticket.agreement_id) { return 'o chamado ainda aponta para o acordo excluido' }
    $true
  }

  Verifica 'Exclusao registrada na auditoria com os numeros' {
    $a = (Invoke-WebRequest "$baseUrl/api/audit?entity=agreement" -WebSession $adm -UseBasicParsing -TimeoutSec 60).Content | ConvertFrom-Json
    $reg = $a.logs | Where-Object { $_.action -eq 'DELETE' } | Select-Object -First 1
    if (-not $reg) { return 'nada na auditoria' }
    if ($reg.details -notmatch 'ACORDO-EXCLUSAO') { return "detalhe sem o numero: $($reg.details)" }
    if ($reg.details -notmatch 'condi') { return "detalhe sem a contagem: $($reg.details)" }
    $true
  }

  Verifica 'Excluir acordo inexistente devolve 404' {
    $c = Codigo { Invoke-WebRequest "$baseUrl/api/agreements/nao-existe-mesmo" -Method DELETE -WebSession $adm -UseBasicParsing -TimeoutSec 60 }
    if ($c -eq 404) { $true } else { "esperado 404, veio $c" }
  }

  Write-Host '  ------------------'
  if ($script:falhou -eq 0) {
    Write-Host "  $($script:ok) verificacoes, todas passaram." -ForegroundColor Green
    $codigoFinal = 0
  } else {
    Write-Host "  $($script:ok) passaram, $($script:falhou) FALHARAM." -ForegroundColor Red
    $codigoFinal = 1
  }
}
finally {
  Encerrar
}
exit $codigoFinal
