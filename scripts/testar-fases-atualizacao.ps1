# Executa o atualizador inteiro com dependencias externas simuladas.
# Worktree/artefatos/dados sao fixtures novas; nunca consulta uma instalacao real.
$ErrorActionPreference='Stop'
$fonteRaiz=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$base=Join-Path ([IO.Path]::GetTempPath()) ('sv-fases-'+[guid]::NewGuid().ToString('N'))
$hostTeste=(Get-Process -Id $PID).Path
$privadoAntes=$env:SUPPLY_VISION_PRIVADO
try{
 foreach($caso in @('preparo-falha','sucesso','fumaca-falha','troca-parcial','rede-falha')){
  $raiz=Join-Path $base $caso
  foreach($dir in @('scripts','portal/scripts','portal/dist','portal/node_modules','alertas/.venv','privado/operacao','privado/portal/backups','privado/portal/configuracao','privado/comum','compartilhado')){New-Item -ItemType Directory -Force (Join-Path $raiz $dir)|Out-Null}
  Copy-Item (Join-Path $fonteRaiz 'scripts/operacao-logica.ps1') (Join-Path $raiz 'scripts')
  Copy-Item (Join-Path $fonteRaiz 'scripts/atualizacao-preparo.ps1') (Join-Path $raiz 'scripts')
  Add-Content (Join-Path $raiz 'scripts/atualizacao-preparo.ps1') 'function Executar-PowerShellOculto($Argumentos){ & powershell.exe @Argumentos }'
  $fonte=[IO.File]::ReadAllText((Join-Path $fonteRaiz 'scripts/atualizar-servidor.ps1'))
  $fonte=$fonte.Replace("`$Python = Join-Path `$Alertas '.venv\Scripts\python.exe'", "`$Python = 'pythonmock'")
  $fonte=$fonte.Replace("& (Join-Path `$Raiz 'INICIAR.bat') | Out-Null",'IniciarMock')
  [IO.File]::WriteAllText((Join-Path $raiz 'scripts/atualizar-servidor.ps1'),$fonte)
  foreach($arquivo in @('portal/portal.env.example','compartilhado/smtp.env.example','compartilhado/operacao.env.example','privado/comum/smtp.env','privado/comum/operacao.env')){[IO.File]::WriteAllText((Join-Path $raiz $arquivo),'')}
  [IO.File]::WriteAllText((Join-Path $raiz 'privado/portal/configuracao/portal.env'),('PORTAL_API_TOKEN='+('a'*64)))
  foreach($rel in @('portal/dist','portal/node_modules','alertas/.venv')){[IO.File]::WriteAllText((Join-Path $raiz "$rel/versao"),'anterior')}
  [IO.File]::WriteAllText((Join-Path $raiz 'privado/banco-ficticio'),'banco-anterior')
  $env:SUPPLY_VISION_PRIVADO=Join-Path $raiz 'privado'
  $runner=@'
param($Caso,$Raiz)
$ErrorActionPreference='Stop'
$global:novo=$false;$global:resetou=$false;$global:preparo=''
function Registrar($Texto){Add-Content (Join-Path $Raiz 'passos.txt') $Texto}
function git {
 $global:LASTEXITCODE=0
 switch($args[0]){
  'branch' {'main'}
  'rev-parse' {if($args[-1]-eq'origin/main'-or$global:novo){'2'*40}else{'1'*40}}
  'log' {'fixture'}
  'merge' {$global:novo=$true;Registrar 'commit-novo'}
  'reset' {$global:resetou=$true;Registrar 'commit-anterior'}
  'worktree' {
   if($args[1]-eq'add'){$global:preparo=$args[3];New-Item -ItemType Directory -Force $global:preparo|Out-Null}
  }
  '-C' {if($args[2]-eq'worktree'){Remove-Item -LiteralPath $global:preparo -Recurse -Force;Registrar 'limpeza'}}
 }
}
function Localizar-NodeMaquina {'node'}
function Testar-SupervisorEncerrado {$false}
function Get-NetTCPConnection {}
function Start-Sleep {}
function pythonmock {$global:LASTEXITCODE=0;'Python 3.12.0'}
function IniciarMock {$global:LASTEXITCODE=0;Registrar 'iniciar';if(!$global:resetou){[IO.File]::WriteAllText((Join-Path $Raiz 'privado/banco-ficticio'),'banco-migrado')}}
function node {
 $global:LASTEXITCODE=0
 if($args -contains '--somente-local'){Registrar 'backup-local';Copy-Item (Join-Path $Raiz 'privado/banco-ficticio') (Join-Path $Raiz 'privado/portal/backups/portal-atual.sqlite')}
 if($args -contains '--somente-rede'){Registrar 'backup-rede';if($Caso-eq'rede-falha'){$global:LASTEXITCODE=3}}
 if(($args-join' ')-like'*restaurar-backup*'){Registrar 'banco-restaurado';Copy-Item (Join-Path $Raiz 'privado/portal/backups/portal-atual.sqlite') (Join-Path $Raiz 'privado/banco-ficticio') -Force}
 if(($args-join' ')-like'*saude-operacao*'){
  Registrar 'fumaca'
  if($Caso-eq'fumaca-falha'-and!$global:resetou){$global:LASTEXITCODE=1}
 }
}
function Invoke-RestMethod {@{status='ok'}}
function npm.cmd {throw 'Build/instalacao/testes nao podem rodar durante TROCAR.'}
function powershell.exe {
 $global:LASTEXITCODE=0
 if($args -contains '-Instalacao'){
  Registrar 'preparar'
  if($Caso-eq'preparo-falha'){$global:LASTEXITCODE=1;return}
  foreach($rel in @('portal/dist','portal/node_modules','alertas/.venv')){
   if($Caso-eq'troca-parcial'-and$rel-eq'alertas/.venv'){continue}
   New-Item -ItemType Directory -Force (Join-Path $global:preparo $rel)|Out-Null
   [IO.File]::WriteAllText((Join-Path $global:preparo "$rel/versao"),'nova')
  }
  [IO.File]::WriteAllText((Join-Path $global:preparo 'preparo-aprovado'),('2'*40))
 }elseif($args-contains'-JaAtualizado'){
  Registrar 'reexecucao'
  & (Join-Path $Raiz 'scripts/atualizar-servidor.ps1') -JaAtualizado -VersaoAnterior ('1'*40)
 }
}
& (Join-Path $Raiz 'scripts/atualizar-servidor.ps1')
exit $LASTEXITCODE
'@
  [IO.File]::WriteAllText((Join-Path $raiz 'runner.ps1'),$runner)
  $saida=@(& $hostTeste -NoProfile -File (Join-Path $raiz 'runner.ps1') $caso $raiz 2>&1);$rc=$LASTEXITCODE
  $passos=@(Get-Content (Join-Path $raiz 'passos.txt'))
  if(($rc-eq0)-ne($caso-in@('sucesso','rede-falha'))){throw "Resultado incorreto em $caso (rc=$rc): $saida"}
  foreach($rel in @('portal/dist','portal/node_modules','alertas/.venv')){
   $esperado=if($caso-in@('sucesso','rede-falha')){'nova'}else{'anterior'}
   if((Get-Content (Join-Path $raiz "$rel/versao"))-ne$esperado){throw "Artefato incorreto: $caso / $rel; $saida"}
  }
  if($caso-eq'preparo-falha'){
   if($passos-contains'backup-local'-or$passos-contains'commit-novo'-or(Test-Path (Join-Path $raiz 'privado/operacao/parar.sinal'))){throw 'Preparo reprovado parou/alterou a instalacao.'}
  }elseif($caso-in@('sucesso','rede-falha')){
   if($passos.IndexOf('backup-rede')-lt$passos.IndexOf('fumaca')-or$passos-notcontains'reexecucao'){throw 'Rede fora da fase CONCLUIR ou faltou reexecucao.'}
  }else{
   if($passos-notcontains'commit-anterior'){throw 'Commit nao foi revertido.'}
   if(($passos-contains'banco-restaurado')-ne($caso-eq'fumaca-falha')){throw 'Restauracao de snapshot incorreta.'}
  }
  $bancoEsperado=if($caso-in@('sucesso','rede-falha')){'banco-migrado'}else{'banco-anterior'}
  if((Get-Content (Join-Path $raiz 'privado/banco-ficticio'))-ne$bancoEsperado){throw 'Snapshot nao foi restaurado completamente.'}
  if(@(Get-ChildItem -LiteralPath $base -Force|Where-Object Name -Like ".${caso}-preparo-*").Count){throw 'Preparo nao foi limpo.'}
  Write-Host "[OK] Fases H1: $caso"
 }
}finally{$env:SUPPLY_VISION_PRIVADO=$privadoAntes;if(Test-Path $base){Remove-Item $base -Recurse -Force}}

$global:LASTEXITCODE=0
