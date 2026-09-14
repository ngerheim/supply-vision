$ErrorActionPreference = 'Stop'
$projeto = Split-Path -Parent $PSScriptRoot
$log = Join-Path $projeto 'portal-backup.log'
$script = Join-Path $PSScriptRoot 'backup.mjs'

try {
  $saida = & node $script 2>&1
  $codigo = $LASTEXITCODE
  $saida | ForEach-Object {
    $linha = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $_"
    Write-Host "  $_"
    Add-Content -LiteralPath $log -Value $linha
  }
  if ($codigo -ne 0) { exit $codigo }
  $linhas = @(Get-Content -LiteralPath $log -ErrorAction SilentlyContinue)
  if ($linhas.Count -gt 300) { $linhas | Select-Object -Last 300 | Set-Content -LiteralPath $log }
  exit 0
} catch {
  $linha = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  ERRO: $($_.Exception.Message)"
  Write-Host "  $linha" -ForegroundColor Red
  Add-Content -LiteralPath $log -Value $linha
  exit 1
}
