# Exercita a conferencia real do atualizador com Git simulado, sem parar servicos.
$ErrorActionPreference = 'Stop'
$source = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'atualizar-servidor.ps1') -Raw
$start = $source.IndexOf("Etapa 'Conferindo o repositorio'")
$end = $source.IndexOf('$mudou = git diff')
if ($start -lt 0 -or $end -le $start) { throw 'Bloco de conferencia nao encontrado.' }
$conferencia = [scriptblock]::Create($source.Substring($start, $end - $start))
function Etapa([string]$t) {}
function Ok([string]$t) {}
function git {
  $global:LASTEXITCODE = 0
  switch ($args[0]) {
    'status' { if ($script:caso -eq 'status-falha') { $global:LASTEXITCODE = 128 }; if ($script:caso -eq 'sujo') { ' M arquivo' } }
    'branch' { if ($script:caso -eq 'branch') { 'codex/trabalho' } else { 'main' } }
    'rev-parse' {
      if (($args[-1] -eq 'HEAD' -and $script:caso -eq 'head-falha') -or ($args[-1] -eq 'origin/main' -and $script:caso -eq 'remoto-falha')) { $global:LASTEXITCODE = 128 }
      else { if ($args[-1] -eq 'HEAD') { '1111111111111111111111111111111111111111' } else { '2222222222222222222222222222222222222222' } }
    }
    'log' { 'Versao sintetica' }
    'fetch' { if ($script:caso -eq 'fetch-falha') { $global:LASTEXITCODE = 128 } }
    'merge-base' { if ($script:caso -eq 'divergente') { $global:LASTEXITCODE = 1 } }
    default { throw "Comando nao permitido neste teste: $args" }
  }
}
foreach ($caso in @('status-falha','sujo','branch','head-falha','fetch-falha','remoto-falha','divergente','valido')) {
  $erro = $null
  try { & $conferencia } catch { $erro = $_ }
  if ($caso -eq 'valido' -and $erro) { throw $erro }
  if ($caso -ne 'valido' -and -not $erro) { throw "Cenario inseguro foi aceito: $caso" }
  Write-Host "[OK] $caso"
}
Write-Host 'Atualizacao segura: 8 cenarios aprovados.' -ForegroundColor Green
