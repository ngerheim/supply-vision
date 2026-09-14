# Carga de ensaio: importa a planilha numa instancia DESCARTAVEL e relata o
# que aconteceria na base real. Nao encosta no banco de producao.
#
# Uso: powershell -File scripts\ensaio-importacao.ps1 [caminho-da-planilha]
param([string]$Planilha = "$PSScriptRoot\..\dados-origem\ACORDOS.xlsx")

$ErrorActionPreference = 'SilentlyContinue'
$projeto = Split-Path -Parent $PSScriptRoot
$porta = 3198
$baseUrl = "http://127.0.0.1:$porta"
$senha = 'senha-de-ensaio-1234567'
$temp = Join-Path $env:TEMP "ensaio-$(Get-Random)"
$script:servidor = $null

function Encerrar {
  if ($script:servidor) { & taskkill.exe /PID $script:servidor /T /F 2>$null | Out-Null }
  Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='workerd.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*$temp*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  Start-Sleep -Seconds 2
  Remove-Item -LiteralPath $temp -Recurse -Force
}

if (-not (Test-Path -LiteralPath $Planilha)) {
  Write-Host "  Planilha nao encontrada: $Planilha" -ForegroundColor Red
  exit 1
}
if (Get-NetTCPConnection -LocalPort $porta -State Listen -ErrorAction SilentlyContinue) {
  Write-Host "  A porta $porta esta ocupada. Feche o programa ou ajuste a variavel." -ForegroundColor Red
  exit 2
}

$tamanho = [Math]::Round((Get-Item $Planilha).Length / 1KB, 1)
Write-Host ''
Write-Host '  CARGA DE ENSAIO' -ForegroundColor Cyan
Write-Host '  ---------------'
Write-Host "  planilha: $(Split-Path $Planilha -Leaf) ($tamanho KB)"
Write-Host "  banco descartavel: $temp" -ForegroundColor DarkGray
Write-Host '  O banco de producao NAO e tocado.' -ForegroundColor DarkGray
Write-Host ''

try {
  Set-Location $projeto
  $env:NODE_ENV = 'development'
  New-Item -ItemType Directory -Force -Path $temp | Out-Null

  if (-not (Test-Path -LiteralPath "$projeto\dist\server\wrangler.json")) {
    Write-Host '  Compilando...' -ForegroundColor DarkGray
    npm run build *> (Join-Path $temp 'build.log')
    if ($LASTEXITCODE -ne 0) { Write-Host '  A compilacao falhou.' -ForegroundColor Red; exit 1 }
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
  if (-not $subiu) { Write-Host '  A instancia de ensaio nao subiu.' -ForegroundColor Red; Get-Content $log | Select-Object -Last 10; exit 1 }

  $corpo = @{ email = 'admin@portal.local'; password = $senha } | ConvertTo-Json
  Invoke-WebRequest "$baseUrl/api/login" -Method POST -Body $corpo -ContentType 'application/json' `
    -SessionVariable s -UseBasicParsing -TimeoutSec 60 | Out-Null

  # Monta o multipart e envia como carga inicial.
  $lim = [System.Guid]::NewGuid().ToString(); $nl = "`r`n"
  $bytes = [System.IO.File]::ReadAllBytes($Planilha)
  $ms = New-Object System.IO.MemoryStream
  $w = { param($t) $x = [System.Text.Encoding]::UTF8.GetBytes($t); $ms.Write($x, 0, $x.Length) }
  & $w "--$lim$nl"
  & $w "Content-Disposition: form-data; name=`"file`"; filename=`"$(Split-Path $Planilha -Leaf)`"$nl"
  & $w "Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet$nl$nl"
  $ms.Write($bytes, 0, $bytes.Length)
  & $w "$nl--$lim--$nl"

  Write-Host '  Importando...' -ForegroundColor DarkGray
  $inicio = Get-Date
  try {
    $r = Invoke-WebRequest "$baseUrl/api/imports/legacy" -Method POST -Body $ms.ToArray() `
      -ContentType "multipart/form-data; boundary=$lim" -WebSession $s -UseBasicParsing -TimeoutSec 600
    $resposta = $r.Content | ConvertFrom-Json
    $codigo = $r.StatusCode
  } catch {
    $codigo = $_.Exception.Response.StatusCode.value__
    $resposta = $null
    $erroTexto = $_.ErrorDetails.Message
  }
  $duracao = [Math]::Round(((Get-Date) - $inicio).TotalSeconds, 1)
  $ms.Dispose()

  Write-Host ''
  if ($codigo -ne 200) {
    Write-Host "  IMPORTACAO RECUSADA (HTTP $codigo) em ${duracao}s" -ForegroundColor Red
    Write-Host "  $erroTexto" -ForegroundColor Yellow
    $det = (Invoke-WebRequest "$baseUrl/api/imports" -WebSession $s -UseBasicParsing -TimeoutSec 60).Content | ConvertFrom-Json
    $ultima = $det.imports | Select-Object -First 1
    if ($ultima) {
      Write-Host ''
      Write-Host "  linhas lidas: $($ultima.totalRows) | validas: $($ultima.validRows) | com erro: $($ultima.errorRows)"
      $d2 = (Invoke-WebRequest "$baseUrl/api/imports/$($ultima.id)" -WebSession $s -UseBasicParsing -TimeoutSec 60).Content | ConvertFrom-Json
      if ($d2.summary.sampleErrors) {
        Write-Host ''
        Write-Host '  PRIMEIROS ERROS (linha da planilha):' -ForegroundColor Yellow
        $d2.summary.sampleErrors | Select-Object -First 15 | ForEach-Object { Write-Host "    linha $($_.row): $($_.error)" }
      }
    }
    exit 1
  }

  Write-Host "  IMPORTACAO ACEITA em ${duracao}s" -ForegroundColor Green
  Write-Host ''
  Write-Host '  O que seria criado na base real:' -ForegroundColor Cyan
  $sum = $resposta.summary
  Write-Host "    acordos ............ $($sum.agreements)"
  Write-Host "    condicoes .......... $($sum.items)"
  Write-Host "    fornecedores ....... $($sum.suppliers)"
  Write-Host "    localidades ........ $($sum.locations)"
  Write-Host "    duplicatas resolvidas $($sum.duplicateKeysResolved)  (ficou o MENOR preco)"
}
finally { Encerrar }
