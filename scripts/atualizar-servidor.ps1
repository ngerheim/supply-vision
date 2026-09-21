# Atualiza a instalacao do servidor a partir do repositorio.
#
# Fluxo previsto:
#   1. no notebook de desenvolvimento: commit e push
#   2. no notebook servidor: este script
#
# O banco e os dados ficam em privado\, que o Git ignora. Eles nao sao
# tocados aqui por construcao, nao por cuidado.
#
#   .\scripts\atualizar-servidor.ps1            aplica
#   .\scripts\atualizar-servidor.ps1 -Simular   so mostra o que viria
[CmdletBinding()]
param([switch]$Simular)

$ErrorActionPreference = 'Stop'
$Raiz = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $Raiz
$Portal = Join-Path $Raiz 'portal'
$Alertas = Join-Path $Raiz 'alertas'
$Python = Join-Path $Alertas '.venv\Scripts\python.exe'

function Etapa([string]$t) { Write-Host "`n== $t ==" -ForegroundColor Cyan }
function Ok([string]$t) { Write-Host "   $t" -ForegroundColor Green }
function Aviso([string]$t) { Write-Host "   $t" -ForegroundColor Yellow }

Etapa 'Conferindo o repositorio'
$sujo = git status --porcelain
if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel conferir o repositorio.' }
if ($sujo) {
  $sujo | ForEach-Object { Write-Host "   $_" -ForegroundColor Red }
  throw 'Ha alteracoes locais nao commitadas. O servidor deve apenas receber versoes, nunca produzi-las.'
}
$branch = git branch --show-current
if ($LASTEXITCODE -ne 0 -or $branch -ne 'main') { throw 'O servidor deve estar na branch main antes de atualizar.' }
$anterior = git rev-parse --verify HEAD
if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel identificar a versao atual.' }
$anterior = $anterior.Trim()
Ok "versao atual: $($anterior.Substring(0,7))  $(git log -1 --pretty=format:'%s')"

Etapa 'Buscando novidades'
git fetch origin --quiet
if ($LASTEXITCODE -ne 0) { throw 'Falha ao buscar o repositorio remoto. Nada sera atualizado.' }
$remoto = git rev-parse --verify origin/main
if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel identificar origin/main.' }
$remoto = $remoto.Trim()
git merge-base --is-ancestor $anterior $remoto
if ($LASTEXITCODE -ne 0) { throw 'Ha commits locais ou historico divergente. Atualizacao cancelada para preservar o trabalho local.' }
if ($remoto -eq $anterior) { Ok 'Ja esta na versao mais recente. Nada a fazer.'; exit 0 }

Write-Host '   commits a aplicar:'
git log --oneline "$anterior..$remoto" | ForEach-Object { Write-Host "      $_" }
$mudou = git diff --name-only "$anterior..$remoto"
$mexeuNode = $mudou | Where-Object { $_ -eq 'portal/package-lock.json' -or $_ -eq 'portal/package.json' }
$mexeuPython = $mudou | Where-Object { $_ -like 'alertas/config/requirements*' }

if ($Simular) {
  Write-Host "`n   arquivos alterados:" -ForegroundColor DarkGray
  $mudou | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray }
  Aviso ('dependencias Node: ' + $(if ($mexeuNode) { 'PRECISAM de npm ci' } else { 'inalteradas' }))
  Aviso ('dependencias Python: ' + $(if ($mexeuPython) { 'PRECISAM de pip install' } else { 'inalteradas' }))
  Write-Host "`n   Simulacao: nada foi alterado." -ForegroundColor DarkGray
  exit 0
}

function Parar-Operacao {
& (Join-Path $Raiz 'PARAR.bat') | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Falha ao solicitar a parada da operacao.' }
for ($i = 0; $i -lt 60; $i++) {
  if (-not (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)) { break }
  Start-Sleep 1
}
if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { throw 'A porta 3000 continua ocupada; operacao nao encerrou.' }
}
Etapa 'Parando a operacao'
Parar-Operacao
Ok 'operacao parada'

Etapa 'Backup do banco antes de trocar a versao'
& node (Join-Path $Portal 'scripts\backup.mjs')
if ($LASTEXITCODE -ne 0) { throw 'O backup falhou. Atualizacao cancelada — nao se troca versao sem copia do banco.' }
Ok 'backup concluido'

function Reverter([string]$motivo) {
  Write-Host "`n!! $motivo" -ForegroundColor Red
  Write-Host '!! revertendo para a versao anterior' -ForegroundColor Red
  Parar-Operacao
  git reset --hard $anterior --quiet
  if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel restaurar o codigo anterior. Operacao permanece parada.' }
  if ($mexeuNode) {
    Push-Location $Portal
    try { & npm ci --no-audit --no-fund | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'Falha ao restaurar dependencias Node.' } } finally { Pop-Location }
  }
  if ($mexeuPython) {
    & $Python -m pip install -r (Join-Path $Alertas 'config\requirements.txt') --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao restaurar dependencias Python.' }
  }
  Push-Location $Portal
  try { & npm run build | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'Falha ao reconstruir a versao anterior. Operacao permanece parada.' } } finally { Pop-Location }
  & (Join-Path $Raiz 'INICIAR.bat') | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Codigo restaurado, mas falhou a solicitacao de inicio da operacao.' }
  Write-Host "!! codigo revertido para $($anterior.Substring(0,7)). Inicio solicitado; confira a saude da operacao." -ForegroundColor Red
  exit 1
}

