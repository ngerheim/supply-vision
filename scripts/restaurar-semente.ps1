# Restaura a semente gerada por preparar-semente.ps1 nesta maquina.
# Roda DEPOIS do git clone e ANTES do INSTALAR.bat.
#
#   .\scripts\restaurar-semente.ps1 -Zip D:\supply-vision-semente-20260914_1030.zip
[CmdletBinding()]
param([Parameter(Mandatory)][string]$Zip, [switch]$Simular)

$ErrorActionPreference = 'Stop'
$Raiz = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
$Privado = Obter-PastaPrivada $Raiz
$temp = Join-Path $env:TEMP ('semente-restauro-' + [guid]::NewGuid().ToString('N').Substring(0, 8))

function Etapa([string]$t) { Write-Host "`n== $t ==" -ForegroundColor Cyan }
function Ok([string]$t) { Write-Host "   $t" -ForegroundColor Green }

# A semente aberta em %TEMP% tem credenciais e o banco inteiro. O finally
# garante a remocao mesmo quando algo falha no meio (hash que nao confere,
# destino ocupado, disco cheio), e nao so no caminho feliz.
try {
  Etapa 'Abrindo a semente'
  if (!(Test-Path -LiteralPath $Zip)) { throw "Arquivo nao encontrado: $Zip" }
  Expand-Archive -LiteralPath $Zip -DestinationPath $temp -Force
  $meta = Get-Content (Join-Path $temp 'semente.json') -Raw | ConvertFrom-Json
  Ok "gerada em $($meta.gerado) na maquina $($meta.origem)"
  Ok "versao de origem: $($meta.versao.Substring(0,7))"

  $shaAtual = (Get-FileHash (Join-Path $temp 'banco\portal.sqlite') -Algorithm SHA256).Hash
  if ($shaAtual -ne $meta.banco.sha256) { throw 'O banco da semente nao confere com o hash registrado. Refaca a semente.' }
  Ok "banco integro (SHA-256 $($shaAtual.Substring(0,16)))"

  # Toda validacao ocorre antes de tocar a configuracao existente.
  if ([IO.Path]::GetFileName($meta.banco.arquivo) -ne $meta.banco.arquivo -or $meta.banco.arquivo -notmatch '\.sqlite$') { throw 'Nome do banco da semente invalido.' }
  foreach ($d in @('comum', 'portal\configuracao', 'alertas\config', 'alertas\parametros')) {
    if (!(Test-Path -LiteralPath (Join-Path $temp $d) -PathType Container)) { throw "Pasta ausente na semente: $d" }
  }
  $bancoValidado = Join-Path $temp 'banco\validado.sqlite'
  & node --experimental-strip-types (Join-Path $Raiz 'portal\scripts\restaurar-banco-semente.mjs') (Join-Path $temp 'banco\portal.sqlite') $bancoValidado
  if ($LASTEXITCODE -ne 0) { throw 'Banco da semente reprovado; configuracao preservada.' }
  if (!$meta.estadoPersistente) { Write-Warning 'Semente antiga sem estado persistente: confira os envios e slots antes de iniciar a operacao.' }
  if (Test-Path -LiteralPath (Join-Path $Privado 'operacao\supervisor.pid.json')) { throw 'Pare a operacao antes de restaurar a semente.' }

  Etapa 'Conferindo o destino'
  $d1 = Join-Path $Privado 'portal\banco\estado\state\v3\d1\miniflare-D1DatabaseObject'
  $jaTem = @(Get-ChildItem $d1 -Filter '*.sqlite' -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'metadata.sqlite' })
  if ($jaTem.Count -gt 0) {
    $aviso = "Ja existe um banco em $d1. Esta restauracao sobrescreveria dados. Mova o banco atual antes de continuar."
    if (-not $Simular) { throw $aviso }
    Write-Host "   AVISO (simulacao): $aviso" -ForegroundColor Yellow
  } else { Ok 'destino limpo' }

  if ($Simular) {
    Etapa 'Simulacao: o que seria escrito'
    Get-ChildItem $temp -Recurse -File | ForEach-Object { Write-Host "   $($_.FullName.Replace($temp,''))" -ForegroundColor DarkGray }
    Write-Host "`n   Nada foi alterado." -ForegroundColor DarkGray
    return
  }

  Etapa 'Restaurando'
  $pastas = @('comum', 'portal\configuracao', 'alertas\config', 'alertas\parametros')
  if ($meta.estadoPersistente) { $pastas += @('operacao', 'alertas\estado-envios') }
  $recuperacao = Join-Path $temp 'configuracao-anterior'
  $copiadas = @()
  $bancoDestino = Join-Path $d1 $meta.banco.arquivo
  try {
    foreach ($d in $pastas) {
      $origem = Join-Path $temp $d
      $destino = Join-Path $Privado $d
      $anterior = Join-Path $recuperacao $d
      if (Test-Path -LiteralPath $destino) {
        New-Item -ItemType Directory -Force (Split-Path $anterior) | Out-Null
        Copy-Item -LiteralPath $destino -Destination $anterior -Recurse -Force
      }
      $copiadas += $d
      New-Item -ItemType Directory -Force $destino | Out-Null
      Get-ChildItem -LiteralPath $origem -Force | Copy-Item -Destination $destino -Recurse -Force
    }
    New-Item -ItemType Directory -Force $d1 | Out-Null
    Move-Item -LiteralPath $bancoValidado -Destination $bancoDestino
  } catch {
    $erroOriginal = $_
    foreach ($d in $copiadas) {
      $destino = [IO.Path]::GetFullPath((Join-Path $Privado $d))
      $raizSegura = [IO.Path]::GetFullPath($Privado).TrimEnd('\') + '\'
      if (!$destino.StartsWith($raizSegura, [StringComparison]::OrdinalIgnoreCase)) { throw 'Destino de rollback fora da area privada.' }
      if (Test-Path -LiteralPath $destino) { Remove-Item -LiteralPath $destino -Recurse -Force }
      $anterior = Join-Path $recuperacao $d
      if (Test-Path -LiteralPath $anterior) { Copy-Item -LiteralPath $anterior -Destination $destino -Recurse -Force }
    }
    throw $erroOriginal
  }
  Ok "banco restaurado como $($meta.banco.arquivo)"
} finally {
  Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
}

Etapa 'Valores que PRECISAM ser revistos nesta maquina'
foreach ($r in $meta.revisar) { Write-Host "   [ ] $r" -ForegroundColor Yellow }

Write-Host ''
Write-Host '   valores atuais (herdados da maquina de origem):' -ForegroundColor DarkGray
# So as chaves que a lista acima manda revisar e que nao sao segredo. O
# portal.env tambem guarda PORTAL_API_TOKEN e INITIAL_ADMIN_PASSWORD, que nao
# podem ir para o console (nem para quem estiver olhando a tela).
Get-Content (Join-Path $Privado 'portal\configuracao\portal.env') | Where-Object { $_ -match '^\s*(PORTAL_URL|BACKUP_NETWORK_DIR)\s*=' } | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray }
Get-Content (Join-Path $Privado 'comum\operacao.env') | Where-Object { $_ -like '*HORARIO*' } | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray }

Write-Host ''
Write-Host 'Depois de ajustar os valores acima, rode INSTALAR.bat.' -ForegroundColor Cyan
