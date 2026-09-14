$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $projectDirectory '.portal.pid'
$healthUrl = 'http://localhost:3000/api/health'
$stopped = $false
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'parar-email.ps1') 2>&1 | Out-Null

if (Test-Path -LiteralPath $pidFile) {
  try {
    $record = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
    $process = Get-Process -Id ([int]$record.ProcessId) -ErrorAction SilentlyContinue
    if ($process -and $record.StartedAtUtc) {
      $recordedStart = [DateTime]::Parse($record.StartedAtUtc).ToUniversalTime()
      if ([Math]::Abs(($process.StartTime.ToUniversalTime() - $recordedStart).TotalSeconds) -le 5) {
        & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null
        $stopped = $true
      }
    }
  } catch {}
  Remove-Item -LiteralPath $pidFile -Force
}

Start-Sleep -Seconds 1
$stillRunning = $false
try {
  $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
  $stillRunning = $health.app -eq 'portal-suprimentos'
} catch {}

Add-Type -AssemblyName PresentationFramework
if ($stillRunning) {
  [System.Windows.MessageBox]::Show('Há outra instância do Portal Suprimentos em execução. Ela não foi encerrada porque não corresponde ao processo registrado.', 'Portal Suprimentos') | Out-Null
} elseif ($stopped) {
  [System.Windows.MessageBox]::Show('O Portal Suprimentos foi encerrado.', 'Portal Suprimentos') | Out-Null
} else {
  [System.Windows.MessageBox]::Show('O Portal Suprimentos já estava parado.', 'Portal Suprimentos') | Out-Null
}
