# Empacota o minimo indispensavel para levantar o Supply Vision em outra
# maquina: configuracao, parametros e o banco do Portal. Tudo o mais e
# regeravel (base do Qlik, logs, relatorios, estado da operacao) ou vem do
# repositorio.
#
#   .\scripts\preparar-semente.ps1
#   .\scripts\preparar-semente.ps1 -Destino D:\
[CmdletBinding()]
param([string]$Destino = $env:USERPROFILE)

$ErrorActionPreference = 'Stop'
$Raiz = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Privado = Join-Path $Raiz 'privado'
$stamp = Get-Date -Format 'yyyyMMdd_HHmm'
$temp = Join-Path $env:TEMP "semente-$stamp"
$zip = Join-Path $Destino "supply-vision-semente-$stamp.zip"

function Etapa([string]$t) { Write-Host "`n== $t ==" -ForegroundColor Cyan }

Etapa 'Conferindo a origem'
if (!(Test-Path $Privado)) { throw "Area privada nao encontrada: $Privado" }

# O banco vivo pode estar a meio de uma escrita. Se a operacao estiver no ar,
# usa o backup mais recente, que nasce de VACUUM INTO + integrity_check.
$portalNoAr = [bool](Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)
$backup = Join-Path $Privado 'portal\backups\portal-atual.sqlite'
if ($portalNoAr) {
  if (!(Test-Path $backup)) { throw 'O Portal esta no ar e nao ha backup para empacotar. Rode o backup ou pare a operacao.' }
  $idade = (Get-Date) - (Get-Item $backup).LastWriteTime
  Write-Host "   Portal no ar: usando o backup de $([int]$idade.TotalMinutes) min atras" -ForegroundColor Yellow
  if ($idade.TotalHours -gt 12) { Write-Host '   ATENCAO: o backup tem mais de 12h. Considere rodar um novo antes.' -ForegroundColor Yellow }
} else {
  Write-Host '   operacao parada: o banco vivo sera copiado direto' -ForegroundColor Green
}

Etapa 'Montando a semente'
Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
foreach ($d in @('comum', 'portal\configuracao', 'alertas\config', 'alertas\parametros', 'banco')) {
  New-Item -ItemType Directory -Force (Join-Path $temp $d) | Out-Null
}

Copy-Item (Join-Path $Privado 'comum\*.env') (Join-Path $temp 'comum') -Force
Copy-Item (Join-Path $Privado 'portal\configuracao\portal.env') (Join-Path $temp 'portal\configuracao') -Force
Copy-Item (Join-Path $Privado 'alertas\config\*') (Join-Path $temp 'alertas\config') -Recurse -Force
Copy-Item (Join-Path $Privado 'alertas\parametros\*') (Join-Path $temp 'alertas\parametros') -Recurse -Force

# O banco: um unico arquivo .sqlite dentro do diretorio do D1.
$d1 = Join-Path $Privado 'portal\banco\estado\state\v3\d1\miniflare-D1DatabaseObject'
# O nome do arquivo do D1 e derivado do binding pelo miniflare e precisa ser
# preservado, mesmo quando o CONTEUDO vem do backup. Gravar com outro nome
# faria o miniflare ignorar o banco e criar um vazio ao lado.
$nomeD1 = @(Get-ChildItem $d1 -Filter '*.sqlite' -File | Where-Object { $_.Name -ne 'metadata.sqlite' })
if ($nomeD1.Count -ne 1) { throw "Esperado exatamente 1 banco em $d1, encontrados $($nomeD1.Count)." }
$origemBanco = if ($portalNoAr) { $backup } else { $nomeD1[0].FullName }
Copy-Item $origemBanco (Join-Path $temp 'banco\portal.sqlite') -Force
$sha = (Get-FileHash (Join-Path $temp 'banco\portal.sqlite') -Algorithm SHA256).Hash

@{
  gerado = (Get-Date).ToString('o')
  origem = [Environment]::MachineName
  banco = @{ arquivo = $nomeD1[0].Name; sha256 = $sha; deBackup = $portalNoAr }
  versao = (git -C $Raiz rev-parse HEAD).Trim()
  revisar = @(
    'privado\portal\configuracao\portal.env -> PORTAL_URL (IP desta maquina)',
    'privado\portal\configuracao\portal.env -> BACKUP_NETWORK_DIR (acesso a rede)',
    'privado\alertas\config\cfg_ambiente.txt -> ACORDO_PATH (acesso a rede)',
    'privado\comum\operacao.env -> LIMPEZA_HORARIO deve cair na janela em que a maquina fica logada'
  )
} | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $temp 'semente.json') -Encoding UTF8

Etapa 'Compactando'
Remove-Item $zip -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $temp '*') -DestinationPath $zip -CompressionLevel Optimal
Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue

$tam = (Get-Item $zip).Length / 1KB
Write-Host ''
Write-Host "=== Semente pronta: $zip ($('{0:N0}' -f $tam) KB) ===" -ForegroundColor Cyan
Write-Host ''
Write-Host 'No notebook novo, em ordem:' -ForegroundColor White
Write-Host '   1. git clone <repo> C:\Projetos\supply-vision'
Write-Host '   2. .\scripts\restaurar-semente.ps1 -Zip <caminho do zip>'
Write-Host '   3. INSTALAR.bat'
Write-Host ''
Write-Host 'ATENCAO: a semente contem credenciais (SMTP, Qlik) e o banco com' -ForegroundColor Yellow
Write-Host 'precos e usuarios. Nao envie por canal aberto e apague depois de usar.' -ForegroundColor Yellow
