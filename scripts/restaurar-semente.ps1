# Restaura a semente gerada por preparar-semente.ps1 nesta maquina.
# Roda DEPOIS do git clone e ANTES do INSTALAR.bat.
#
#   .\scripts\restaurar-semente.ps1 -Zip D:\supply-vision-semente-20260914_1030.zip
[CmdletBinding()]
param([Parameter(Mandatory)][string]$Zip, [switch]$Simular)

$ErrorActionPreference = 'Stop'
$Raiz = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Privado = Join-Path $Raiz 'privado'
$temp = Join-Path $env:TEMP ('semente-restauro-' + [guid]::NewGuid().ToString('N').Substring(0, 8))

function Etapa([string]$t) { Write-Host "`n== $t ==" -ForegroundColor Cyan }
function Ok([string]$t) { Write-Host "   $t" -ForegroundColor Green }

Etapa 'Abrindo a semente'
if (!(Test-Path -LiteralPath $Zip)) { throw "Arquivo nao encontrado: $Zip" }
Expand-Archive -LiteralPath $Zip -DestinationPath $temp -Force
$meta = Get-Content (Join-Path $temp 'semente.json') -Raw | ConvertFrom-Json
Ok "gerada em $($meta.gerado) na maquina $($meta.origem)"
Ok "versao de origem: $($meta.versao.Substring(0,7))"

$shaAtual = (Get-FileHash (Join-Path $temp 'banco\portal.sqlite') -Algorithm SHA256).Hash
if ($shaAtual -ne $meta.banco.sha256) { throw 'O banco da semente nao confere com o hash registrado. Refaca a semente.' }
Ok "banco integro (SHA-256 $($shaAtual.Substring(0,16)))"

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
  Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "`n   Nada foi alterado." -ForegroundColor DarkGray
  exit 0
}

Etapa 'Restaurando'
foreach ($d in @('comum', 'portal\configuracao', 'alertas\config', 'alertas\parametros')) {
  New-Item -ItemType Directory -Force (Join-Path $Privado $d) | Out-Null
}
New-Item -ItemType Directory -Force $d1 | Out-Null

Copy-Item (Join-Path $temp 'comum\*') (Join-Path $Privado 'comum') -Recurse -Force
Copy-Item (Join-Path $temp 'portal\configuracao\*') (Join-Path $Privado 'portal\configuracao') -Recurse -Force
Copy-Item (Join-Path $temp 'alertas\config\*') (Join-Path $Privado 'alertas\config') -Recurse -Force
Copy-Item (Join-Path $temp 'alertas\parametros\*') (Join-Path $Privado 'alertas\parametros') -Recurse -Force

# O nome do arquivo do D1 e derivado do binding pelo miniflare; manter o nome
# de origem evita que ele crie um banco novo e vazio ao lado.
Copy-Item (Join-Path $temp 'banco\portal.sqlite') (Join-Path $d1 $meta.banco.arquivo) -Force
Ok "banco restaurado como $($meta.banco.arquivo)"
Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue

Etapa 'Valores que PRECISAM ser revistos nesta maquina'
foreach ($r in $meta.revisar) { Write-Host "   [ ] $r" -ForegroundColor Yellow }

Write-Host ''
Write-Host '   valores atuais (herdados da maquina de origem):' -ForegroundColor DarkGray
Get-Content (Join-Path $Privado 'portal\configuracao\portal.env') | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray }
Get-Content (Join-Path $Privado 'alertas\config\cfg_ambiente.txt') | Where-Object { $_ -like 'ACORDO_PATH*' } | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray }
Get-Content (Join-Path $Privado 'comum\operacao.env') | Where-Object { $_ -like '*HORARIO*' } | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray }

Write-Host ''
Write-Host 'Depois de ajustar os valores acima, rode INSTALAR.bat.' -ForegroundColor Cyan
