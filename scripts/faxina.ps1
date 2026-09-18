[CmdletBinding()]
param([switch]$Executar)

$ErrorActionPreference = 'Stop'
$Raiz = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Privado = Join-Path $Raiz 'privado'
$modo = if ($Executar) { 'REAL' } else { 'TESTE (nada sera apagado)' }
$total = 0
$itens = 0
$jaListados = New-Object 'System.Collections.Generic.HashSet[string]'

Write-Host "=== Faxina Supply Vision - modo: $modo ===" -ForegroundColor Cyan

function Remover([string]$caminho, [string]$motivo) {
  if (-not (Test-Path -LiteralPath $caminho)) { return }
  $caminho = (Resolve-Path -LiteralPath $caminho).Path
  if (-not $caminho.StartsWith($Raiz + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Alvo de limpeza fora do projeto: $caminho"
  }
  if ((Get-Item -LiteralPath $caminho -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
    Write-Host "  [PULADO] link de diretorio: $caminho" -ForegroundColor Yellow
    return
  }
  if (-not $script:jaListados.Add($caminho)) { return }
  $bytes = 0
  try { $bytes = (Get-ChildItem -LiteralPath $caminho -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum } catch {}
  if (-not $bytes) { $bytes = 0 }
  $script:total += $bytes
  $script:itens++
  $rotulo = '{0,9:N2} MB  {1}  [{2}]' -f ($bytes / 1MB), $caminho.Replace($Raiz, '.'), $motivo
  if ($Executar) {
    Remove-Item -LiteralPath $caminho -Recurse -Force -ErrorAction Stop
    Write-Host "  [OK]    $rotulo"
  } else {
    Write-Host "  [TESTE] $rotulo"
  }
}

Write-Host "`n-- Caches e bytecode --" -ForegroundColor Yellow
foreach ($alvo in @((Join-Path $Raiz '.pytest_cache'), (Join-Path $Raiz 'alertas\.pytest_cache'))) {
  Remover $alvo 'cache de testes'
}
Get-ChildItem -LiteralPath $Raiz -Directory -Recurse -Force -Filter '__pycache__' -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch '\\\.venv\\' } |
  ForEach-Object { Remover $_.FullName 'bytecode Python' }

Write-Host "`n-- Temporarios do wrangler --" -ForegroundColor Yellow
$tmpWrangler = Join-Path $Raiz 'portal\dist\server\.wrangler\tmp'
$portalNoAr = [bool](Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)
if ($portalNoAr) {
  Write-Host '  [PULADO] Portal em execucao; temporarios preservados.' -ForegroundColor DarkGray
} elseif (Test-Path -LiteralPath $tmpWrangler) {
  Get-ChildItem -LiteralPath $tmpWrangler -Directory -Force -ErrorAction SilentlyContinue |
    ForEach-Object { Remover $_.FullName 'temporario de execucao' }
}

Write-Host "`n-- Rastreamento de observabilidade (regenera sozinho) --" -ForegroundColor Yellow
if ($portalNoAr) {
  Write-Host '  [PULADO] o Portal esta no ar; esses arquivos estao abertos pelo wrangler.' -ForegroundColor DarkGray
  Write-Host '           pare a operacao (PARAR.bat) e rode a faxina de novo para limpa-los.' -ForegroundColor DarkGray
} else {
  $obs = Join-Path $Privado 'portal\banco\estado\state\v3\observability\miniflare-wobs-trace-store'
  Remover $obs 'rastreamento do wrangler (recriado na proxima subida)'
}

Write-Host "`n-- Residuos da migracao (ja concluida) --" -ForegroundColor Yellow
foreach ($n in @('ensaio-migracao', 'relatorio-ensaio-migracao.json', 'ensaio-portal-saida.log', 'ensaio-portal-erro.log', 'desabilitar-antigas.ps1', 'desabilitar-antigas-resultado.txt')) {
  Remover (Join-Path $Privado "operacao\$n") 'residuo do ensaio de migracao'
}

Write-Host "`n-- Estruturas aposentadas --" -ForegroundColor Yellow
Remover (Join-Path $Privado 'instalacao') 'pasta criada e nunca usada'
Remover (Join-Path $Privado 'alertas\logs\archive') 'archive aposentado pela nova retencao'
Remover (Join-Path $Privado 'alertas\relatorios\diarios\pendencias') 'relatorio de pendencias removido do pipeline'
Remover (Join-Path $Privado 'portal\dados-origem') 'pasta de massa de teste aposentada'
Remover (Join-Path $Privado 'alertas\recortes') 'eixo antigo, hoje em relatorios\historicos'

Write-Host "`n-- Pastas vazias remanescentes --" -ForegroundColor Yellow
# privado\ fica de fora: as pastas de saida sao estruturais e nascem vazias.
# Apaga-las faria a faxina desfazer o que o instalador acabou de criar.
for ($passada = 1; $passada -le 3; $passada++) {
  Get-ChildItem -LiteralPath $Raiz -Directory -Recurse -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch '\\(node_modules|\.venv|\.git|privado)(\\|$)' } |
    Where-Object { @(Get-ChildItem -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue).Count -eq 0 } |
    ForEach-Object { Remover $_.FullName 'pasta vazia' }
}

Write-Host ''
$verbo = if ($Executar) { 'liberados' } else { 'seriam liberados' }
Write-Host ("=== {0} itens, {1:N2} MB {2} ===" -f $itens, ($total / 1MB), $verbo) -ForegroundColor Cyan
if (-not $Executar) { Write-Host 'Rode com -Executar para aplicar.' -ForegroundColor DarkGray }
