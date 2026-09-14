$ErrorActionPreference = 'Stop'
$projeto = Split-Path -Parent $PSScriptRoot
$registro = Join-Path $projeto '.portal-email.pid'
if (-not (Test-Path -LiteralPath $registro)) { exit 0 }
try {
  $r = Get-Content -LiteralPath $registro -Raw | ConvertFrom-Json
  $p = Get-Process -Id ([int]$r.ProcessId) -ErrorAction SilentlyContinue
  if ($p) {
    $inicio = [DateTime]::Parse($r.StartedAtUtc).ToUniversalTime()
    $nodeEsperado = if ($r.NodePath) { [string]$r.NodePath } else { (Get-Command node.exe -ErrorAction Stop).Source }
    if ([Math]::Abs(($p.StartTime.ToUniversalTime() - $inicio).TotalSeconds) -le 2 -and $p.Path -eq $nodeEsperado) {
      Stop-Process -Id $p.Id -Force
    }
  }
} finally { Remove-Item -LiteralPath $registro -Force -ErrorAction SilentlyContinue }
