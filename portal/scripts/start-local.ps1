$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$portalUrl = 'http://localhost:3000/'
$healthUrl = 'http://localhost:3000/api/health'
$pidFile = Join-Path $projectDirectory '.portal.pid'

function Test-Portal {
  try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
    return $health.app -eq 'portal-suprimentos' -and $health.status -eq 'ok'
  } catch { return $false }
}

if (Test-Portal) { & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'iniciar-email.ps1') 2>&1 | Out-Null; Start-Process $portalUrl; exit 0 }

$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npm) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show('O Node.js não foi encontrado neste computador.', 'Portal Suprimentos') | Out-Null
  exit 1
}

if (-not (Test-Path -LiteralPath (Join-Path $projectDirectory 'dist\server\wrangler.json'))) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show('Execute Atualizar Portal.cmd para preparar uma versão verificada.', 'Portal Suprimentos') | Out-Null
  exit 1
}

$process = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','npm run start:local' -WorkingDirectory $projectDirectory -WindowStyle Hidden -PassThru
@{ ProcessId = $process.Id; StartedAtUtc = $process.StartTime.ToUniversalTime().ToString('o'); Mode = 'local' } |
  ConvertTo-Json | Set-Content -LiteralPath $pidFile -Encoding utf8NoBOM

for ($attempt = 0; $attempt -lt 90; $attempt++) {
  Start-Sleep -Milliseconds 700
  if (Test-Portal) { & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'iniciar-email.ps1') 2>&1 | Out-Null; Start-Process $portalUrl; exit 0 }
}

& taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null
if (Test-Path -LiteralPath $pidFile) { Remove-Item -LiteralPath $pidFile -Force }
Add-Type -AssemblyName PresentationFramework
[System.Windows.MessageBox]::Show('O portal não iniciou no tempo esperado.', 'Portal Suprimentos') | Out-Null
exit 1
