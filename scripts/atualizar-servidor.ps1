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
if ($sujo) {
  $sujo | ForEach-Object { Write-Host "   $_" -ForegroundColor Red }
  throw 'Ha alteracoes locais nao commitadas. O servidor deve apenas receber versoes, nunca produzi-las.'
}
$anterior = (git rev-parse HEAD).Trim()
Ok "versao atual: $($anterior.Substring(0,7))  $(git log -1 --pretty=format:'%s')"

Etapa 'Buscando novidades'
git fetch origin --quiet
$remoto = (git rev-parse origin/main).Trim()
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

Etapa 'Parando a operacao'
& (Join-Path $Raiz 'PARAR.bat') | Out-Null
for ($i = 0; $i -lt 60; $i++) {
  if (-not (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)) { break }
  Start-Sleep 1
}
if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { throw 'A porta 3000 continua ocupada; operacao nao encerrou.' }
Ok 'operacao parada'

Etapa 'Backup do banco antes de trocar a versao'
& node (Join-Path $Portal 'scripts\backup.mjs')
if ($LASTEXITCODE -ne 0) { throw 'O backup falhou. Atualizacao cancelada — nao se troca versao sem copia do banco.' }
Ok 'backup concluido'

function Reverter([string]$motivo) {
  Write-Host "`n!! $motivo" -ForegroundColor Red
  Write-Host '!! revertendo para a versao anterior' -ForegroundColor Red
  git reset --hard $anterior --quiet
  if ($mexeuNode) { Push-Location $Portal; & npm ci --no-audit --no-fund | Out-Null; Pop-Location }
  Push-Location $Portal; & npm run build | Out-Null; Pop-Location
  & (Join-Path $Raiz 'INICIAR.bat') | Out-Null
  Write-Host "!! revertido para $($anterior.Substring(0,7)). A operacao foi religada." -ForegroundColor Red
  exit 1
}

Etapa 'Aplicando a nova versao'
git reset --hard $remoto --quiet
Ok "agora em $($remoto.Substring(0,7))"

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
