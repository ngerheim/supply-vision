# Executa o atualizador inteiro com dependencias externas simuladas.
# Worktree/artefatos/dados sao fixtures novas; nunca consulta uma instalacao real.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'atualizacao-preparo.ps1')
$fonteRaiz=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$base=Join-Path ([IO.Path]::GetTempPath()) ('sv-fases-'+[guid]::NewGuid().ToString('N'))
$hostTeste=(Get-Process -Id $PID).Path
$privadoAntes=$env:SUPPLY_VISION_PRIVADO
try{
 foreach($caso in @('ci-reprovado','preparo-falha','preparo-limpeza-falha','sucesso','fumaca-falha','troca-parcial','rede-falha','ensaio','medicao-ausente','relogio-falha','medicao-falha','fumaca-sem-medicao','fumaca-relogio-falha')){
  $raiz=Join-Path $base $caso
  foreach($dir in @('scripts','portal/scripts','portal/dist','portal/node_modules','alertas/.venv','privado/operacao','privado/portal/backups','privado/portal/configuracao','privado/comum','compartilhado')){New-Item -ItemType Directory -Force (Join-Path $raiz $dir)|Out-Null}
  Copy-Item (Join-Path $fonteRaiz 'scripts/operacao-logica.ps1') (Join-Path $raiz 'scripts')
  Copy-Item (Join-Path $fonteRaiz 'scripts/atualizacao-preparo.ps1') (Join-Path $raiz 'scripts')
  Add-Content (Join-Path $raiz 'scripts/atualizacao-preparo.ps1') 'function Iniciar-LimpezaPreparoSegundoPlano($Raiz,$Preparo,$Operacao){ Limpar-PastaPreparo $Raiz $Preparo }'
  Add-Content (Join-Path $raiz 'scripts/atualizacao-preparo.ps1') 'function Executar-PowerShellOculto($Argumentos){ & powershell.exe @Argumentos }'
  if($caso-eq'preparo-limpeza-falha'){Add-Content (Join-Path $raiz 'scripts/atualizacao-preparo.ps1') "function Remover-ArvorePreparo {throw 'Handle ficticio impediu limpeza.'}"}
  $fonte=[IO.File]::ReadAllText((Join-Path $fonteRaiz 'scripts/atualizar-servidor.ps1'))
  $fonte=$fonte.Replace("`$Python = Join-Path `$Alertas '.venv\Scripts\python.exe'", "`$Python = 'pythonmock'")
  $fonte=$fonte.Replace('Start-Process powershell.exe -WindowStyle Hidden -ArgumentList', 'IniciarMock -ArgumentList')
  if($caso-in@('medicao-ausente','fumaca-sem-medicao')){
   # Perde contexto antes de PARAR, exportacao e health, inclusive no filho.
   $fonte=$fonte.Replace('Parar-OperacaoAtualizacao $PrazoParadaSegundos',('$script:MedicaoAtualizacao=$null; Parar-OperacaoAtualizacao $PrazoParadaSegundos'))
   $fonte=$fonte.Replace('$env:SV_MEDICAO_ATUALIZACAO=Exportar-MedicaoAtualizacao',('$script:MedicaoAtualizacao=$null; $env:SV_MEDICAO_ATUALIZACAO=Exportar-MedicaoAtualizacao'))
   $fonte=$fonte.Replace('Ok "Portal e consumidores no ar em $url"',('$script:MedicaoAtualizacao=$null; Ok "Portal e consumidores no ar em $url"'))
  }
  if($caso-in@('relogio-falha','fumaca-relogio-falha')){
   $fonte=$fonte.Replace('$script:MedicaoAtualizacao=$null',('$script:MedicaoAtualizacao=@{relogio={throw "relogio ficticio falhou"}}'))
  }
  if($caso-eq'medicao-falha'){
   $comeco=$fonte.IndexOf('function Nova-MedicaoAtualizacao')
   $corpo=$fonte.IndexOf("`n",$comeco)+1
   $fonte=$fonte.Insert($corpo," throw 'inicializacao da medicao falhou'`n")
  }
  [IO.File]::WriteAllText((Join-Path $raiz 'scripts/atualizar-servidor.ps1'),$fonte)
  foreach($arquivo in @('portal/portal.env.example','compartilhado/smtp.env.example','compartilhado/operacao.env.example','privado/comum/smtp.env','privado/comum/operacao.env')){[IO.File]::WriteAllText((Join-Path $raiz $arquivo),'')}
  [IO.File]::WriteAllText((Join-Path $raiz 'privado/portal/configuracao/portal.env'),('PORTAL_API_TOKEN='+('a'*64)))
  $configsAntes=@{}
  if($caso-in@('ci-reprovado','preparo-falha','preparo-limpeza-falha')){
   foreach($tipo in @('smtp','operacao')){
    # Defaults faltantes tornariam observavel qualquer reparo antes de TROCAR.
    [IO.File]::WriteAllText((Join-Path $raiz "compartilhado/$tipo.env.example"),'CHAVE_NOVA=padrao')
    $arquivoConfig=Join-Path $raiz "privado/comum/$tipo.env"
    $configsAntes[$arquivoConfig]=(Get-FileHash $arquivoConfig -Algorithm SHA256).Hash
   }
  }
  foreach($rel in @('portal/dist','portal/node_modules','alertas/.venv')){[IO.File]::WriteAllText((Join-Path $raiz "$rel/versao"),'anterior')}
  if($caso-eq'ensaio'){[IO.File]::WriteAllText((Join-Path $raiz 'privado/comum/operacao.env'),'MODO_ENSAIO=1')}
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
  '-C' {if($args[2]-eq'worktree'-and$args[3]-eq'remove'){if(Test-Path $global:preparo){Remove-Item -LiteralPath $global:preparo -Recurse -Force};Registrar 'limpeza'}}
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
 if($args -contains '--somente-rede'){if($Caso-eq'ensaio'-and$env:MODO_ENSAIO-ne'1'){throw 'Backup perdeu modo ensaio.'};Registrar 'backup-rede';if($Caso-eq'rede-falha'){$global:LASTEXITCODE=3}}
 if(($args-join' ')-like'*restaurar-backup*'){Registrar 'banco-restaurado';Copy-Item (Join-Path $Raiz 'privado/portal/backups/portal-atual.sqlite') (Join-Path $Raiz 'privado/banco-ficticio') -Force}
 if(($args-join' ')-like'*saude-operacao*'){
  Registrar 'fumaca'
  if($Caso-in@('fumaca-falha','fumaca-sem-medicao','fumaca-relogio-falha')-and!$global:resetou){$global:LASTEXITCODE=1}
 }
}
function Invoke-RestMethod {@{status='ok'}}
function npm.cmd {throw 'Build/instalacao/testes nao podem rodar durante TROCAR.'}
function powershell.exe {
 $global:LASTEXITCODE=0
 if($args -contains '-Instalacao'){
  Registrar 'preparar'
  if($Caso-eq'ci-reprovado'){
   $a=Ler-AndamentoAtualizacao (Join-Path (Obter-PastaPrivada $Raiz) 'operacao/atualizacao-andamento.json')
   $a.erro='CI da main reprovado: Portal (failure). re-run no GitHub, PR de correcao ou supv atualizar --completo.'
   Publicar-AndamentoAtualizacao $a 'PREPARAR reprovado' 'falhou'
   $global:LASTEXITCODE=1;return
  }
  if($Caso-in@('preparo-falha','preparo-limpeza-falha')){$global:LASTEXITCODE=1;return}
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
  # O lancador drena stderr como texto sem NativeCommandError no PS 5.1.
  $saida=@(Executar-PowerShellOculto @('-NoProfile','-File',(Join-Path $raiz 'runner.ps1'),$caso,$raiz) $hostTeste);$rc=$LASTEXITCODE
  $passos=@(Get-Content (Join-Path $raiz 'passos.txt'))
  if(($rc-eq0)-ne($caso-in@('sucesso','rede-falha','ensaio','medicao-ausente','relogio-falha','medicao-falha'))){throw "Resultado incorreto em $caso (rc=$rc): $saida"}
  foreach($rel in @('portal/dist','portal/node_modules','alertas/.venv')){
   $esperado=if($caso-in@('sucesso','rede-falha','ensaio','medicao-ausente','relogio-falha','medicao-falha')){'nova'}else{'anterior'}
   if((Get-Content (Join-Path $raiz "$rel/versao"))-ne$esperado){throw "Artefato incorreto: $caso / $rel; $saida"}
  }
  if($caso-in@('ci-reprovado','preparo-falha','preparo-limpeza-falha')){
   if($passos-contains'backup-local'-or$passos-contains'commit-novo'-or(Test-Path (Join-Path $raiz 'privado/operacao/parar.sinal'))){throw 'Preparo reprovado parou/alterou a instalacao.'}
   foreach($arquivoConfig in $configsAntes.Keys){
    if((Get-FileHash $arquivoConfig -Algorithm SHA256).Hash-ne$configsAntes[$arquivoConfig]){throw 'PREPARAR alterou bytes da configuracao da instalacao.'}
   }
   $contexto=Get-Content (Join-Path $raiz 'privado/operacao/atualizacao.json') -Raw|ConvertFrom-Json
   $limpeza=if($caso-ne'preparo-limpeza-falha'){'concluida'}else{'pendente'}
   if($contexto.fase-ne'cancelado-preparo'-or$contexto.limpeza-ne$limpeza-or((Test-Path $contexto.preparo)-ne($limpeza-eq'pendente'))){throw 'Cancelamento/limpeza do PREPARAR nao registrados.'}
   $a=Ler-AndamentoAtualizacao (Join-Path $raiz 'privado/operacao/atualizacao-andamento.json')
   if($a.estado-ne'falhou'-or$a.nome-ne'PREPARAR reprovado'-or($saida-join' ')-like'*== PREPARAR / Aprovacao e conferencia ==*'){throw 'PREPARAR reprovado continuou o andamento.'}
   if($caso-eq'ci-reprovado'){
    $a=Ler-AndamentoAtualizacao (Join-Path $raiz 'privado/operacao/atualizacao-andamento.json')
    if($a.erro-notlike'*Portal (failure)*supv atualizar --completo*'-or$contexto.erro-ne$a.erro){throw 'Atualizador perdeu check ou alternativas do CI reprovado.'}
   }
   if($limpeza-eq'pendente'){
    if(($saida-join' ')-notlike'*Handle ficticio impediu limpeza*'){throw 'Aviso de limpeza pendente perdeu causa.'}
    Remover-ArvorePreparo $contexto.preparo
   }
  }elseif($caso-in@('sucesso','rede-falha','ensaio','medicao-ausente','relogio-falha','medicao-falha')){
   if([array]::IndexOf($passos,'backup-rede')-lt[array]::IndexOf($passos,'fumaca')-or$passos-notcontains'reexecucao'){throw 'Rede fora da fase CONCLUIR ou faltou reexecucao.'}
  }else{
   if($passos-notcontains'commit-anterior'){throw 'Commit nao foi revertido.'}
   if(($passos-contains'banco-restaurado')-ne($caso-in@('fumaca-falha','fumaca-sem-medicao','fumaca-relogio-falha'))){throw 'Restauracao de snapshot incorreta.'}
  }
  $bancoEsperado=if($caso-in@('sucesso','rede-falha','ensaio','medicao-ausente','relogio-falha','medicao-falha')){'banco-migrado'}else{'banco-anterior'}
  if((Get-Content (Join-Path $raiz 'privado/banco-ficticio'))-ne$bancoEsperado){throw 'Snapshot nao foi restaurado completamente.'}
  if(@(Get-ChildItem -LiteralPath $base -Force|Where-Object Name -Like ".${caso}-preparo-*").Count){throw 'Preparo nao foi limpo.'}
  Write-Host "[OK] Fases H1: $caso"
 }
}finally{$env:SUPPLY_VISION_PRIVADO=$privadoAntes;if(Test-Path $base){Remove-Item $base -Recurse -Force}}

$global:LASTEXITCODE=0

& (Join-Path $PSScriptRoot 'testar-atualizacao-sem-parada.ps1')
