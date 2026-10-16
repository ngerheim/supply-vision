# Git real em repositorios ficticios. Os sentinelas impedem preparo/servicos reais.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'atualizacao-preparo.ps1')
$fonteRaiz=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$fonte=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'atualizar-servidor.ps1'))
$ast=[Management.Automation.Language.Parser]::ParseInput($fonte,[ref]$null,[ref]$null)
foreach($nome in @('Testar-CaminhoSemParada','Testar-AtualizacaoSemParada','Esperar-PortalAtualizado')){
 $funcao=$ast.Find({param($n) $n-is[Management.Automation.Language.FunctionDefinitionAst]-and$n.Name-eq$nome},$true)
 . ([scriptblock]::Create($funcao.Extent.Text))
}
function Exigir-SemParada($Ok,[string]$Mensagem){if(!$Ok){throw $Mensagem}}
function Git-Fixture([string]$Pasta,[string[]]$Argumentos){
 $preferencia=$ErrorActionPreference
 $ErrorActionPreference='Continue'
 try{$saida=@(& git -C $Pasta @Argumentos 2>&1);$codigo=$LASTEXITCODE}
 finally{$ErrorActionPreference=$preferencia}
 if($codigo){throw ('Git fixture falhou: '+($saida-join' '))}
 return $saida
}
$base=Join-Path ([IO.Path]::GetTempPath()) ('sv-sem-parada-'+[guid]::NewGuid().ToString('N'))
$hostTeste=(Get-Process -Id $PID).Path
$privadoAntes=$env:SUPPLY_VISION_PRIVADO;$completoAntes=$env:SV_PREPARO_COMPLETO
try{
 $env:SV_PREPARO_COMPLETO='0'
 foreach($permitido in @('README.md','docs/guia.md','.github/workflows/ci.yml','portal/tests/apoio/fixture.ts','alertas/tests/test_fixture.py','testes/fixtures/env.json','scripts/testar-novo.ps1','scripts/ci/fixar.ps1')){
  Exigir-SemParada (Testar-CaminhoSemParada $permitido) "Caminho permitido rejeitado: $permitido"
 }
 foreach($normal in @('portal/lib/domain.ts','scripts/supervisor.ps1','portal/tests-fora/fixture.ts','scripts/testar-novo.ps1/outro','../README.md','/README.md','DOC.MD','"README.md"')){
  Exigir-SemParada (!(Testar-CaminhoSemParada $normal)) "Caminho fora da lista aceito: $normal"
 }
 foreach($caso in @('docs','misto','importado','importado-anterior','importado-novo','import-ts','import-python','dot-source','renomeado-fora','renomeado-dentro','vazio','teste','ci','reaplicar','completo','simular','merge-falha','consulta-falha','grep-sem-match','grep-erro','grep-padrao-corrompido','link')){
  $semente=Join-Path $base ($caso+'-origem');$raiz=Join-Path $base ($caso+' instalacao')
  New-Item -ItemType Directory -Force (Join-Path $semente 'scripts'),(Join-Path $semente 'portal/lib')|Out-Null
  foreach($nome in @('atualizar-servidor','operacao-logica','atualizacao-preparo')){Copy-Item (Join-Path $PSScriptRoot ($nome+'.ps1')) (Join-Path $semente 'scripts')}
  Add-Content (Join-Path $semente 'scripts/operacao-logica.ps1') "`nfunction Localizar-NodeMaquina {return 'node'}`nfunction Parar-Operacao {throw 'PARADA PROIBIDA'}" -Encoding UTF8
  Add-Content (Join-Path $semente 'scripts/atualizacao-preparo.ps1') "`nfunction Nova-PastaPreparo {throw 'FLUXO NORMAL'}" -Encoding UTF8
  Add-Content (Join-Path $semente 'scripts/atualizacao-preparo.ps1') @'
$script:publicarReal=(Get-Command Publicar-AndamentoAtualizacao).ScriptBlock
function Publicar-AndamentoAtualizacao($Andamento,$Nome,$Estado='andamento'){
 [void][IO.Directory]::CreateDirectory((Obter-PastaPrivada ''))
 Add-Content (Join-Path (Obter-PastaPrivada '') 'publicacoes.txt') $Nome
 & $script:publicarReal $Andamento $Nome $Estado
}
'@ -Encoding UTF8
  [IO.File]::WriteAllText((Join-Path $semente 'README.md'),'documentacao ficticia anterior')
  $consumidor=if($caso-in@('importado','importado-anterior')){"import texto from '../../README.md';"}elseif($caso-eq'dot-source'){". (Join-Path `$PSScriptRoot '../../scripts/testar-fixture.ps1')"}else{'export const fixture=1;'}
  if($caso-eq'import-ts'){$consumidor="import { fixture } from '../tests/apoio-fixture';"}
  if($caso-eq'import-python'){$consumidor='from tests.modulo_fixture import fixture'}
  [IO.File]::WriteAllText((Join-Path $semente 'portal/lib/fixture.mjs'),$consumidor)
  [void](Git-Fixture $semente @('init','-q','-b','main'))
  [void](Git-Fixture $semente @('config','--local','core.autocrlf','false'))
  [void](Git-Fixture $semente @('config','--local','core.safecrlf','false'))
  [void](Git-Fixture $semente @('add','.'))
  [void](Git-Fixture $semente @('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','anterior'))
  $anterior=@(Git-Fixture $semente @('rev-parse','HEAD'))[0]
  [void](Git-Fixture $base @('clone','-q',$semente,$raiz))
  [void](Git-Fixture $raiz @('config','--local','core.autocrlf','false'))
  [void](Git-Fixture $raiz @('config','--local','core.safecrlf','false'))
  switch($caso){
   'importado-novo' {[IO.File]::WriteAllText((Join-Path $semente 'portal/lib/fixture.mjs'),"import texto from '../../README.md';")}
   'misto' {[IO.File]::WriteAllText((Join-Path $semente 'portal/lib/fixture.mjs'),'export const fixture=2;')}
   'renomeado-fora' {[void](Git-Fixture $semente @('mv','README.md','portal/lib/fixture.txt'))}
   'renomeado-dentro' {[void](Git-Fixture $semente @('mv','portal/lib/fixture.mjs','fixture.md'))}
   'teste' {New-Item -ItemType Directory (Join-Path $semente 'portal/tests')|Out-Null;[IO.File]::WriteAllText((Join-Path $semente 'portal/tests/fixture.test.ts'),'export {};')}
   'ci' {New-Item -ItemType Directory (Join-Path $semente '.github/workflows') -Force|Out-Null;[IO.File]::WriteAllText((Join-Path $semente '.github/workflows/fixture.yml'),'name: fixture')}
   'import-ts' {New-Item -ItemType Directory (Join-Path $semente 'portal/tests')|Out-Null;[IO.File]::WriteAllText((Join-Path $semente 'portal/tests/apoio-fixture.ts'),'export const fixture=1;')}
   'import-python' {New-Item -ItemType Directory (Join-Path $semente 'alertas/tests') -Force|Out-Null;[IO.File]::WriteAllText((Join-Path $semente 'alertas/tests/modulo_fixture.py'),'fixture=1')}
   'dot-source' {[IO.File]::WriteAllText((Join-Path $semente 'scripts/testar-fixture.ps1'),'# fixture')}
   'link' {[IO.File]::WriteAllText((Join-Path $semente 'link.md'),'README.md')}
  }
  if($caso-notin@('vazio','renomeado-fora','teste','ci','dot-source','import-ts','import-python','link')){[IO.File]::WriteAllText((Join-Path $semente 'README.md'),'documentacao ficticia nova')}
  [void](Git-Fixture $semente @('add','.'))
  if($caso-eq'link'){$blob=@(Git-Fixture $semente @('hash-object','-w','link.md'))[0];[void](Git-Fixture $semente @('update-index','--cacheinfo',"120000,$blob,link.md"))}
  [void](Git-Fixture $semente @('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-qm','remoto'))
  $remoto=@(Git-Fixture $semente @('rev-parse','HEAD'))[0]
  if($caso-eq'importado-anterior'){
   # Consulta explicita dos dois commits: ate uma referencia removida obriga parada.
   [IO.File]::WriteAllText((Join-Path $semente 'portal/lib/fixture.mjs'),'export {};')
   [void](Git-Fixture $semente @('add','.'))
   [void](Git-Fixture $semente @('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','remover import'))
   $remoto=@(Git-Fixture $semente @('rev-parse','HEAD'))[0]
  }
  if($caso-in@('importado-anterior','importado-novo')){
   $antes=Git-Fixture $semente @('show',($anterior+':portal/lib/fixture.mjs'))
   $depois=Git-Fixture $semente @('show',($remoto+':portal/lib/fixture.mjs'))
   Exigir-SemParada ((($antes-join' ')-like'*README.md*')-eq($caso-eq'importado-anterior')) 'Import anterior da fixture incorreto.'
   Exigir-SemParada ((($depois-join' ')-like'*README.md*')-eq($caso-eq'importado-novo')) 'Import novo da fixture incorreto.'
   # Isola a elegibilidade de README: o diff real tambem contem o consumidor.
   Exigir-SemParada ((Testar-AtualizacaoSemParada $semente @('README.md') $anterior $anterior)-eq($caso-eq'importado-novo')) 'Deteccao isolada do commit anterior incorreta.'
   Exigir-SemParada ((Testar-AtualizacaoSemParada $semente @('README.md') $remoto $remoto)-eq($caso-eq'importado-anterior')) 'Deteccao isolada do commit novo incorreta.'
   Exigir-SemParada (!(Testar-AtualizacaoSemParada $semente @('README.md') $anterior $remoto)) 'Ignorou dependencia em um dos commits.'
  }
  $normal=$caso-in@('misto','importado','importado-anterior','importado-novo','import-ts','import-python','dot-source','renomeado-fora','renomeado-dentro','vazio','reaplicar','completo','consulta-falha','grep-sem-match','grep-erro','grep-padrao-corrompido','link')
  $esperado=!$normal-and$caso-notin@('simular','merge-falha')
  $env:SUPPLY_VISION_PRIVADO=Join-Path $base ($caso+' estado ficticio')
  $runner=@'
param($Raiz,$Caso)
$ErrorActionPreference='Stop'
$PSNativeCommandArgumentPassing='Legacy'
function node {throw 'NODE PROIBIDO'}
function npm.cmd {throw 'BUILD PROIBIDO'}
function Start-Process {throw 'SERVICO PROIBIDO'}
function powershell.exe {throw 'FILHO PROIBIDO'}
$gitReal=@(Get-Command git -CommandType Application)[0].Source
function git {
 if($Caso-eq'merge-falha'-and$args[0]-eq'merge'){$global:LASTEXITCODE=1;return}
 if($Caso-eq'consulta-falha'-and$args-contains'ls-tree'){$global:LASTEXITCODE=2;return}
 if($args-contains'grep'){
  $pos=[array]::IndexOf($args,'-f');$arquivoPadrao=$args[$pos+1]
  if($pos-lt0-or$arquivoPadrao-eq'-'){throw 'Grep ainda depende de stdin.'}
  $bytes=[IO.File]::ReadAllBytes($arquivoPadrao)
  if(!$bytes.Length-or($bytes.Length-ge3-and$bytes[0]-eq239-and$bytes[1]-eq187-and$bytes[2]-eq191)-or$bytes-contains13-or$bytes-contains10){throw 'Padrao com BOM/quebra de linha.'}
  $fim=[array]::IndexOf($args,'--')
  if($fim-lt1-or$args[$fim-1]-cnotmatch'^[0-9a-f]{40}$'){throw 'Revisao nao chegou ao Git como SHA completo.'}
  foreach($caminho in $args[($fim+1)..($args.Count-1)]){if(!$caminho.StartsWith(':(literal)')){throw 'Pathspec sem protecao literal.'}}
  Add-Content (Join-Path $env:SUPPLY_VISION_PRIVADO 'padroes-consultados.txt') $arquivoPadrao
  if($Caso-eq'grep-sem-match'){$global:LASTEXITCODE=1;return}
  if($Caso-eq'grep-erro'){$global:LASTEXITCODE=128;return}
  if($Caso-eq'grep-padrao-corrompido'){[IO.File]::WriteAllText($arquivoPadrao,'SV_TERMO_DE_CONTROLE_INEXISTENTE_165',(New-Object Text.UTF8Encoding($false)))}
 }
 & $gitReal @args
}
$opcoes=@{}
if($Caso-eq'simular'){$opcoes.Simular=$true}
if($Caso-eq'reaplicar'){$opcoes.Reaplicar=$true}
if($Caso-eq'completo'){$opcoes.ForcarCompleto=$true}
& (Join-Path $Raiz 'scripts/atualizar-servidor.ps1') @opcoes
exit $LASTEXITCODE
'@
  $arquivoRunner=Join-Path $base 'runner.ps1';[IO.File]::WriteAllText($arquivoRunner,$runner)
  $saida=@(Executar-PowerShellOculto @('-NoProfile','-File',$arquivoRunner,$raiz,$caso) $hostTeste);$rc=$LASTEXITCODE
  Exigir-SemParada (($rc-eq0)-eq($esperado-or$caso-eq'simular')) "Resultado incorreto: $caso rc=$rc; $saida"
  if($normal){Exigir-SemParada (($saida-join' ')-like'*FLUXO NORMAL*') "Nao entrou no fluxo normal: $caso; $saida"}
  Exigir-SemParada (($saida-join' ')-notmatch'PARADA PROIBIDA|NODE PROIBIDO|BUILD PROIBIDO|SERVICO PROIBIDO|FILHO PROIBIDO') "Tocou operacao em $caso"
  $registroPadroes=Join-Path $env:SUPPLY_VISION_PRIVADO 'padroes-consultados.txt'
  if(Test-Path $registroPadroes){foreach($arquivoPadrao in @(Get-Content $registroPadroes)){Exigir-SemParada (!(Test-Path $arquivoPadrao)) 'Padrao temporario nao foi removido no finally.'}}
  $head=@(Git-Fixture $raiz @('rev-parse','HEAD'))[0]
  Exigir-SemParada ($head-eq$(if($esperado){$remoto}else{$anterior})) "HEAD inesperado: $caso"
  $contexto=Join-Path $env:SUPPLY_VISION_PRIVADO 'operacao/atualizacao.json'
  if($esperado){
   $j=Get-Content $contexto -Raw -Encoding UTF8|ConvertFrom-Json
   Exigir-SemParada ($j.anterior-eq$anterior-and$j.remoto-eq$remoto-and$j.fase-eq'concluido'-and$j.modo-eq'sem-parada'-and!$j.preparo) 'Contexto sem parada incorreto.'
   $publicacoes=@(Get-Content (Join-Path $env:SUPPLY_VISION_PRIVADO 'publicacoes.txt') -Encoding UTF8)
   Exigir-SemParada (@($publicacoes|Where-Object {$_-ceq'Atualizacao concluida'}).Count-eq1) 'Conclusao duplicada/ausente.'
   $progresso=Get-Content (Join-Path $env:SUPPLY_VISION_PRIVADO 'operacao/atualizacao-andamento.json') -Raw -Encoding UTF8|ConvertFrom-Json
   Exigir-SemParada ($progresso.nome-ceq'Atualizacao concluida'-and$progresso.estado-ceq'concluido'-and$progresso.modo-ceq'sem-parada') 'Andamento final incorreto.'
  }else{Exigir-SemParada (!(Test-Path $contexto)) "Gravou contexto operacional em $caso"}
  if($esperado-or$caso-eq'simular'){Exigir-SemParada (($saida-join' ')-like'*Modo: sem parada (so testes/CI/documentacao mudaram)*') 'Modo nao anunciado.'}
  Exigir-SemParada (!(Test-Path (Join-Path $env:SUPPLY_VISION_PRIVADO 'operacao/parar.sinal'))) 'Criou sinal de parada.'
  Exigir-SemParada (@(Git-Fixture $raiz @('worktree','list','--porcelain')|Where-Object {$_-like'worktree *'}).Count-eq1) 'Criou worktree.'
  Write-Host "[OK] Sem parada: $caso"
 }
 # Executa a espera real: primeira tentativa sem sono e intervalo de 500 ms.
 $script:passosHealth=@();$script:tentativasHealth=0
 function Invoke-RestMethod {param($Uri,$TimeoutSec);$script:passosHealth+='health';$script:tentativasHealth++;if($script:tentativasHealth-eq1){throw 'partida'};return @{status='ok'}}
 function Start-Sleep {param($Milliseconds);$script:passosHealth+="espera:$Milliseconds"}
 Exigir-SemParada (Esperar-PortalAtualizado 'http://127.0.0.1:1') 'Health nao ficou pronto.'
 Exigir-SemParada (($script:passosHealth-join',')-ceq'health,espera:500,health') 'Health nao consultou imediatamente/a cada 500 ms.'
 Remove-Item Function:Start-Sleep
 function Invoke-RestMethod {return @{status='invalido'}}
 $relogio=[Diagnostics.Stopwatch]::StartNew()
 Exigir-SemParada (!(Esperar-PortalAtualizado 'http://127.0.0.1:1' 1)) 'Aceitou health invalido.'
 Exigir-SemParada ($relogio.Elapsed.TotalSeconds-ge1-and$relogio.Elapsed.TotalSeconds-lt2) 'Prazo de health mudou com frequencia das consultas.'
 Remove-Item Function:Invoke-RestMethod
 Write-Host '[OK] Health imediato, intervalo de 500 ms e prazo total.'
}finally{
 $env:SUPPLY_VISION_PRIVADO=$privadoAntes;$env:SV_PREPARO_COMPLETO=$completoAntes
 Set-Location $fonteRaiz
 if(Test-Path $base){Remove-Item $base -Recurse -Force}
}
$global:LASTEXITCODE=0
