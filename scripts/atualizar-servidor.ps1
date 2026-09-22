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
#   .\scripts\atualizar-servidor.ps1 -Reaplicar reconstroi a versao atual
#
# Depois de trocar a versao, o script se relanca a partir do codigo novo
# (-JaAtualizado). Sem isso, o PowerShell continuaria executando a versao que
# ja estava na memoria, e qualquer correcao ao proprio processo de atualizacao
# so valeria na atualizacao seguinte. -JaAtualizado e -VersaoAnterior sao de
# uso interno; nao devem ser chamados a mao.
[CmdletBinding()]
param([switch]$Simular,[switch]$Reaplicar,[switch]$JaAtualizado,[string]$VersaoAnterior)

$ErrorActionPreference = 'Stop'
$Raiz = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $Raiz
$Portal = Join-Path $Raiz 'portal'
$Alertas = Join-Path $Raiz 'alertas'
$Python = Join-Path $Alertas '.venv\Scripts\python.exe'

function Etapa([string]$t) { Write-Host "`n== $t ==" -ForegroundColor Cyan }
function Ok([string]$t) { Write-Host "   $t" -ForegroundColor Green }
function Aviso([string]$t) { Write-Host "   $t" -ForegroundColor Yellow }
function Garantir-CredencialPortal {
  $portalEnv = Join-Path $Raiz 'privado\portal\configuracao\portal.env'
  if (-not (Test-Path -LiteralPath $portalEnv -PathType Leaf)) { throw "Configuracao do Portal ausente: $portalEnv" }
  $linha = @(Get-Content -LiteralPath $portalEnv) | Where-Object { $_ -match '^\s*PORTAL_API_TOKEN\s*=\s*(\S+)\s*$' } | Select-Object -Last 1
  $tokenAtual = if ($linha) { ($linha -split '=', 2)[1].Trim() } else { '' }
  if ($tokenAtual -notmatch '^[0-9a-fA-F]{64}$') {
    $bytes = New-Object byte[] 32
    $gerador = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $gerador.GetBytes($bytes) } finally { $gerador.Dispose() }
    $tokenAtual = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
    $conteudo = Get-Content -LiteralPath $portalEnv -Raw
    if ($conteudo -match '(?m)^\s*PORTAL_API_TOKEN\s*=') {
      $conteudo = [regex]::Replace($conteudo, '(?m)^\s*PORTAL_API_TOKEN\s*=.*$', "PORTAL_API_TOKEN=$tokenAtual")
    } else { $conteudo += "`r`nPORTAL_API_TOKEN=$tokenAtual`r`n" }
    [IO.File]::WriteAllText($portalEnv, $conteudo, (New-Object Text.UTF8Encoding($false)))
    Ok 'credencial interna do Portal criada ou reparada na configuracao privada'
  }
  $confirmacao = @(Get-Content -LiteralPath $portalEnv) | Where-Object { $_ -match '^\s*PORTAL_API_TOKEN\s*=\s*[0-9a-fA-F]{64}\s*$' }
  if (-not $confirmacao) { throw 'A credencial interna do Portal nao foi gravada corretamente.' }
}

