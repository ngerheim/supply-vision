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
foreach($nome in @('preparar-atualizacao.ps1','atualizacao-preparo.ps1','atualizar-servidor.ps1','limpar-preparo-assincrono.ps1')){
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
Write-Host '[OK] Strings duplas ASCII e parser ANSI de copias sem BOM nos quatro scripts.'
try{
 foreach($caso in @('inalteradas','alteradas','build-falha','portal-falha','alertas-falha','operacional-falha','ci-aprovado','ci-log-explicito','ci-rede','ci-ausente','ci-pendente','ci-falho','ci-timeout','ci-cancelado','ci-skipped','ci-sha','ci-invalido','ci-forcado','ci-forcado-env','fumaca-falha')){
  $instalacao=Join-Path $base $caso
  $preparo=Nova-PastaPreparo $instalacao
  foreach($dir in @('portal/node_modules','alertas/.venv/Scripts','privado')){New-Item -ItemType Directory -Force (Join-Path $instalacao $dir)|Out-Null}
  foreach($dir in @('scripts','portal','compartilhado','alertas/config','alertas/parametros/de_para','alertas/parametros/filtros')){New-Item -ItemType Directory -Force (Join-Path $preparo $dir)|Out-Null}
  foreach($nome in @('atualizacao-preparo.ps1','preparar-configuracao-teste.ps1','operacao-logica.ps1')){Copy-Item (Join-Path $PSScriptRoot $nome) (Join-Path $preparo 'scripts')}
  Add-Content (Join-Path $preparo 'scripts/atualizacao-preparo.ps1') 'function Executar-PowerShellOculto($Argumentos){ & powershell.exe @Argumentos }'
  # Preserva evidencias destas suites de decisoes; a remocao REAL e testada
  # em testar-limpeza-preparo.ps1, inclusive com pai de versao anterior.
  Add-Content (Join-Path $preparo 'scripts/atualizacao-preparo.ps1') 'function Limpar-PastaPreparo($Raiz,$Preparo){[IO.File]::WriteAllText((Join-Path $Preparo "limpeza-solicitada"),"ok")}'
  $codigo=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'preparar-atualizacao.ps1'))
  $codigo=$codigo.Replace('Validar-PythonAlertas','ValidarPythonMock')
  $codigo=$codigo.Replace("& (Join-Path `$alertas '.venv/Scripts/python.exe')",'& pythonmock')
  # A sobrecarga sem encoding escreve UTF8 SEM BOM, inclusive no .NET do PS5.1.
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
 if($env:SV_PREPARO_RAIZ-ne$Preparo-or$env:TEMP-ne(Join-Path $Preparo '.cache')-or$env:SUPPLY_VISION_PRIVADO-ne(Join-Path $Preparo 'privado')-or$env:MODO_ENSAIO-ne'1'-or$env:PORTAL_BANCO_LOCAL-ne'sqlite'){throw 'Ambiente de producao herdado.'}
 $cfg=Ler-ConfigOperacao (Join-Path $env:SUPPLY_VISION_PRIVADO 'portal/configuracao/portal.env')
 $registro=Get-Content (Join-Path $Preparo ('.cache/preparo-portas/'+$PID.ToString()+'.json')) -Raw|ConvertFrom-Json
 $porta=[int]$cfg['PORTAL_PORTA'];$relatorios=[int]$cfg['RELATORIOS_PORTA'];$url=[uri]$cfg['PORTAL_URL']
 if($registro.pid-ne$PID-or@($registro.portas).Count-ne2-or$porta-eq$relatorios-or$porta-in@(3000,3001)-or$relatorios-in@(3000,3001)-or$registro.portas-notcontains$porta-or$registro.portas-notcontains$relatorios-or$url.Host-ne'127.0.0.1'-or$url.Port-ne$porta){throw 'Portas do preparo nao pertencem a fixture.'}
}
function Invoke-RestMethod {
 param($Uri,$Headers,$TimeoutSec,$ErrorAction)
 if($Headers.ContainsKey('Authorization')-or$Uri-notlike'*commits/*/check-runs?*'-or$TimeoutSec-gt8){throw 'Consulta CI insegura'}
 if($Caso-eq'ci-rede'){throw 'rede ficticia indisponivel'}
 $nomes=@('Portal','Portal - instalacao nova e autenticacao real','PowerShell','Alertas','Atualizacao real','Node 22.13 - partida e operacao (ubuntu-latest)','Node 22.13 - partida e operacao (windows-latest)')
 $checks=@(foreach($nome in $nomes){[pscustomobject]@{name=$nome;head_sha=('2'*40);status='completed';conclusion=$(if($nome-eq'Atualizacao real'){'skipped'}else{'success'});app=@{slug='github-actions';id=15368}}})
 if($Caso-eq'ci-ausente'){$checks=$checks[1..6]}
 if($Caso-eq'ci-pendente'){$checks[0].status='in_progress'}
 if($Caso-eq'ci-falho'){$checks[0].conclusion='failure'}
 if($Caso-eq'ci-timeout'){$checks[0].conclusion='timed_out'}
 if($Caso-eq'ci-cancelado'){$checks[0].conclusion='cancelled'}
 if($Caso-eq'ci-skipped'){$checks[0].conclusion='skipped'}
 if($Caso-eq'ci-sha'){$checks[0].head_sha='3'*40}
 if($Caso-eq'ci-invalido'){return @{total_count=20;check_runs=$checks}}
 if($Caso-notlike'ci-*'-and$Caso-ne'fumaca-falha'){throw 'CI nao aprovado nesta fixture'}
 return (@{total_count=$checks.Count;check_runs=$checks}|ConvertTo-Json -Depth 5|ConvertFrom-Json)
}
function node {Conferir-Isolamento;Registrar 'fumaca';$global:LASTEXITCODE=0;if($Caso-eq'fumaca-falha'){$global:LASTEXITCODE=1}}
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
elseif($Caso-eq'ci-log-explicito'){& (Join-Path $Preparo 'scripts/preparar-atualizacao.ps1') -Instalacao $Instalacao -TemposArquivo (Join-Path $Instalacao 'privado/operacao/atualizacao-tempos.log')}
elseif($Caso-eq'ci-forcado'){& (Join-Path $Preparo 'scripts/preparar-atualizacao.ps1') -Instalacao $Instalacao -ForcarCompleto}
else{if($Caso-eq'ci-forcado-env'){$env:SV_PREPARO_COMPLETO='1'};& (Join-Path $Preparo 'scripts/preparar-atualizacao.ps1') -Instalacao $Instalacao}
exit $LASTEXITCODE
'@
  $arquivoRunner=Join-Path $preparo 'runner.ps1';[IO.File]::WriteAllText($arquivoRunner,$runner)
  # Falhas provocadas escrevem em stderr; o codigo de saida decide o resultado.
  $saida=@(Executar-PowerShellOculto @('-NoProfile','-File',$arquivoRunner,$caso,$instalacao,$preparo) $hostTeste);$rc=$LASTEXITCODE
  if(!(Test-Path (Join-Path $preparo 'passos.txt'))){throw "Preparador nao chegou aos comandos: $saida"}
  $passos=@(Get-Content (Join-Path $preparo 'passos.txt'))
  if(($rc-eq0)-ne($caso-notin@('build-falha','portal-falha','alertas-falha','operacional-falha','fumaca-falha'))){throw "Preparo incorreto em $caso (rc=$rc): $saida"}
  if(($passos-contains'npm-ci')-ne($caso-eq'alteradas')-or($passos-contains'pip')-ne($caso-eq'alteradas')){throw "Decisao de dependencias incorreta: $caso"}
  $rapido=$caso-in@('ci-aprovado','ci-log-explicito','fumaca-falha')
  if($rc-eq0-and@($passos|Where-Object {$_-like'operacional:*'}).Count-ne$(if($rapido){2}else{4})){throw 'Removeu verificacao operacional.'}
  if($rapido-and($passos-contains'portal'-or$passos-contains'alertas'-or$passos-notcontains'fumaca')){throw 'Modo rapido nao respeitou suites/fumaca.'}
  if(!$rapido-and$rc-eq0-and($passos-notcontains'portal'-or$passos-notcontains'alertas')){throw 'Fallback nao executou todas as suites.'}
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
  }
  if((Test-Path (Join-Path $preparo 'preparo-aprovado'))-ne($rc-eq0)){throw 'Preparo reprovado foi aprovado.'}
  if((Test-Path (Join-Path $preparo 'limpeza-solicitada'))-ne($rc-ne0)){throw 'Preparo nao solicitou limpeza ao reprovar.'}
  if((Get-Content (Join-Path $instalacao 'privado/sentinela'))-ne'producao ficticia'-or(Get-Content (Join-Path $instalacao 'portal/node_modules/versao'))-ne'reutilizada'){throw 'Preparo alterou instalacao.'}
  Write-Host "[OK] Dependencias e isolamento H1: $caso"
 }
}finally{$env:SUPPLY_VISION_PRIVADO=$privadoAntes;if(Test-Path $base){Remove-Item $base -Recurse -Force}}

$global:LASTEXITCODE=0
