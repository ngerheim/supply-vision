# Prepara e testa em outra pasta; guarda o build anterior para retorno.
param([switch]$PrepararSomente)
$ErrorActionPreference = 'Stop'
$projeto = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$trabalho = Join-Path $projeto ('work\versao-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
$candidato = Join-Path $trabalho 'fonte'
$anterior = Join-Path $trabalho 'anterior'
$atual = Join-Path $projeto 'dist'
$pausa = Join-Path $projeto '.portal-pausado'
$registro = Join-Path $projeto '.portal.pid'
$mutex = New-Object Threading.Mutex($false, 'Local\PortalSuprimentosAtualizacao')
if (-not $mutex.WaitOne(0)) { throw 'Outra atualizacao esta em andamento.' }

function Saude {
  & node (Join-Path $projeto 'scripts\saude-completa.mjs') 2>&1 | Out-Host
  return $LASTEXITCODE -eq 0
}
function Parar {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projeto 'scripts\parar-email.ps1') 2>&1 | Out-Null
  $conexao = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $conexao) { return }
  $r = Get-Content -LiteralPath $registro -Raw | ConvertFrom-Json
  $p = Get-Process -Id $conexao.OwningProcess
  $raizProjeto = $projeto.TrimEnd('\') + '\'
  $registroConfere = $p.Id -eq [int]$r.ProcessId -and
    [Math]::Abs(($p.StartTime.ToUniversalTime()-[DateTime]::Parse($r.StartedAtUtc).ToUniversalTime()).TotalSeconds) -lt 1
  # O Wrangler pode reiniciar apenas o workerd e mudar o PID que atende a
  # porta. Nesse caso, a identidade ainda pode ser provada pelo executavel sob
  # node_modules deste projeto e por um pai Wrangler apontando para este checkout.
  $processoDoProjeto = $p.Path -and $p.Path.StartsWith($raizProjeto,[StringComparison]::OrdinalIgnoreCase)
  $sonda = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.Id)"
  $cadeiaWrangler = $false
  for ($i=0; $i -lt 5 -and $sonda; $i++) {
    if ($sonda.CommandLine -and $sonda.CommandLine.IndexOf($projeto,[StringComparison]::OrdinalIgnoreCase) -ge 0 -and $sonda.CommandLine -match 'wrangler' -and $sonda.CommandLine -match '(--port\s+3000|0\.0\.0\.0:3000)') { $cadeiaWrangler=$true; break }
    $sonda = Get-CimInstance Win32_Process -Filter "ProcessId=$($sonda.ParentProcessId)"
  }
  if (-not $processoDoProjeto -or (-not $registroConfere -and -not $cadeiaWrangler)) {
    throw 'Processo da porta nao corresponde ao registro seguro. Nada foi encerrado.'
  }
  # Inclui os pais Wrangler deste checkout, evitando deixar supervisores
  # presos ao build antigo. Para ao chegar a um processo sem identidade local.
  $alvo = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.Id)"
  for ($i=0; $i -lt 5; $i++) {
    $pai = Get-CimInstance Win32_Process -Filter "ProcessId=$($alvo.ParentProcessId)"
    if (-not $pai -or $pai.CommandLine -notlike "*$projeto*wrangler*") { break }
    $alvo = $pai
  }
  & taskkill.exe /PID $alvo.ProcessId /T /F | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel encerrar o servidor.' }
  Start-Sleep -Seconds 2
}
function Iniciar {
  # O Wrangler guarda em .wrangler/deploy o manifesto dos arquivos estaticos.
  # Depois de trocar dist, reutilizar esse cache mistura o servidor novo com
  # CSS/JS da versao anterior. Preserva o cache para diagnostico e obriga sua
  # recriacao; o estado D1, que fica em .wrangler/state, nao e tocado.
  $cacheDeploy = Join-Path $projeto '.wrangler\deploy'
  if (Test-Path -LiteralPath $cacheDeploy) {
    $cachePreservado = Join-Path $trabalho ('wrangler-deploy-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
    Move-Item -LiteralPath $cacheDeploy -Destination $cachePreservado
  }
  $p = Start-Process cmd.exe -ArgumentList '/c','npm run start:lan' -WorkingDirectory $projeto -WindowStyle Hidden -PassThru
  $sucesso = $false
  try {
  for ($i=0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    try { $h = Invoke-RestMethod http://127.0.0.1:3000/api/health -TimeoutSec 2 } catch { continue }
      if ($h.app -eq 'portal-suprimentos' -and $h.status -eq 'ok') {
        $c = Get-NetTCPConnection -LocalPort 3000 -State Listen | Select-Object -First 1
        $dono = Get-Process -Id $c.OwningProcess
        @{ProcessId=$dono.Id;StartedAtUtc=$dono.StartTime.ToUniversalTime().ToString('o');Mode='lan'} | ConvertTo-Json -Compress | Set-Content -LiteralPath $registro
        if (Saude) {
          & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projeto 'scripts\iniciar-email.ps1') 2>&1 | Out-Null
          $sucesso = $true; return
        }
        throw 'A pagina completa nao passou na verificacao.'
      }
  }
  throw 'Servidor nao iniciou no prazo.'
  } finally {
    if (-not $sucesso -and -not $p.HasExited) { & taskkill.exe /PID $p.Id /T /F | Out-Null; Start-Sleep -Seconds 2 }
  }
}

try {
  New-Item -ItemType Directory -Path $candidato -Force | Out-Null
  Write-Host "Preparando em $candidato. O portal atual permanece no ar."
  $arquivos = & git -C $projeto ls-files --cached --others --exclude-standard
  if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel enumerar o codigo.' }
  foreach ($f in $arquivos) {
    if ($f -match '(^|/)(\.git|\.wrangler|node_modules|dist|work|dados-origem)(/|$)' -or $f -match '\.sqlite' -or $f -match '(^|/)\.env') { continue }
    $origem = Join-Path $projeto $f
    if (-not (Test-Path -LiteralPath $origem -PathType Leaf)) { continue }
    $destino = [IO.Path]::GetFullPath((Join-Path $candidato $f))
    if (-not $destino.StartsWith($candidato+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Caminho de codigo fora do candidato.' }
    New-Item -ItemType Directory -Path (Split-Path -Parent $destino) -Force | Out-Null
    Copy-Item -LiteralPath $origem -Destination $destino
  }
  New-Item -ItemType Junction -Path (Join-Path $candidato 'node_modules') -Target (Join-Path $projeto 'node_modules') | Out-Null
  Push-Location $candidato
  try {
    $env:NODE_ENV = 'development'
    foreach ($check in @('lint','typecheck','test')) {
      & npm.cmd run $check
      if ($LASTEXITCODE -ne 0) { throw "Verificacao $check falhou; versao atual preservada." }
    }
    # Invocacao direta e restrita a copia: vinext sempre limpa cwd/dist.
    & node (Join-Path $projeto 'node_modules\vinext\dist\cli.js') build
    if ($LASTEXITCODE -ne 0) { throw 'Build candidato falhou; versao em uso preservada.' }
    $relatorio = Join-Path $trabalho 'resultado-testes.json'
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $candidato 'scripts\teste-instalacao-nova.ps1') -UsarBuildExistente -Relatorio $relatorio
    if ($LASTEXITCODE -ne 0) { throw 'Testes candidatos falharam; versao em uso preservada.' }
    $resultado = Get-Content -LiteralPath $relatorio -Raw | ConvertFrom-Json
    if ($resultado.sucesso -ne $true -or $resultado.verificacoes -lt 31) { throw 'Relatorio final incompleto; atualizacao cancelada.' }
  } finally { Pop-Location }
  if ($PrepararSomente) { Write-Host "Candidato aprovado: $candidato"; return }
  $pausadoAntes = Test-Path -LiteralPath $pausa
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projeto 'scripts\teste-retorno.ps1')
  if ($LASTEXITCODE -ne 0) { throw 'Teste de retorno falhou; versao atual preservada.' }
  New-Item -ItemType File -Path $pausa -Force | Out-Null
  $trocou = $false
  try {
    Parar
    $rastreamentos = Join-Path $projeto '.wrangler\state\v3\observability'
    if (Test-Path -LiteralPath $rastreamentos) { Remove-Item -LiteralPath $rastreamentos -Recurse -Force }
    # Todos os destinos sao explicitos e ficam sob work deste checkout.
    if (Test-Path -LiteralPath $atual) { Move-Item -LiteralPath $atual -Destination $anterior }
    $trocou = $true
    Move-Item -LiteralPath (Join-Path $candidato 'dist') -Destination $atual
    Iniciar
    # Depois da aprovacao, conserva somente o build imediatamente anterior.
    # A copia do codigo candidato, caches e versoes mais antigas sao
    # recriaveis e apenas inchavam a pasta a cada atualizacao.
    if (Test-Path -LiteralPath $candidato) { Remove-Item -LiteralPath $candidato -Recurse -Force }
    Get-ChildItem -LiteralPath $trabalho -Directory -Filter 'wrangler-deploy-*' -ErrorAction SilentlyContinue |
      Remove-Item -Recurse -Force
    Remove-Item -LiteralPath (Join-Path $trabalho 'resultado-testes.json') -Force -ErrorAction SilentlyContinue
    $raizWork = [IO.Path]::GetFullPath((Join-Path $projeto 'work')).TrimEnd('\') + '\'
    Get-ChildItem -LiteralPath (Join-Path $projeto 'work') -Directory | Where-Object {
      $_.FullName -ne $trabalho -and $_.FullName.StartsWith($raizWork,[StringComparison]::OrdinalIgnoreCase)
    } | Remove-Item -Recurse -Force
    Write-Host "Atualizacao aprovada. Build anterior preservado em $anterior"
  } catch {
    $falha = $_
    if ($trocou -and (Test-Path -LiteralPath $anterior)) {
      Parar
      if (Test-Path -LiteralPath $atual) { Move-Item -LiteralPath $atual -Destination (Join-Path $trabalho 'reprovado') }
      Move-Item -LiteralPath $anterior -Destination $atual
      Iniciar
      Write-Host 'Versao anterior restaurada.'
    } elseif (-not (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath $atual)) {
      Iniciar
    }
    throw $falha
  } finally {
    if (-not $pausadoAntes) { Remove-Item -LiteralPath $pausa -Force -ErrorAction SilentlyContinue }
  }
} finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