# Os arquivos de privado\ nao sao versionados: quando uma versao nova passa a
# esperar uma chave que ainda nao existe no servidor, a validacao reprova e a
# atualizacao volta atras. Aqui as chaves que faltam sao acrescentadas com o
# valor do exemplo, para que o arquivo do servidor fique com a forma esperada
# e o que precisar de preenchimento apareca como aviso, nao como surpresa.
function Reparar-ConfiguracaoPrivada {
  $pares = @(
    @{ exemplo = Join-Path $Raiz 'portal\portal.env.example';            destino = Join-Path $Raiz 'privado\portal\configuracao\portal.env' },
    @{ exemplo = Join-Path $Raiz 'compartilhado\smtp.env.example';       destino = Join-Path $Raiz 'privado\comum\smtp.env' },
    @{ exemplo = Join-Path $Raiz 'compartilhado\operacao.env.example';   destino = Join-Path $Raiz 'privado\comum\operacao.env' }
  )
  $pendentes = @()
  foreach ($par in $pares) {
    if (-not (Test-Path -LiteralPath $par.exemplo -PathType Leaf)) { continue }
    if (-not (Test-Path -LiteralPath $par.destino -PathType Leaf)) { throw "Configuracao privada ausente: $($par.destino)" }
    $doExemplo = [ordered]@{}
    foreach ($l in @(Get-Content -LiteralPath $par.exemplo)) {
      if ($l -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') { $doExemplo[$Matches[1]] = $Matches[2].Trim() }
    }
    $presentes = @()
    foreach ($l in @(Get-Content -LiteralPath $par.destino)) {
      if ($l -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=') { $presentes += $Matches[1] }
    }
    $faltando = @($doExemplo.Keys | Where-Object { $presentes -notcontains $_ })
    if (-not $faltando) { continue }
    $conteudo = Get-Content -LiteralPath $par.destino -Raw
    if ($conteudo -and -not $conteudo.EndsWith("`n")) { $conteudo += "`r`n" }
    $conteudo += "`r`n# Chaves acrescentadas automaticamente pela atualizacao.`r`n"
    foreach ($k in $faltando) {
      $conteudo += "$k=$($doExemplo[$k])`r`n"
      if (-not $doExemplo[$k]) { $pendentes += "$k (em $(Split-Path $par.destino -Leaf))" }
    }
    [IO.File]::WriteAllText($par.destino, $conteudo, (New-Object Text.UTF8Encoding($false)))
    Ok "configuracao completada em $(Split-Path $par.destino -Leaf): $($faltando -join ', ')"
  }
  if ($pendentes) {
    Aviso 'estas chaves novas entraram vazias e talvez precisem de preenchimento:'
    $pendentes | ForEach-Object { Aviso "  - $_" }
  }
}

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

if ($JaAtualizado) {
  if ($VersaoAnterior -notmatch '^[0-9a-f]{40}$') { throw 'Reexecucao sem a versao anterior. Rode .\scripts\atualizar-servidor.ps1 sem parametros internos.' }
  $anterior = $VersaoAnterior
  $remoto = (git rev-parse --verify HEAD).Trim()
  Aviso "continuando a atualizacao ja com o codigo de $($remoto.Substring(0,7))"
} else {

Etapa 'Buscando novidades'
git fetch origin --quiet
if ($LASTEXITCODE -ne 0) { throw 'Falha ao buscar o repositorio remoto. Nada sera atualizado.' }
$remoto = git rev-parse --verify origin/main
if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel identificar origin/main.' }
$remoto = $remoto.Trim()
git merge-base --is-ancestor $anterior $remoto
if ($LASTEXITCODE -ne 0) { throw 'Ha commits locais ou historico divergente. Atualizacao cancelada para preservar o trabalho local.' }
if ($remoto -eq $anterior -and -not $Reaplicar) { Ok 'Ja esta na versao mais recente. Nada a fazer.'; exit 0 }

if ($Reaplicar -and $remoto -eq $anterior) {
  Aviso 'modo de reparo: a versao atual sera reconstruida e validada novamente'
} else {
  Write-Host '   commits a aplicar:'
  git log --oneline "$anterior..$remoto" | ForEach-Object { Write-Host "      $_" }
}

}

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
if (-not $JaAtualizado) {
  Etapa 'Parando a operacao'
  Parar-Operacao
  Ok 'operacao parada'

  Etapa 'Backup do banco antes de trocar a versao'
  & node (Join-Path $Portal 'scripts\backup.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'O backup falhou. Atualizacao cancelada — nao se troca versao sem copia do banco.' }
  Ok 'backup concluido'
}

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
    & $Python -m pip install -r (Join-Path $Alertas 'config\requirements.txt') -r (Join-Path $Alertas 'config\requirements-dev.txt') --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao restaurar dependencias Python.' }
  }
  Push-Location $Portal
  try { & npm run build | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'Falha ao reconstruir a versao anterior. Operacao permanece parada.' } } finally { Pop-Location }
  & (Join-Path $Raiz 'INICIAR.bat') | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Codigo restaurado, mas falhou a solicitacao de inicio da operacao.' }
  Write-Host "!! codigo revertido para $($anterior.Substring(0,7)). Inicio solicitado; confira a saude da operacao." -ForegroundColor Red
  exit 1
}

if (-not $JaAtualizado) {
  Etapa 'Aplicando a nova versao'
  git merge --ff-only $remoto --quiet
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao aplicar a nova versao. Operacao permanece parada; confira o repositorio antes de reiniciar.' }
  Ok "agora em $($remoto.Substring(0,7))"

  # Daqui para a frente quem manda e o codigo novo. O PowerShell ja carregou
  # este arquivo inteiro na memoria, entao o resto da atualizacao roda num
  # processo novo, lendo o script que acabou de chegar. A operacao segue
  # parada e o backup ja foi feito; o processo filho cuida da reversao se
  # algo reprovar.
  Etapa 'Seguindo com o script da nova versao'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'atualizar-servidor.ps1') -JaAtualizado -VersaoAnterior $anterior
  exit $LASTEXITCODE
}

Etapa 'Conferindo a configuracao privada'
Reparar-ConfiguracaoPrivada

# O Portal e os Alertas compartilham uma credencial local. Ela precisa existir
# antes do build, porque o endpoint interno a incorpora no servidor.
Garantir-CredencialPortal

if ($mexeuNode) {
  Etapa 'Dependencias Node mudaram: npm ci'
  Push-Location $Portal; & npm ci --no-audit --no-fund; $rc = $LASTEXITCODE; Pop-Location
  if ($rc -ne 0) { Reverter 'npm ci falhou.' }
  Ok 'dependencias Node atualizadas'
} else { Aviso 'dependencias Node inalteradas — npm ci dispensado' }

# requirements-dev.txt entra junto, como no instalador e no CI: a suite de
# testes logo abaixo roda pytest, e uma versao nova dele so chegaria ao
# servidor numa reinstalacao completa. O mesmo vale para o Reverter.
if ($mexeuPython) {
  Etapa 'Dependencias Python mudaram: pip install'
  & $Python -m pip install -r (Join-Path $Alertas 'config\requirements.txt') -r (Join-Path $Alertas 'config\requirements-dev.txt') --quiet
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
  if ($t -eq 'validar-operacao.ps1') { Garantir-CredencialPortal }
  # ErrorActionPreference='Stop' transforma QUALQUER escrita em stderr de um
  # programa externo em erro terminante. Um teste que reprova escrevendo no
  # stderr derrubava o atualizador aqui, antes de Reverter -- a versao nova
  # ficava aplicada e a operacao, parada. O codigo de saida e quem decide.
  $anterioPreferencia = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $saidaTeste = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot $t) *>&1)
    $rc = $LASTEXITCODE
  } finally { $ErrorActionPreference = $anterioPreferencia }
  $saidaTeste | ForEach-Object { Write-Host "   $_" }
  if ($rc -ne 0) {
    $detalhes = (@($saidaTeste | Select-Object -Last 8) -join ' | ')
    Reverter "Falhou: $t. Detalhes: $detalhes"
  }
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
