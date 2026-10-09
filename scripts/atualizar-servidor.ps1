# Atualiza a instalacao do servidor a partir do repositorio.
#
# Fluxo previsto:
#   1. no notebook de desenvolvimento: commit e push
#   2. no notebook servidor: este script
#
# O banco e os dados ficam em privado\, que o Git ignora; a troca de codigo
# nao os toca. A excecao e o Reverter: se a versao nova ja rodou contra o
# banco real, ele restaura o banco da copia feita antes da troca.
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
param([switch]$Simular,[switch]$Reaplicar,[switch]$JaAtualizado,[string]$VersaoAnterior,[ValidateRange(1,3600)][int]$PrazoParadaSegundos=60)

$ErrorActionPreference = 'Stop'
$Raiz = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
$script:TarefaSemLogin=$false
$logicaInicializacao=Join-Path $PSScriptRoot 'inicializacao-logica.ps1'
if(Test-Path $logicaInicializacao){. $logicaInicializacao;$script:TarefaSemLogin=!!(Obter-TarefaSupplyVision $Raiz)}
if($script:TarefaSemLogin-and!$Simular-and!(Testar-Elevacao)){throw 'Atualizar a operacao com a conta da tarefa exige executar como administrador.'}
$Node = Localizar-NodeMaquina
$Npm = if([IO.Path]::IsPathRooted($Node)){Join-Path (Split-Path $Node) 'npm.cmd'}else{'npm.cmd'}
Set-Location $Raiz
$Portal = Join-Path $Raiz 'portal'
$Alertas = Join-Path $Raiz 'alertas'
$Python = Join-Path $Alertas '.venv\Scripts\python.exe'
$PastaBackupPortal = Join-Path (Obter-PastaPrivada $Raiz) 'portal\backups'
$BackupAntesAtualizacaoOrigem = Join-Path $PastaBackupPortal 'portal-atual.sqlite'
$BackupAntesAtualizacao = Join-Path $PastaBackupPortal 'pre-atualizacao.sqlite'

