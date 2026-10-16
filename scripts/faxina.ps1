[CmdletBinding()]
param([switch]$Executar)

$ErrorActionPreference = 'Stop'
$Raiz = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
$Privado = Obter-PastaPrivada $Raiz
$modo = if ($Executar) { 'REAL' } else { 'TESTE (nada sera apagado)' }
$total = 0
$itens = 0
$jaListados = New-Object 'System.Collections.Generic.HashSet[string]'

Write-Host "=== Faxina Supply Vision - modo: $modo ===" -ForegroundColor Cyan

function Remover([string]$caminho, [string]$motivo) {
  if (-not (Test-Path -LiteralPath $caminho)) { return }
  $caminho = (Resolve-Path -LiteralPath $caminho).Path
  if (-not $caminho.StartsWith($Raiz + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -and -not $caminho.StartsWith([IO.Path]::GetFullPath($Privado).TrimEnd('\') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
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