Etapa 'Aplicando a nova versao'
git merge --ff-only $remoto --quiet
if ($LASTEXITCODE -ne 0) { throw 'Falha ao aplicar a nova versao. Operacao permanece parada; confira o repositorio antes de reiniciar.' }
Ok "agora em $($remoto.Substring(0,7))"

# O Portal e os Alertas compartilham uma credencial local para que o motor de
# relatorios leia os acordos sem depender da sessao de uma pessoa. Instalacoes
# antigas recebem a chave automaticamente, antes do build que a incorpora.
$portalEnv = Join-Path $Raiz 'privado\portal\configuracao\portal.env'
$temToken = (Test-Path $portalEnv) -and (@(Get-Content $portalEnv) | Where-Object { $_ -match '^\s*PORTAL_API_TOKEN\s*=\s*\S+' })
if (-not $temToken) {
  $bytes = New-Object byte[] 32
  $gerador = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $gerador.GetBytes($bytes) } finally { $gerador.Dispose() }
  $token = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
  $conteudo = Get-Content -LiteralPath $portalEnv -Raw
  if ($conteudo -match '(?m)^\s*PORTAL_API_TOKEN\s*=') {
    $conteudo = [regex]::Replace($conteudo, '(?m)^\s*PORTAL_API_TOKEN\s*=.*$', "PORTAL_API_TOKEN=$token")
  } else { $conteudo += "`r`nPORTAL_API_TOKEN=$token`r`n" }
  [IO.File]::WriteAllText($portalEnv, $conteudo, (New-Object Text.UTF8Encoding($false)))
  Ok 'credencial interna do Portal criada na configuracao privada'
}

if ($mexeuNode) {
  Etapa 'Dependencias Node mudaram: npm ci'
  Push-Location $Portal; & npm ci --no-audit --no-fund; $rc = $LASTEXITCODE; Pop-Location
  if ($rc -ne 0) { Reverter 'npm ci falhou.' }
  Ok 'dependencias Node atualizadas'
} else { Aviso 'dependencias Node inalteradas — npm ci dispensado' }

if ($mexeuPython) {
  Etapa 'Dependencias Python mudaram: pip install'
  & $Python -m pip install -r (Join-Path $Alertas 'config\requirements.txt') --quiet
  if ($LASTEXITCODE -ne 0) { Reverter 'pip install falhou.' }
  Ok 'dependencias Python atualizadas'
} else { Aviso 'dependencias Python inalteradas — pip install dispensado' }

Etapa 'Build do Portal'
Push-Location $Portal; & npm run build; $rc = $LASTEXITCODE; Pop-Location
if ($rc -ne 0) { Reverter 'O build falhou.' }
Ok 'build concluido'

Etapa 'Suites de teste'
$suites = @(
  @{ nome = 'testes do Portal';        exe = 'npm.cmd'; args = @('test');        pasta = $Portal },
  @{ nome = 'testes dos Alertas';      exe = $Python;   args = @('-m', 'pytest', 'tests', '-q'); pasta = $Alertas }
)
foreach ($s in $suites) {
  Push-Location $s.pasta; & $s.exe @($s.args); $rc = $LASTEXITCODE; Pop-Location
  if ($rc -ne 0) { Reverter "Falhou: $($s.nome)." }
  Ok $s.nome
}
foreach ($t in @('validar-operacao.ps1', 'testar-operacao.ps1', 'testar-supervisor-isolado.ps1', 'testar-persistencia-alertas.ps1')) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot $t)
  if ($LASTEXITCODE -ne 0) { Reverter "Falhou: $t." }
}
Ok 'suites de operacao aprovadas'

Etapa 'Religando a operacao'
& (Join-Path $Raiz 'INICIAR.bat') | Out-Null
if ($LASTEXITCODE -ne 0) { Reverter 'Falha ao solicitar o inicio da nova versao.' }
$url = 'http://127.0.0.1:3000'
try {
  $linha = @(Get-Content (Join-Path $Raiz 'privado\portal\configuracao\portal.env')) | Where-Object { $_ -like 'PORTAL_URL=*' } | Select-Object -First 1
  if ($linha) { $url = ($linha -split '=', 2)[1].Trim() }
} catch { }

$noAr = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep 2
  try { if ((Invoke-RestMethod "$url/api/health" -TimeoutSec 3).status -eq 'ok') { $noAr = $true; break } } catch { }
}
if (-not $noAr) { Reverter 'O Portal nao respondeu depois da atualizacao.' }

Ok "Portal no ar em $url"
Write-Host "`n=== Atualizado: $($anterior.Substring(0,7)) -> $($remoto.Substring(0,7)) ===" -ForegroundColor Cyan
git log -1 --pretty=format:'    %s'
Write-Host ''
exit 0