function Etapa([string]$t) { Write-Host "`n== $t ==" -ForegroundColor Cyan }
function Ok([string]$t) { Write-Host "   $t" -ForegroundColor Green }
function Aviso([string]$t) { Write-Host "   $t" -ForegroundColor Yellow }
function Garantir-CredencialPortal {
  $portalEnv = Join-Path (Obter-PastaPrivada $Raiz) 'portal\configuracao\portal.env'
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
    @{ exemplo = Join-Path $Raiz 'portal\portal.env.example';            destino = Join-Path (Obter-PastaPrivada $Raiz) 'portal\configuracao\portal.env' },
    @{ exemplo = Join-Path $Raiz 'compartilhado\smtp.env.example';       destino = Join-Path (Obter-PastaPrivada $Raiz) 'comum\smtp.env' },
    @{ exemplo = Join-Path $Raiz 'compartilhado\operacao.env.example';   destino = Join-Path (Obter-PastaPrivada $Raiz) 'comum\operacao.env' }
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

$ContextoArquivo = Join-Path (Obter-PastaPrivada $Raiz) 'operacao/atualizacao.json'
$Recuperando = $false
$OperacaoParada = $false
$script:ParadaSolicitada = $false
$CodigoTrocado = $false
$NovaVersaoIniciada = $false
$OperacaoEstavaAtiva = $false
$mexeuNode = $true
$mexeuPython = $true
$anterior = $VersaoAnterior

function Iniciar-OperacaoAtualizada {
 if($script:TarefaSemLogin){Enable-ScheduledTask -TaskName 'Supply Vision' -TaskPath '\'|Out-Null;Start-ScheduledTask -TaskName 'Supply Vision' -TaskPath '\';$global:LASTEXITCODE=0;return}
 $logica=Join-Path $PSScriptRoot 'inicializacao-logica.ps1'
 if(Test-Path $logica){. $logica;Iniciar-OperacaoConfigurada $Raiz;return}
 & (Join-Path $Raiz 'INICIAR.bat') | Out-Null
}
function Parar-OperacaoAtualizacao([int]$Limite=60) {
 $script:ParadaSolicitada=$true
 if($script:TarefaSemLogin){Disable-ScheduledTask -TaskName 'Supply Vision' -TaskPath '\'|Out-Null}
 if(!(Parar-Operacao $Raiz $Limite)){throw 'Supervisor ou portas nao encerraram no prazo; troca de codigo e banco bloqueada.'}
}

function Reverter([string]$motivo) {
  if ($script:Recuperando) { throw 'A recuperacao ja foi tentada. Operacao permanece parada.' }
  $script:Recuperando = $true
  Parar-OperacaoAtualizacao $PrazoParadaSegundos
  Gravar-EstadoOperacao $ContextoArquivo @{anterior=$anterior;remoto=$remoto;fase='recuperando'}
  Write-Host "`n!! $motivo" -ForegroundColor Red
  Write-Host '!! revertendo para a versao anterior' -ForegroundColor Red
  if ($NovaVersaoIniciada) {
    # A versao nova ja rodou contra o banco real: o banco volta junto com o
    # codigo, a partir da copia feita antes da troca. A operacao esta parada
    # (Parar-Operacao acima), como restaurar-backup.mjs exige; ele guarda o
    # estado atual como copia datada antes de sobrescrever.
    Write-Host "!! a versao nova chegou a rodar com o banco real; restaurando o banco de $BackupAntesAtualizacao" -ForegroundColor Red
    $restaurou = $false
    try {
      if (-not (Test-Path -LiteralPath $BackupAntesAtualizacao)) { throw "copia de antes da atualizacao nao encontrada: $BackupAntesAtualizacao" }
      Copy-Item -LiteralPath $BackupAntesAtualizacao -Destination $BackupAntesAtualizacaoOrigem -Force
      & $Node --experimental-strip-types (Join-Path $Portal 'scripts\restaurar-backup.mjs') --sim
      if ($LASTEXITCODE -ne 0) { throw "restaurar-backup.mjs terminou com codigo $LASTEXITCODE" }
      $restaurou = $true
    } catch {
      Write-Host "!! FALHOU A RESTAURACAO DO BANCO: $($_.Exception.Message)" -ForegroundColor Red
    }
    if (-not $restaurou) {
      Write-Host '!! ============================================================' -ForegroundColor Red
      Write-Host '!! O BANCO NAO FOI RESTAURADO. A operacao permanece PARADA.' -ForegroundColor Red
      Write-Host "!! Copia de antes da atualizacao: $BackupAntesAtualizacao" -ForegroundColor Red
      Write-Host '!! Siga docs\SOCORRO.md (restauracao do banco) antes de religar.' -ForegroundColor Red
      Write-Host '!! ============================================================' -ForegroundColor Red
      throw 'Banco nao restaurado; troca de codigo cancelada. Operacao permanece parada.'
    }
    & $Node --experimental-strip-types (Join-Path $Portal 'scripts/operacao-validacao.mjs') --liberar
    if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel liberar o banco restaurado. Operacao permanece parada.' }
    Write-Host '!! banco restaurado para o estado de antes da atualizacao' -ForegroundColor Red
  }
  # Restaura com o script da versao nova, que valida banco e filas.
  # So depois volta o codigo: a versao anterior pode nao ter essas protecoes.
  $introduzidos=@(& git -c core.quotepath=false diff --name-only --diff-filter=A "${anterior}..${remoto}" --)
  if($LASTEXITCODE){throw 'Nao foi possivel identificar os arquivos novos da versao.'}
  git reset --hard $anterior --quiet
  if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel restaurar o codigo anterior. Operacao permanece parada.' }
  Remover-ArquivosIntroduzidos $Raiz $introduzidos
  if ($mexeuNode) {
    Push-Location $Portal
    try { & $Npm ci --no-audit --no-fund | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'Falha ao restaurar dependencias Node.' } } finally { Pop-Location }
  }
  if ($mexeuPython) {
    & $Python -m pip install -r (Join-Path $Alertas 'config\requirements.txt') -r (Join-Path $Alertas 'config\requirements-dev.txt') --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao restaurar dependencias Python.' }
  }
  Push-Location $Portal
  try { & $Npm run build | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'Falha ao reconstruir a versao anterior. Operacao permanece parada.' } } finally { Pop-Location }
  Iniciar-OperacaoAtualizada
  if ($LASTEXITCODE -ne 0) { throw 'Codigo restaurado, mas falhou a solicitacao de inicio da operacao.' }
  Write-Host "!! codigo revertido para $($anterior.Substring(0,7)). Inicio solicitado; confira a saude da operacao." -ForegroundColor Red
  Gravar-EstadoOperacao $ContextoArquivo @{anterior=$anterior;remoto=$remoto;fase='revertido'}
  exit 1
}

try {
  # O pai conserva o contexto fora do checkout; o filho pode falhar ate no
  # pre-voo. Sem contexto verificavel, parametros internos nao autorizam reset.
  if ($JaAtualizado) {
    $contextoAnterior = Ler-EstadoOperacao $ContextoArquivo
    $repeticaoLegada = $contextoAnterior.fase -eq 'revertido' -and $contextoAnterior.anterior -eq $VersaoAnterior
    if (!(Test-Path -LiteralPath $ContextoArquivo) -or $repeticaoLegada) {
      # Primeira chegada desta correcao: o pai da versao anterior ainda nao
      # gravava contexto. Tambem aceita repetir uma tentativa ja revertida.
      # Verifica o commit e o snapshot que o pai entregou.
      if ($VersaoAnterior -notmatch '^[0-9a-f]{40}$' -or !(Test-Path -LiteralPath $BackupAntesAtualizacao)) { throw 'Reexecucao legada sem commit/snapshot verificavel.' }
      & git rev-parse --verify $VersaoAnterior | Out-Null
      if ($LASTEXITCODE -ne 0) { throw 'Commit anterior nao encontrado.' }
      & git merge-base --is-ancestor $VersaoAnterior HEAD
      if ($LASTEXITCODE -ne 0) { throw 'Commit anterior nao pertence a esta atualizacao.' }
      $remoto = (git rev-parse --verify HEAD).Trim()
      New-Item -ItemType Directory -Force (Split-Path $ContextoArquivo -Parent) | Out-Null
      Gravar-EstadoOperacao $ContextoArquivo @{anterior=$VersaoAnterior;remoto=$remoto;fase='codigo'}
    }
    $contexto = Ler-EstadoOperacao $ContextoArquivo
    if ($VersaoAnterior -notmatch '^[0-9a-f]{40}$' -or $contexto.anterior -ne $VersaoAnterior -or $contexto.fase -ne 'codigo') { throw 'Contexto de reexecucao invalido.' }
    $remoto = $contexto.remoto
    $CodigoTrocado = $true
    $OperacaoParada = $true
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
$atual = git rev-parse --verify HEAD
if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel identificar a versao atual.' }
$atual = $atual.Trim()
# Na reexecucao (-JaAtualizado) o HEAD ja e a versao nova; $anterior continua
# sendo a de -VersaoAnterior, para que uma falha aqui reverta para ela.
if (-not $JaAtualizado) { $anterior = $atual }
Ok "versao atual: $($atual.Substring(0,7))  $(git log -1 --pretty=format:'%s')"

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

# So depois de $anterior apontar para a versao realmente anterior: na
# reexecucao (-JaAtualizado) ele vem de -VersaoAnterior. Uma falha antes disso
# fazia a recuperacao "reverter" para a propria versao nova.
Validar-PythonAlertas $Python

$mudou = git diff --name-only "$anterior..$remoto"
$mexeuNode = $mudou | Where-Object { $_ -eq 'portal/package-lock.json' -or $_ -eq 'portal/package.json' }
$mexeuPython = $mudou | Where-Object { $_ -like 'alertas/config/requirements*' }
# No modo de reparo o antes e o depois sao o mesmo commit, entao a lista de
# mudancas vem vazia e as dependencias nunca eram reinstaladas: um node_modules
# ou ambiente Python quebrado continuava quebrado. Reparar e reinstalar tudo.
if ($Reaplicar) { $mexeuNode = $true; $mexeuPython = $true }

if ($Simular) {
  Write-Host "`n   arquivos alterados:" -ForegroundColor DarkGray
  $mudou | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray }
  Aviso ('dependencias Node: ' + $(if ($mexeuNode) { 'PRECISAM de npm.cmd ci' } else { 'inalteradas' }))
  Aviso ('dependencias Python: ' + $(if ($mexeuPython) { 'PRECISAM de pip install' } else { 'inalteradas' }))
  Write-Host "`n   Simulacao: nada foi alterado." -ForegroundColor DarkGray
  exit 0
}

if (-not $JaAtualizado) {
  $OperacaoEstavaAtiva = !(Testar-SupervisorEncerrado (Obter-PastaPrivada $Raiz))
  Etapa 'Parando a operacao'
  Parar-OperacaoAtualizacao $PrazoParadaSegundos
  $OperacaoParada = $true
  Ok 'operacao parada'

  Etapa 'Backup do banco antes de trocar a versao'
  & $Node --experimental-strip-types (Join-Path $Portal 'scripts\backup.mjs') --pre-atualizacao
  if ($LASTEXITCODE -eq 3) { Aviso 'Backup local validado; copia de rede falhou. Atualizacao continua.' }
  elseif ($LASTEXITCODE -ne 0) { throw 'O backup falhou. Atualizacao cancelada — nao se troca versao sem copia do banco.' }
  Ok 'backup concluido'
  # portal-atual.sqlite e reescrito por todo backup, inclusive o diario do
  # supervisor quando a versao nova sobe. Uma copia fixa guarda o estado de
  # antes da troca para o Reverter, mesmo que outro backup rode no meio.
  Copy-Item -LiteralPath $BackupAntesAtualizacaoOrigem -Destination $BackupAntesAtualizacao -Force
  Ok "copia de antes da atualizacao: $BackupAntesAtualizacao"
}

# Vira $true quando a versao nova e iniciada contra o banco real. A partir
# dai ela pode ter migrado ou gravado dados, e reverter so o codigo deixaria
# a versao anterior com um banco que ela talvez nao entenda.

if (-not $JaAtualizado) {
  Etapa 'Aplicando a nova versao'
  New-Item -ItemType Directory -Force (Split-Path $ContextoArquivo -Parent) | Out-Null
  Gravar-EstadoOperacao $ContextoArquivo @{anterior=$anterior;remoto=$remoto;fase='codigo'}
  $CodigoTrocado = $true
  git merge --ff-only $remoto --quiet
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao aplicar a nova versao.' }
  Ok "agora em $($remoto.Substring(0,7))"

  # Daqui para a frente quem manda e o codigo novo. O PowerShell ja carregou
  # este arquivo inteiro na memoria, entao o resto da atualizacao roda num
  # processo novo, lendo o script que acabou de chegar. A operacao segue
  # parada e o backup ja foi feito; o processo filho cuida da reversao se
  # algo reprovar.
  Etapa 'Seguindo com o script da nova versao'
  $argumentosReexecucao = Argumentos-ReexecucaoAtualizador (Join-Path $PSScriptRoot 'atualizar-servidor.ps1') $anterior ([bool]$Reaplicar)
  & powershell.exe @argumentosReexecucao
  $rcFilho = $LASTEXITCODE
  if ($rcFilho -ne 0) {
    $contexto = Ler-EstadoOperacao $ContextoArquivo
    if ($contexto.fase -in @('revertido','recuperando')) {
      if ($contexto.fase -eq 'recuperando') { Aviso 'A recuperacao do filho nao concluiu. Operacao permanece parada; confira docs/SOCORRO.md.' }
      exit $rcFilho
    }
    $NovaVersaoIniciada = $contexto.fase -eq 'iniciada'
    throw "O processo da nova versao falhou (codigo $rcFilho)."
  }
  exit 0
}

Etapa 'Conferindo a configuracao privada'
Reparar-ConfiguracaoPrivada

# O Portal e os Alertas compartilham uma credencial local. Ela precisa existir
# antes do build, porque o endpoint interno a incorpora no servidor.
Garantir-CredencialPortal

if ($mexeuNode) {
  Etapa 'Dependencias Node mudaram: npm.cmd ci'
  Push-Location $Portal; & $Npm ci --no-audit --no-fund; $rc = $LASTEXITCODE; Pop-Location
  if ($rc -ne 0) { Reverter 'npm.cmd ci falhou.' }
  Ok 'dependencias Node atualizadas'
} else { Aviso 'dependencias Node inalteradas — npm.cmd ci dispensado' }

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
Push-Location $Portal; & $Npm run build; $rc = $LASTEXITCODE; Pop-Location
if ($rc -ne 0) { Reverter 'O build falhou.' }
Ok 'build concluido'

Etapa 'Suites de teste'
$suites = @(
  @{ nome = 'testes do Portal';        exe = $Npm; args = @('test');        pasta = $Portal },
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
$NovaVersaoIniciada = $true
& $Node --experimental-strip-types (Join-Path $Portal 'scripts/operacao-validacao.mjs') --ativar
if ($LASTEXITCODE -ne 0) { Reverter 'Nao foi possivel bloquear gravacoes e envios durante a validacao.' }
Gravar-EstadoOperacao $ContextoArquivo @{anterior=$anterior;remoto=$remoto;fase='iniciada'}
Iniciar-OperacaoAtualizada
if ($LASTEXITCODE -ne 0) { Reverter 'Falha ao solicitar o inicio da nova versao.' }
$url = 'http://127.0.0.1:3000'
try {
  $linha = @(Get-Content (Join-Path (Obter-PastaPrivada $Raiz) 'portal\configuracao\portal.env')) | Where-Object { $_ -like 'PORTAL_URL=*' } | Select-Object -First 1
  if ($linha) { $url = ($linha -split '=', 2)[1].Trim() }
} catch { }

$noAr = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep 2
  try { if ((Invoke-RestMethod "$url/api/health" -TimeoutSec 3).status -eq 'ok') { $noAr = $true; break } } catch { }
}
if (-not $noAr) { Reverter 'O Portal nao respondeu depois da atualizacao.' }

Etapa 'Conferindo interface e consumidores da operacao'
& $Node (Join-Path $Portal 'scripts/saude-operacao.mjs') $url
if ($LASTEXITCODE -ne 0) { Reverter 'Interface ou consumidores obrigatorios nao ficaram saudaveis.' }
& $Node --experimental-strip-types (Join-Path $Portal 'scripts/operacao-validacao.mjs') --liberar
if ($LASTEXITCODE -ne 0) { Reverter 'Falha ao liberar a operacao validada.' }
Ok "Portal e consumidores no ar em $url"
Write-Host "`n=== Atualizado: $($anterior.Substring(0,7)) -> $($remoto.Substring(0,7)) ===" -ForegroundColor Cyan
Gravar-EstadoOperacao $ContextoArquivo @{anterior=$anterior;remoto=$remoto;fase='concluido'}
git log -1 --pretty=format:'    %s'
Write-Host ''
exit 0
} catch {
  $falha = $_
  if ($CodigoTrocado -and !$Recuperando) {
    # Se o filho caiu depois de iniciar mas antes de tratar a falha, o pai
    # restaura tambem o banco. Contexto desconhecido exige a mesma cautela.
    if (!$JaAtualizado) {
      try { $NovaVersaoIniciada = (Ler-EstadoOperacao $ContextoArquivo).fase -ne 'codigo' }
      catch { $NovaVersaoIniciada = $true }
    }
    try { Reverter $falha.Exception.Message }
    catch { Write-Host "RECUPERACAO FALHOU: $($_.Exception.Message). Nao religue antes de conferir docs/SOCORRO.md." -ForegroundColor Red }
  } elseif (!$CodigoTrocado -and !$Recuperando -and $script:ParadaSolicitada) {
    # Inclui a parada incompleta: reabilita antes de tentar retomar.
    try { Recuperar-OperacaoAntesDaTroca $Raiz $script:TarefaSemLogin $OperacaoEstavaAtiva }
    catch { Write-Host "Falhou a retomada: $($_.Exception.Message). A tarefa deve permanecer habilitada." -ForegroundColor Red }
    if ($LASTEXITCODE -ne 0) { Write-Host 'Falhou a retomada da operacao original.' -ForegroundColor Red }
  }
  Write-Error $falha.Exception.Message -ErrorAction Continue
  exit 1
}
