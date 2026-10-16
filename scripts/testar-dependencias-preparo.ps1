# Roda o preparador real com executaveis simulados e dados descartaveis.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'atualizacao-preparo.ps1')
$fonteRaiz=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$base=Join-Path ([IO.Path]::GetTempPath()) ('sv-deps-'+[guid]::NewGuid().ToString('N'))
$hostTeste=(Get-Process -Id $PID).Path
$privadoAntes=$env:SUPPLY_VISION_PRIVADO
# O teste regrava o preparador sem BOM. PS5.1 entao interpreta UTF8 como ANSI.
# Nao depender do BOM: aspas duplas e here-strings interpoladas devem ser ASCII.
function Exigir-StringsDuplasAscii([string]$Codigo,[string]$Nome) {
 $tokens=$null;$erros=$null
 [void][Management.Automation.Language.Parser]::ParseInput($Codigo,[ref]$tokens,[ref]$erros)
 if($erros.Count){throw "Sintaxe invalida em ${Nome}: $($erros[0].Message)"}
 foreach($token in $tokens){
  if($token.Kind-in@('StringExpandable','HereStringExpandable')-and$token.Extent.Text-match'[^\x00-\x7F]'){
   throw "String com aspas duplas nao ASCII em ${Nome}: linha $($token.Extent.StartLineNumber)."
  }
 }
}
foreach($nome in @('preparar-atualizacao.ps1','atualizacao-preparo.ps1','atualizar-servidor.ps1','limpar-preparo-assincrono.ps1','supv.ps1','inicializacao-logica.ps1','administracao-logica.ps1','testar-supv.ps1')){
 $codigoAscii=[IO.File]::ReadAllText((Join-Path $PSScriptRoot $nome))
 Exigir-StringsDuplasAscii $codigoAscii $nome
 # Simula a leitura ANSI do PS5.1 de uma copia UTF8 sem BOM, tambem no PS7.
 $ansi=[Text.Encoding]::GetEncoding(1252).GetString([Text.Encoding]::UTF8.GetBytes($codigoAscii))
 $errosAnsi=$null
 [void][Management.Automation.Language.Parser]::ParseInput($ansi,[ref]$null,[ref]$errosAnsi)
 if($errosAnsi.Count){throw "Copia sem BOM nao passa no parser ANSI: $nome"}
}
# Controle negativo: o mesmo travessao que quebrava a copia sem BOM.
$amostras=@()
$amostras+=('Write-Output "modo '+[char]0x2014+' $($motivo)"')
$amostras+=('@"'+"`n"+'modo '+[char]0x2014+"`n"+'"@')
foreach($amostra in $amostras){
 $recusou=$false
 try{Exigir-StringsDuplasAscii $amostra 'controle-negativo'}catch{$recusou=$_.Exception.Message-like'*nao ASCII*'}
 if(!$recusou){throw 'Guarda nao detectou string interpolada nao ASCII.'}
}
Write-Host '[OK] Strings duplas ASCII e parser ANSI de copias sem BOM nos scripts operacionais e na CLI.'
try{
 foreach($caso in @('inalteradas','alteradas','metadata-engines','metadata-pacote','metadata-reaplicar','metadata-mesmo-sha','build-falha','portal-falha','alertas-falha','operacional-falha','ci-espera-verde','ci-espera-vermelho','ci-espera-api','ci-espera-cancelada','ci-aprovado','ci-log-explicito','ci-pr-verde','ci-pr-arvore','ci-pr-falho','ci-pr-pendente','ci-pr-ausente','ci-pr-erro','ci-pr-skipped','ci-pr-skipped-real','ci-pr-push-only','ci-pr-sem-check','ci-pr-app','ci-pr-ambigua','ci-pr-main-falho','ci-pr-main-cancelado','ci-pr-queued','ci-pr-tree-api','ci-pr-sha','ci-pr-paginacao','ci-rede','ci-ausente','ci-pendente','ci-falho','ci-timeout','ci-cancelado','ci-skipped','ci-sha','ci-invalido','ci-forcado','ci-forcado-env','fumaca-falha')){
  $instalacao=Join-Path $base $caso
  $preparo=Nova-PastaPreparo $instalacao
  foreach($dir in @('portal/node_modules','alertas/.venv/Scripts','privado')){New-Item -ItemType Directory -Force (Join-Path $instalacao $dir)|Out-Null}
  foreach($dir in @('scripts','portal','compartilhado','alertas/config','alertas/parametros/de_para','alertas/parametros/filtros')){New-Item -ItemType Directory -Force (Join-Path $preparo $dir)|Out-Null}
  foreach($nome in @('atualizacao-preparo.ps1','preparar-configuracao-teste.ps1','operacao-logica.ps1')){Copy-Item (Join-Path $PSScriptRoot $nome) (Join-Path $preparo 'scripts')}
  Add-Content (Join-Path $preparo 'scripts/atualizacao-preparo.ps1') 'function Executar-PowerShellOculto($Argumentos){ & powershell.exe @Argumentos }'
  # Preserva evidencias destas suites de decisoes; a remocao REAL e testada
  # em testar-limpeza-preparo.ps1, inclusive com pai de versao anterior.
  Add-Content (Join-Path $preparo 'scripts/atualizacao-preparo.ps1') 'function Limpar-PastaPreparo($Raiz,$Preparo){[IO.File]::WriteAllText((Join-Path $Preparo "limpeza-solicitada"),"ok")}'
  if($caso-like'metadata-*'){
   # O pai anterior passa ReinstalarNode por qualquer edicao dos manifestos.
   # A assinatura efetiva e exercitada com arquivos reais na suite rapida.
   Add-Content (Join-Path $preparo 'scripts/atualizacao-preparo.ps1') @'
function Obter-AssinaturaDependencias($Raiz,$Python){
 $destino=$Raiz-eq$Preparo
 $sha=if($destino-or$Caso-eq'metadata-mesmo-sha'){'2'*40}else{'1'*40}
 $hash=if($destino-and$Caso-eq'metadata-pacote'){'b'*64}else{'a'*64}
 return @{sha=$sha;node='v24.20.0';hashes=@{'portal/package.json'=('node-v1:'+$hash);'portal/package-lock.json'=('node-v1:'+$hash)}}
}
'@
  }
  $codigo=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'preparar-atualizacao.ps1'))
  $codigo=$codigo.Replace('Validar-PythonAlertas','ValidarPythonMock')
  $codigo=$codigo.Replace('Consultar-CIPreparo $sha -ForcarCompleto:$ForcarCompleto','Consultar-CIPreparo $sha -ForcarCompleto:$ForcarCompleto -Agora {$global:ciAgora} -Pausa {param($Ms) $global:ciAgora=$global:ciAgora.AddMilliseconds($Ms);if($Caso-eq''ci-espera-cancelada''){Solicitar-CancelamentoEsperaCI $script:AndamentoPreparo.arquivo}}')
  $codigo=$codigo.Replace("& (Join-Path `$alertas '.venv/Scripts/python.exe')",'& pythonmock')
  # A sobrecarga sem encoding escreve UTF8 SEM BOM, inclusive no .NET do PS5.1.
  [IO.File]::WriteAllText((Join-Path $preparo 'scripts/preparar-atualizacao.ps1'),$codigo)
  Copy-Item (Join-Path $fonteRaiz 'portal/portal.env.example') (Join-Path $preparo 'portal')
  Copy-Item (Join-Path $fonteRaiz 'portal/package.json') (Join-Path $preparo 'portal')
  New-Item -ItemType Directory -Force (Join-Path $preparo 'portal/scripts')|Out-Null
  Copy-Item (Join-Path $fonteRaiz 'portal/scripts/versao-node.mjs') (Join-Path $preparo 'portal/scripts')
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
$global:ciAgora=[datetime]'2026-01-01'
function ValidarPythonMock {}
function Registrar($Texto){Add-Content (Join-Path $Preparo 'passos.txt') $Texto}
function Conferir-Isolamento {
 if($env:SV_PREPARO_RAIZ-ne$Preparo-or$env:TEMP-ne(Join-Path $Preparo '.cache')-or$env:SUPPLY_VISION_PRIVADO-ne(Join-Path $Preparo 'privado')-or$env:MODO_ENSAIO-ne'1'-or$env:PORTAL_BANCO_LOCAL){throw 'Ambiente de producao herdado.'}
 $cfg=Ler-ConfigOperacao (Join-Path $env:SUPPLY_VISION_PRIVADO 'portal/configuracao/portal.env')
 $registro=Get-Content (Join-Path $Preparo ('.cache/preparo-portas/'+$PID.ToString()+'.json')) -Raw|ConvertFrom-Json
 $porta=[int]$cfg['PORTAL_PORTA'];$relatorios=[int]$cfg['RELATORIOS_PORTA'];$url=[uri]$cfg['PORTAL_URL']
 if($registro.pid-ne$PID-or@($registro.portas).Count-ne2-or$porta-eq$relatorios-or$porta-in@(3000,3001)-or$relatorios-in@(3000,3001)-or$registro.portas-notcontains$porta-or$registro.portas-notcontains$relatorios-or$url.Host-ne'127.0.0.1'-or$url.Port-ne$porta){throw 'Portas do preparo nao pertencem a fixture.'}
}
function Invoke-RestMethod {
 param($Uri,$Headers,$TimeoutSec,$ErrorAction)
 if($Headers.ContainsKey('Authorization')-or$Uri-notlike'https://api.github.com/repos/ngerheim/supply-vision/commits/*'-or$TimeoutSec-gt8){throw 'Consulta CI insegura'}
 if($Caso-eq'ci-rede'){throw 'rede ficticia indisponivel'}
 $mainSha='2'*40;$prSha='3'*40
 if($Uri-like'*/pulls?*'){
  Registrar 'api-pr'
  if($Caso-eq'ci-pr-erro'){throw 'rate limit simulado HTTP 403'}
  if($Caso-in@('ci-pr-ausente','ci-pendente','ci-espera-verde','ci-espera-vermelho','ci-espera-api','ci-espera-cancelada')){return @()}
  $pr=@{number=123;merged_at='2026-10-15T12:00:00Z';state='closed';merge_commit_sha=$mainSha;head=@{sha=$prSha};base=@{ref='main';repo=@{full_name='ngerheim/supply-vision'}}}
  if($Caso-eq'ci-pr-ambigua'){return @($pr,$pr)}
  # REST entrega listas como um unico objeto de pipeline.
  return ,@($pr)
 }
 if($Uri-notlike'*/check-runs?*'){
  if($Caso-eq'ci-pr-tree-api'){throw 'rede simulada na consulta de arvore'}
  $sha=($Uri-split'/')[-1];$tree='a'*40
  if($Caso-eq'ci-pr-arvore'-and$sha-ceq$prSha){$tree='b'*40}
  return @{sha=$sha;commit=@{tree=@{sha=$tree}}}
 }

 Registrar 'api-checks'
 $nomes=@('Portal','Portal - instalacao nova e autenticacao real','PowerShell','Alertas','Atualizacao real')
 if($Caso-like'ci-espera-*'){
  $segundos=($global:ciAgora-[datetime]'2026-01-01').TotalSeconds
  Registrar ("consulta-ci:"+$segundos)
  if($Caso-eq'ci-espera-api'-and$segundos-ge30){throw 'API indisponivel durante a espera'}
 }
 $checks=@(foreach($nome in $nomes){[pscustomobject]@{name=$nome;head_sha=('2'*40);status='completed';conclusion=$(if($nome-eq'Atualizacao real'){'skipped'}else{'success'});app=@{slug='github-actions';id=15368}}})
 if($Caso-like'ci-pr-*'){
  $naPR=$Uri-like("*/commits/$prSha/check-runs?*")
  if($naPR){
   foreach($c in $checks){$c.head_sha=$prSha;$c.conclusion='success'}
   if($Caso-eq'ci-pr-falho'){$checks[0].conclusion='failure'}
   if($Caso-eq'ci-pr-pendente'){$checks[0].status='in_progress';$checks[0].conclusion=$null}
   if($Caso-eq'ci-pr-skipped'){$checks[0].conclusion='skipped'}
   if($Caso-eq'ci-pr-skipped-real'){$checks[4].conclusion='skipped'}
   if($Caso-eq'ci-pr-sem-check'){$checks=@($checks|Where-Object name -ne 'PowerShell')}
   if($Caso-eq'ci-pr-app'){$checks[0].app=@{slug='outro';id=9}}
   if($Caso-eq'ci-pr-sha'){$checks[0].head_sha=$mainSha}
   # Check exclusivo da PR tambem precisa estar verde.
   $checks+=@([pscustomobject]@{name='Revisao de dependencias';head_sha=$prSha;status='completed';conclusion='success';app=@{slug='github-actions';id=15368}})
  }else{
   $checks[0].status=$(if($Caso-eq'ci-pr-queued'){'queued'}else{'in_progress'});$checks[0].conclusion=$null
   if($Caso-eq'ci-pr-main-falho'){$checks[3].conclusion='failure'}
   if($Caso-eq'ci-pr-main-cancelado'){$checks[3].conclusion='cancelled'}
   if($Caso-eq'ci-pr-push-only'){$checks+=@([pscustomobject]@{name='Somente push main';head_sha=$mainSha;status='queued';conclusion=$null;app=@{slug='github-actions';id=15368}})}
  }
  if($Caso-eq'ci-pr-paginacao'){
   $sha=$(if($naPR){$prSha}else{$mainSha})
   $extras=@(foreach($n in 1..96){[pscustomobject]@{name="Extra $n";head_sha=$sha;status='completed';conclusion='success';app=@{slug='github-actions';id=15368}}})
   $checks+=$extras;$total=$checks.Count
   $checks=if($Uri-like'*page=2'){@($checks|Select-Object -Skip 100)}else{@($checks|Select-Object -First 100)}
   return (@{total_count=$total;check_runs=$checks}|ConvertTo-Json -Depth 5|ConvertFrom-Json)
  }
 }
 if($Caso-eq'ci-ausente'){$checks=@($checks|Where-Object name -ne 'PowerShell')}
 if($Caso-eq'ci-pendente'){$checks[3].status='in_progress'}
 if($Caso-eq'ci-falho'){$checks[0].conclusion='failure'}
 if($Caso-eq'ci-timeout'){$checks[0].conclusion='timed_out'}
 if($Caso-eq'ci-cancelado'){$checks[0].conclusion='cancelled'}
 if($Caso-eq'ci-skipped'){$checks[0].conclusion='skipped'}
 if($Caso-eq'ci-sha'){$checks[0].head_sha='3'*40}
 if($Caso-eq'ci-invalido'){return @{total_count=20;check_runs=$checks}}
 if($Caso-like'ci-espera-*'){
  if($segundos-lt60){$checks[3].status='in_progress';$checks[3].conclusion=$null}
  elseif($Caso-eq'ci-espera-vermelho'){$checks[3].conclusion='failure'}
 }
 if($Caso-notlike'ci-*'-and$Caso-ne'fumaca-falha'){throw 'CI nao aprovado nesta fixture'}
 return (@{total_count=$checks.Count;check_runs=$checks}|ConvertTo-Json -Depth 5|ConvertFrom-Json)
}
function node {if($args[-1]-eq'--exata'){& (Get-Command node -CommandType Application|Select-Object -First 1).Source @args;return};Conferir-Isolamento;Registrar 'fumaca';$global:LASTEXITCODE=0;if($Caso-eq'fumaca-falha'){$global:LASTEXITCODE=1}}
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
elseif($Caso-like'metadata-*'){& (Join-Path $Preparo 'scripts/preparar-atualizacao.ps1') -Instalacao $Instalacao -ReinstalarNode -IgnorarReserva:($Caso-eq'metadata-reaplicar')}
elseif($Caso-eq'ci-log-explicito'){& (Join-Path $Preparo 'scripts/preparar-atualizacao.ps1') -Instalacao $Instalacao -TemposArquivo (Join-Path $Instalacao 'privado/operacao/atualizacao-tempos.log')}
elseif($Caso-eq'ci-forcado'){& (Join-Path $Preparo 'scripts/preparar-atualizacao.ps1') -Instalacao $Instalacao -ForcarCompleto}
else{if($Caso-eq'ci-forcado-env'){$env:SV_PREPARO_COMPLETO='1'};& (Join-Path $Preparo 'scripts/preparar-atualizacao.ps1') -Instalacao $Instalacao}
Registrar ('tempo-ci:'+($global:ciAgora-[datetime]'2026-01-01').TotalSeconds)
exit $LASTEXITCODE
'@
  $arquivoRunner=Join-Path $preparo 'runner.ps1';[IO.File]::WriteAllText($arquivoRunner,$runner)
  # Falhas provocadas escrevem em stderr; o codigo de saida decide o resultado.
  $saida=@(Executar-PowerShellOculto @('-NoProfile','-File',$arquivoRunner,$caso,$instalacao,$preparo) $hostTeste);$rc=$LASTEXITCODE
  if(!(Test-Path (Join-Path $preparo 'passos.txt'))){throw "Preparador nao chegou aos comandos: $saida"}
  $passos=@(Get-Content (Join-Path $preparo 'passos.txt'))
  if($caso-eq'ci-pendente'-and$passos-notcontains'tempo-ci:1800'){throw 'Espera nao respeitou o prazo total de 30 min.'}
  if(($rc-eq0)-ne($caso-notin@('build-falha','portal-falha','alertas-falha','operacional-falha','fumaca-falha','ci-falho','ci-timeout','ci-cancelado','ci-pr-main-falho','ci-pr-main-cancelado','ci-espera-vermelho','ci-espera-cancelada'))){throw "Preparo incorreto em $caso (rc=$rc): $saida"}
  if(($passos-contains'npm-ci')-ne($caso-in@('alteradas','metadata-pacote','metadata-reaplicar','metadata-mesmo-sha'))-or($passos-contains'pip')-ne($caso-eq'alteradas')){throw "Decisao de dependencias incorreta: $caso"}
  if($caso-eq'metadata-engines'-and($saida-join' ')-notlike'*Dependencias Node: copia - motivo: reserva ausente*'){throw 'Pai legado nao reutilizou copia apos mudanca somente em engines.'}
  $rapido=$caso-in@('ci-espera-verde','ci-aprovado','ci-log-explicito','fumaca-falha','ci-pr-verde','ci-pr-queued','ci-pr-skipped-real','ci-pr-paginacao')
  if($rc-eq0-and@($passos|Where-Object {$_-like'operacional:*'}).Count-ne$(if($rapido){2}else{4})){throw 'Removeu verificacao operacional.'}
  if($rapido-and($passos-contains'portal'-or$passos-contains'alertas'-or$passos-notcontains'fumaca')){throw 'Modo rapido nao respeitou suites/fumaca.'}
  if(!$rapido-and$rc-eq0-and($passos-notcontains'portal'-or$passos-notcontains'alertas')){throw 'Fallback nao executou todas as suites.'}
  if($caso-in@('ci-aprovado','ci-falho','ci-cancelado','ci-pr-main-falho','ci-pr-main-cancelado','ci-forcado')-and$passos-contains'api-pr'){throw 'Consultou PR sem autorizacao pelo estado da main.'}
  if($caso-in@('ci-falho','ci-timeout','ci-cancelado','ci-pr-main-falho','ci-pr-main-cancelado','ci-espera-vermelho','ci-espera-cancelada')){
   if($passos-contains'build'-or$passos-contains'portal'-or$passos-contains'alertas'){throw 'CI reprovado/cancelado chegou ao build ou suites.'}
   $mensagem=(Get-Content (Join-Path $instalacao 'privado/operacao/atualizacao-andamento.json') -Raw|ConvertFrom-Json).erro
   if($caso-eq'ci-espera-cancelada'){
    if($mensagem-notlike'*Espera do CI cancelada*'){throw 'Cancelamento sem mensagem clara.'}
   }elseif($mensagem-notlike'*check nao aprovado:*'-or$mensagem-notlike'*re-run no GitHub*'-or$mensagem-notlike'*PR de correcao*'-or$mensagem-notlike'*supv atualizar --completo*'){throw "CI reprovado sem check e alternativas: $mensagem"}
  }
  if($caso-like'ci-espera-*'){
   $esperado=switch($caso){'ci-espera-verde'{@(0,30,60)} 'ci-espera-vermelho'{@(0,30,60)} 'ci-espera-api'{@(0,30)} 'ci-espera-cancelada'{@(0)}}
   $obtido=@($passos|Where-Object {$_-like'consulta-ci:*'}|ForEach-Object {($_-split':')[1]})
   if(($obtido-join',')-ne($esperado-join',')){throw "Polling do CI fora dos 30 s: $caso - $obtido"}
   if(($saida-join"`n")-notlike'*Aguardando CI da main (2222222): 4 de 5 checks concluidos, 0 min*'){throw 'Espera sem progresso do SHA/checks/minutos.'}
   $a=Get-Content (Join-Path $instalacao 'privado/operacao/atualizacao-andamento.json') -Raw|ConvertFrom-Json
   if($a.esperaCI-or(Test-Path ((Join-Path $instalacao 'privado/operacao/atualizacao-andamento.json')+'.cancelar-ci'))){throw 'Espera deixou sinal ou andamento ativo.'}
  }
  if($rc-eq0){
   $tempos=Get-Content (Join-Path $preparo 'preparo-tempos.log') -Raw
   foreach($nome in @('Inicializacao isolada','Limpeza de preparos reprovados','Configuracao de teste','Dependencias Node','Materializacao de junctions Node','Dependencias Python','ValidarPythonMock','Consulta CI','Build do Portal','Aprovacao e conferencia')){if($tempos-notlike"*PREPARAR / ${nome}: codigo=0; duracao=*"){throw "Medicao ausente: $nome"}}
   $destinoTempos=Join-Path $instalacao 'privado/operacao/atualizacao-tempos.log'
   if($caso-ne'ci-log-explicito'){
    # Pai legado importa uma vez. O filho nao deve ter escrito diretamente.
    if(Test-Path $destinoTempos){throw 'Preparador escreveu tempos sem delegacao explicita.'}
    [void][IO.Directory]::CreateDirectory((Split-Path $destinoTempos -Parent))
    Get-Content (Join-Path $preparo 'preparo-tempos.log')|Add-Content $destinoTempos
   }
   $linhasTempos=@(Get-Content $destinoTempos)
   foreach($nome in @('Dependencias Node','Dependencias Python','Build do Portal')){
    if(@($linhasTempos|Where-Object {$_-like("PREPARAR / ${nome}: codigo=*")}).Count-ne1){throw "Tempo duplicado ou ausente: $nome"}
   }
   foreach($tipo in @('Node','Python')){if(@($linhasTempos|Where-Object {$_-like("Dependencias ${tipo}: *motivo: *")}).Count-ne1){throw "Caminho de dependencias ausente: $tipo"}}
   if($tempos-notlike"*modo $(if($rapido){'rapido'}else{'completo'})*"){throw 'Modo ausente no log.'}
   $andamentoModo=Get-Content (Join-Path $instalacao 'privado/operacao/atualizacao-andamento.json') -Raw -Encoding UTF8|ConvertFrom-Json
   $modoEsperado=if($rapido){'rapido'}else{'completo'}
   if($andamentoModo.modo-ne$modoEsperado-or!$andamentoModo.motivoModo){throw 'Decisao ou motivo ausente no acompanhamento.'}
   if(!$tempos.Contains($andamentoModo.motivoModo)){throw 'Motivo do acompanhamento difere do log.'}
   $motivoEsperado=switch($caso){
    'ci-espera-verde' {'CI da main verde (2222222)'}
    'ci-espera-api' {'consulta indisponivel ou invalida; modo completo'}
    'ci-pr-verde' {'CI da PR #123 (3333333) verde, conteudo identico ao da main (2222222)'}
    'ci-pr-queued' {'CI da PR #123 (3333333) verde, conteudo identico ao da main (2222222)'}
    'ci-pr-arvore' {'arvore diferente da PR #123'}
    'ci-pr-falho' {'check da PR nao aprovado: Portal (completed/failure)'}
    'ci-pr-pendente' {'check da PR nao aprovado: Portal (in_progress/)'}
    'ci-pr-ausente' {'PR de origem mesclada nao encontrada ou ambigua'}
    'ci-pr-erro' {'rate limit simulado HTTP 403'}
    'ci-pr-skipped' {'check da PR nao aprovado: Portal (completed/skipped)'}
    'ci-pr-push-only' {'check da main sem cobertura unica na PR (bloqueia): Somente push main'}
    'ci-pr-sem-check' {'check da main sem cobertura unica na PR (bloqueia): PowerShell'}
    'ci-pr-app' {'check da main sem cobertura unica na PR (bloqueia): Portal'}
    'ci-pr-ambigua' {'PR de origem mesclada nao encontrada ou ambigua'}
    'ci-pr-main-falho' {'check nao aprovado: Alertas (completed/failure)'}
    'ci-pr-main-cancelado' {'check nao aprovado: Alertas (completed/cancelled)'}
    'ci-pr-tree-api' {'rede simulada na consulta de arvore'}
    'ci-pr-sha' {'SHA inesperado no check: Portal (completed/success)'}
    'ci-pendente' {'Prazo de 30 min aguardando CI da main esgotado; modo completo; check pendente: Alertas (in_progress)'}
    'ci-ausente' {'check obrigatorio ausente: PowerShell'}
    'ci-falho' {'check nao aprovado: Portal (completed/failure)'}
    'ci-timeout' {'check nao aprovado: Portal (completed/timed_out)'}
    'ci-cancelado' {'check nao aprovado: Portal (completed/cancelled)'}
    'ci-skipped' {'check nao aprovado: Portal (completed/skipped)'}
    'ci-sha' {'SHA inesperado no check: Portal (completed/success)'}
   }
   if($motivoEsperado-and(!$tempos.Contains($motivoEsperado)-or!($saida-join"`n").Contains($motivoEsperado)-or!($linhasTempos-join"`n").Contains($motivoEsperado))){throw "Motivo do modo completo sem check/estado: $caso"}

  }
  if((Test-Path (Join-Path $preparo 'preparo-aprovado'))-ne($rc-eq0)){throw 'Preparo reprovado foi aprovado.'}
  if((Test-Path (Join-Path $preparo 'limpeza-solicitada'))-ne($rc-ne0)){throw 'Preparo nao solicitou limpeza ao reprovar.'}
  if((Get-Content (Join-Path $instalacao 'privado/sentinela'))-ne'producao ficticia'-or(Get-Content (Join-Path $instalacao 'portal/node_modules/versao'))-ne'reutilizada'){throw 'Preparo alterou instalacao.'}
  Write-Host "[OK] Dependencias e isolamento H1: $caso"
 }
}finally{$env:SUPPLY_VISION_PRIVADO=$privadoAntes;if(Test-Path $base){Remove-Item $base -Recurse -Force}}

$global:LASTEXITCODE=0
