# Executa o script inteiro em raiz descartavel; Git, processos, banco e rede
# sao simulados. Nenhum checkout/servico real participa deste ensaio de fases.
$ErrorActionPreference='Stop'
$raizReal=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$pasta=Join-Path ([IO.Path]::GetTempPath()) ('sv-recuperacao-'+[guid]::NewGuid().ToString('N'))
$privadoAnterior=$env:SUPPLY_VISION_PRIVADO
try {
  foreach($caso in @('legado','legado-repetido','prevoo','configuracao','credencial','npm','build','teste','partida','health','filho','restauracao')) {
    $raiz=Join-Path $pasta $caso
    foreach($dir in @('scripts','portal/scripts','alertas','compartilhado','privado/operacao','privado/portal/backups','privado/portal/configuracao','privado/comum')) { New-Item -ItemType Directory -Force (Join-Path $raiz $dir)|Out-Null }
    Copy-Item (Join-Path $raizReal 'scripts/operacao-logica.ps1') (Join-Path $raiz 'scripts')
    $fonte=Get-Content (Join-Path $raizReal 'scripts/atualizar-servidor.ps1') -Raw -Encoding UTF8
    # Injeta somente o executavel Python; o fluxo do atualizador e preservado.
    $fonte=$fonte.Replace("`$Python = Join-Path `$Alertas '.venv\Scripts\python.exe'", "`$Python = 'pythonmock'")
    [IO.File]::WriteAllText((Join-Path $raiz 'scripts/atualizar-servidor.ps1'),$fonte,(New-Object Text.UTF8Encoding($true)))
    Set-Content (Join-Path $raiz 'PARAR.bat') '@echo off'
    Set-Content (Join-Path $raiz 'INICIAR.bat') "@echo off`r`necho iniciou>>inicio.log`r`nexit /b 0"
    foreach($arq in @('portal/portal.env.example','compartilhado/smtp.env.example','compartilhado/operacao.env.example')) { Set-Content (Join-Path $raiz $arq) '' }
    foreach($arq in @('privado/comum/smtp.env','privado/comum/operacao.env')) { Set-Content (Join-Path $raiz $arq) '' }
    $env:SUPPLY_VISION_PRIVADO=Join-Path $raiz 'privado'
    . (Join-Path $raiz 'scripts/operacao-logica.ps1')
    Gravar-EstadoOperacao (Join-Path $env:SUPPLY_VISION_PRIVADO 'operacao/atualizacao.json') @{anterior=('1'*40);remoto=('2'*40);fase='codigo'}
    if($caso -eq 'legado-repetido'){Gravar-EstadoOperacao (Join-Path $env:SUPPLY_VISION_PRIVADO 'operacao/atualizacao.json') @{anterior=('1'*40);remoto=('2'*40);fase='revertido'}}
    if($caso -eq 'legado'){Remove-Item -LiteralPath (Join-Path $env:SUPPLY_VISION_PRIVADO 'operacao/atualizacao.json')}
    Set-Content (Join-Path $raiz 'privado/portal/backups/portal-atual.sqlite') 'snapshot ficticio'
    Set-Content (Join-Path $raiz 'privado/portal/backups/pre-atualizacao.sqlite') 'snapshot ficticio'
    if($caso -ne 'configuracao') { Set-Content (Join-Path $raiz 'privado/portal/configuracao/portal.env') ('PORTAL_API_TOKEN='+('a'*64)) }
    if($caso -eq 'credencial') { Set-Content (Join-Path $raiz 'privado/portal/configuracao/portal.env') ''; Set-ItemProperty (Join-Path $raiz 'privado/portal/configuracao/portal.env') -Name IsReadOnly -Value $true }
    $runner=@'
param($Caso,$Raiz)
$ErrorActionPreference='Stop'
$global:builds=0;$global:resetou=$false
function git {
  $global:LASTEXITCODE=0
  switch($args[0]) {
    'status' { if($Caso -eq 'prevoo'){ ' M arquivo' } }
    'branch' { 'main' }
    'rev-parse' { if($Caso -eq 'filho' -and !$global:novo -and $args[-1] -eq 'HEAD'){'1'*40}else{'2'*40} }
    'log' { 'Sintetico' }
    'reset' { $global:resetou=$true; Add-Content (Join-Path $Raiz 'reset.log') 'reset' }
    'merge' { $global:novo=$true }
  }
}
function Get-NetTCPConnection {}
function Start-Sleep {}
function Invoke-RestMethod { throw 'health indisponivel' }
function node {
  $global:LASTEXITCODE=0
  if($args[0] -like '*restaurar-backup*') { Add-Content (Join-Path $Raiz 'restore.log') 'restore'; if($Caso -eq 'restauracao'){$global:LASTEXITCODE=1} }
}
function npm {
  $global:LASTEXITCODE=0
  if(!$global:resetou -and (($Caso -eq 'npm' -and $args[0] -eq 'ci') -or ($Caso -in @('build','legado','legado-repetido') -and $args[1] -eq 'build') -or ($Caso -eq 'teste' -and $args[0] -eq 'test'))) {$global:LASTEXITCODE=1}
}
function pythonmock { $global:LASTEXITCODE=0; if($args[0] -eq '--version'){'Python 3.12.0'} }
function npm.cmd { npm @args }
function powershell.exe {
  $global:LASTEXITCODE=0
  if($Caso -eq 'filho') {
    Gravar-EstadoOperacao (Join-Path $env:SUPPLY_VISION_PRIVADO 'operacao/atualizacao.json') @{anterior=('1'*40);remoto=('2'*40);fase='iniciada'}
    $global:LASTEXITCODE=1
  }
}
. (Join-Path $Raiz 'scripts/operacao-logica.ps1')
if($Caso -eq 'filho') { & (Join-Path $Raiz 'scripts/atualizar-servidor.ps1') }
else { & (Join-Path $Raiz 'scripts/atualizar-servidor.ps1') -JaAtualizado -VersaoAnterior ('1'*40) -Reaplicar }
exit $LASTEXITCODE
'@
    [IO.File]::WriteAllText((Join-Path $raiz 'runner.ps1'),$runner)
    if($caso -eq 'partida') { Set-Content (Join-Path $raiz 'INICIAR.bat') "@echo off`r`necho iniciou>>inicio.log`r`nif not exist falhou.log (echo falha>falhou.log & exit /b 1)`r`nexit /b 0" }
    $preferencia=$ErrorActionPreference;$ErrorActionPreference='Continue'
    try { $saida=@(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $raiz 'runner.ps1') $caso $raiz 2>&1);$rc=$LASTEXITCODE } finally { $ErrorActionPreference=$preferencia }
    if($rc -eq 0) { throw "Falha $caso foi declarada sucesso: $saida" }
    $resets=@(Get-Content (Join-Path $raiz 'reset.log') -ErrorAction SilentlyContinue)
    if($resets.Count -ne $(if($caso -eq 'restauracao'){0}else{1})) { throw "Caso $caso nao reverteu exatamente uma vez: $saida" }
    $restaurou=Test-Path (Join-Path $raiz 'restore.log')
    if($restaurou -ne ($caso -in @('partida','health','filho','restauracao'))) { throw "Restauracao incorreta em ${caso}: $saida" }
    $fase=(Ler-EstadoOperacao (Join-Path $env:SUPPLY_VISION_PRIVADO 'operacao/atualizacao.json')).fase
    if($fase -ne $(if($caso -eq 'restauracao'){'recuperando'}else{'revertido'})) { throw "Recuperacao incompleta em ${caso}: $saida" }
    if($caso -eq 'restauracao' -and @(Get-Content (Join-Path $raiz 'inicio.log')).Count -ne 1) { throw 'Banco inseguro foi religado.' }
    Write-Host "[OK] Recuperacao: $caso"
  }
} finally {
  $env:SUPPLY_VISION_PRIVADO=$privadoAnterior
  if(Test-Path -LiteralPath $pasta){Get-ChildItem -LiteralPath $pasta -Recurse -File | ForEach-Object { $_.IsReadOnly=$false };Remove-Item -LiteralPath $pasta -Recurse -Force}
}
