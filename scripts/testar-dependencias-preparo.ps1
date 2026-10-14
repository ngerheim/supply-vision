# Roda o preparador real com executaveis simulados e dados descartaveis.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'atualizacao-preparo.ps1')
$fonteRaiz=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$base=Join-Path ([IO.Path]::GetTempPath()) ('sv-deps-'+[guid]::NewGuid().ToString('N'))
$hostTeste=(Get-Process -Id $PID).Path
$privadoAntes=$env:SUPPLY_VISION_PRIVADO
try{
 foreach($caso in @('inalteradas','alteradas','build-falha','portal-falha','alertas-falha','operacional-falha')){
  $instalacao=Join-Path $base $caso
  $preparo=Nova-PastaPreparo $instalacao
  foreach($dir in @('portal/node_modules','alertas/.venv/Scripts','privado')){New-Item -ItemType Directory -Force (Join-Path $instalacao $dir)|Out-Null}
  foreach($dir in @('scripts','portal','compartilhado','alertas/config','alertas/parametros/de_para','alertas/parametros/filtros')){New-Item -ItemType Directory -Force (Join-Path $preparo $dir)|Out-Null}
  foreach($nome in @('atualizacao-preparo.ps1','preparar-configuracao-teste.ps1','operacao-logica.ps1')){Copy-Item (Join-Path $PSScriptRoot $nome) (Join-Path $preparo 'scripts')}
  Add-Content (Join-Path $preparo 'scripts/atualizacao-preparo.ps1') 'function Executar-PowerShellOculto($Argumentos){ & powershell.exe @Argumentos }'
  $codigo=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'preparar-atualizacao.ps1'))
  $codigo=$codigo.Replace('Validar-PythonAlertas','ValidarPythonMock')
  $codigo=$codigo.Replace("& (Join-Path `$alertas '.venv/Scripts/python.exe')",'& pythonmock')
  [IO.File]::WriteAllText((Join-Path $preparo 'scripts/preparar-atualizacao.ps1'),$codigo)
  Copy-Item (Join-Path $fonteRaiz 'portal/portal.env.example') (Join-Path $preparo 'portal')
  Copy-Item (Join-Path $fonteRaiz 'compartilhado/*.env.example') (Join-Path $preparo 'compartilhado')
  Copy-Item (Join-Path $fonteRaiz 'alertas/config/*.exemplo.txt') (Join-Path $preparo 'alertas/config')
  Copy-Item (Join-Path $fonteRaiz 'alertas/parametros/de_para/*.exemplo.csv') (Join-Path $preparo 'alertas/parametros/de_para')
  Copy-Item (Join-Path $fonteRaiz 'alertas/parametros/filtros/*.exemplo.txt') (Join-Path $preparo 'alertas/parametros/filtros')
  [IO.File]::WriteAllText((Join-Path $instalacao 'privado/sentinela'),'producao ficticia')
  [IO.File]::WriteAllText((Join-Path $instalacao 'portal/node_modules/versao'),'reutilizada')
  [IO.File]::WriteAllText((Join-Path $instalacao 'alertas/.venv/Scripts/python.exe'),'reutilizada')
  $env:SUPPLY_VISION_PRIVADO=Join-Path $instalacao 'privado'
  $runner=@'
param($Caso,$Instalacao,$Preparo)
$ErrorActionPreference='Stop'
function ValidarPythonMock {}
function Registrar($Texto){Add-Content (Join-Path $Preparo 'passos.txt') $Texto}
function Conferir-Isolamento {
 if($env:SUPPLY_VISION_PRIVADO-ne(Join-Path $Preparo 'privado')-or$env:MODO_ENSAIO-ne'1'-or$env:PORTAL_BANCO_LOCAL-ne'sqlite'){throw 'Ambiente de producao herdado.'}
}
function git {$global:LASTEXITCODE=0;'2'*40}
function npm.cmd {
 Conferir-Isolamento;$global:LASTEXITCODE=0
 switch($args[0]){
  'ci' {Registrar 'npm-ci';New-Item -ItemType Directory -Force (Join-Path $Preparo 'portal/node_modules')|Out-Null;[IO.File]::WriteAllText((Join-Path $Preparo 'portal/node_modules/versao'),'instalada')}
  'run' {Registrar 'build';if($Caso-eq'build-falha'){$global:LASTEXITCODE=1}}
  'test' {Registrar 'portal';if($Caso-eq'portal-falha'){$global:LASTEXITCODE=1}}
 }
}
function python.exe {
 Conferir-Isolamento;Registrar 'venv';$global:LASTEXITCODE=0
 New-Item -ItemType Directory -Force (Join-Path $Preparo 'alertas/.venv/Scripts')|Out-Null
 [IO.File]::WriteAllText((Join-Path $Preparo 'alertas/.venv/Scripts/python.exe'),'instalada')
}
function pythonmock {
 Conferir-Isolamento;$global:LASTEXITCODE=0
 if($args-contains'pip'){Registrar 'pip'}else{Registrar 'alertas';if($Caso-eq'alertas-falha'){$global:LASTEXITCODE=1}}
}
function powershell.exe {
 Conferir-Isolamento;$global:LASTEXITCODE=0
 if($args-notcontains'Hidden'){throw 'Teste abriu janela.'}
 Registrar ('operacional:'+(Split-Path $args[-1] -Leaf))
 if($Caso-eq'operacional-falha'){$global:LASTEXITCODE=1}
}
if($Caso-eq'alteradas'){& (Join-Path $Preparo 'scripts/preparar-atualizacao.ps1') -Instalacao $Instalacao -ReinstalarNode -ReinstalarPython}
else{& (Join-Path $Preparo 'scripts/preparar-atualizacao.ps1') -Instalacao $Instalacao}
exit $LASTEXITCODE
'@
  $arquivoRunner=Join-Path $preparo 'runner.ps1';[IO.File]::WriteAllText($arquivoRunner,$runner)
  # Falhas provocadas escrevem em stderr; o codigo de saida decide o resultado.
  $saida=@(Executar-PowerShellOculto @('-NoProfile','-File',$arquivoRunner,$caso,$instalacao,$preparo) $hostTeste);$rc=$LASTEXITCODE
  $passos=@(Get-Content (Join-Path $preparo 'passos.txt'))
  if(($rc-eq0)-ne($caso-in@('inalteradas','alteradas'))){throw "Preparo incorreto em $caso (rc=$rc): $saida"}
  if(($passos-contains'npm-ci')-ne($caso-eq'alteradas')-or($passos-contains'pip')-ne($caso-eq'alteradas')){throw "Decisao de dependencias incorreta: $caso"}
  if($rc-eq0-and@($passos|Where-Object {$_-like'operacional:*'}).Count-ne4){throw 'Removeu verificacao operacional.'}
  if((Test-Path (Join-Path $preparo 'preparo-aprovado'))-ne($rc-eq0)){throw 'Preparo reprovado foi aprovado.'}
  if((Get-Content (Join-Path $instalacao 'privado/sentinela'))-ne'producao ficticia'-or(Get-Content (Join-Path $instalacao 'portal/node_modules/versao'))-ne'reutilizada'){throw 'Preparo alterou instalacao.'}
  Write-Host "[OK] Dependencias e isolamento H1: $caso"
 }
}finally{$env:SUPPLY_VISION_PRIVADO=$privadoAntes;if(Test-Path $base){Remove-Item $base -Recurse -Force}}

$global:LASTEXITCODE=0
