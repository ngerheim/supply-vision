$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
$pasta=Join-Path ([IO.Path]::GetTempPath()) ('sv-parada-'+[guid]::NewGuid().ToString('N'))
try {
  New-Item -ItemType Directory -Force (Join-Path $pasta 'operacao') | Out-Null
  if (!(Testar-SupervisorEncerrado $pasta)) { throw 'Pasta sem supervisor deveria estar liberada.' }
  $arquivo=Join-Path $pasta 'operacao/supervisor.lock'
  $trava=[IO.File]::Open($arquivo,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
  try {
    if (Testar-SupervisorEncerrado $pasta) { throw 'Porta livre nao pode liberar supervisor com trava ativa.' }
  } finally { $trava.Dispose() }
  if (!(Testar-SupervisorEncerrado $pasta)) { throw 'Trava encerrada deveria permitir atualizacao.' }
  Write-Host 'OK: parada aguarda supervisor mesmo depois de liberar a porta.'
} finally {
  if (Test-Path -LiteralPath $pasta) { Remove-Item -LiteralPath $pasta -Recurse -Force }
}
