$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
$pasta = Join-Path ([IO.Path]::GetTempPath()) ('sv-estado-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $pasta | Out-Null
$arquivo = Join-Path $pasta 'estado.json'
try {
  if ((Ler-EstadoOperacao $arquivo).Count -ne 0) { throw 'Primeira partida deveria ter estado vazio.' }
  Gravar-EstadoOperacao $arquivo @{'alertas-2026-10-06-08:00'='ok'}
  Gravar-EstadoOperacao $arquivo @{'alertas-2026-10-06-08:00'='ok';'alertas-2026-10-06-11:00'='ok'}
  if ((Ler-EstadoOperacao $arquivo).Count -ne 2) { throw 'Perdeu conclusao de slot.' }
  if ((Ler-EstadoOperacao ($arquivo + '.anterior')).Count -ne 1) { throw 'Nao preservou estado anterior.' }
  if (@(Get-ChildItem -LiteralPath $pasta -Filter '*.tmp').Count) { throw 'Temporario sobrou.' }
  foreach ($invalido in @('{interrompido','null','[]','"texto"','')) {
    Set-Content -LiteralPath $arquivo -Value $invalido
    $recusou=$false
    try { Ler-EstadoOperacao $arquivo | Out-Null } catch { $recusou=$true }
    if (!$recusou) { throw 'Estado invalido foi convertido em agenda vazia.' }
  }
  Write-Host '[OK] Estado atomico, copia anterior e bloqueio de JSON invalido.'
} finally { Remove-Item -LiteralPath $pasta -Recurse -Force }
