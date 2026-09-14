$ErrorActionPreference = 'Stop'
$projeto = Split-Path -Parent $PSScriptRoot
$registro = Join-Path $projeto '.portal-email.pid'
$scriptEmail = Join-Path $PSScriptRoot 'processar-emails.mjs'
$node = (Get-Command node.exe -ErrorAction Stop).Source


if (Test-Path -LiteralPath $registro) {
  try {
    $r = Get-Content -LiteralPath $registro -Raw | ConvertFrom-Json
    $p = Get-Process -Id ([int]$r.ProcessId) -ErrorAction Stop
    $inicio = [DateTime]::Parse($r.StartedAtUtc).ToUniversalTime()
    # PID + instante de criacao + executavel evitam confundir um PID reciclado.
    # Consultar a linha de comando via CIM exige privilegio nesta maquina e
    # fazia cada verificacao iniciar outra copia do servico.
    if ([Math]::Abs(($p.StartTime.ToUniversalTime() - $inicio).TotalSeconds) -le 2 -and $p.Path -eq $node) { exit 0 }
  } catch {}
  Remove-Item -LiteralPath $registro -Force -ErrorAction SilentlyContinue
}

$p = Start-Process -FilePath $node -ArgumentList '--experimental-strip-types',$scriptEmail,'--watch' -WorkingDirectory $projeto -WindowStyle Hidden -PassThru
@{ProcessId=$p.Id;StartedAtUtc=$p.StartTime.ToUniversalTime().ToString('o');NodePath=$node} | ConvertTo-Json -Compress | Set-Content -LiteralPath $registro -Encoding UTF8
Start-Sleep -Milliseconds 800
if ($p.HasExited) { Remove-Item -LiteralPath $registro -Force -ErrorAction SilentlyContinue; exit 1 }
exit 0
