$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'espera-testes.ps1')
$script:ms=0;$script:consultas=0
$agora={([datetime]'2026-01-01').AddMilliseconds($script:ms)}
$pausa={param($Ms) if($Ms-ne500){throw 'Intervalo diferente de 500 ms'};$script:ms+=$Ms}
if(!(Esperar-CondicaoTeste {$script:consultas++;$script:ms-ge8000} -Agora $agora -Pausa $pausa)){throw 'Espera encerrou antes da VM lenta'}
if($script:ms-ne8000-or$script:consultas-ne17){throw 'Polling nao observou convergencia'}
$script:ms=0
if(Esperar-CondicaoTeste {$false} -Agora $agora -Pausa $pausa){throw 'Duas instancias foram aprovadas'}
if($script:ms-ne60000){throw 'Prazo de 60 segundos nao respeitado'}
if(!(Esperar-CondicaoTeste {$true} -Segundos 0)){throw 'Condicao ja satisfeita deveria passar'}
$dir=Join-Path ([IO.Path]::GetTempPath()) ('sv-diagnostico-'+[guid]::NewGuid().ToString('N'))
try{
 New-Item -ItemType Directory $dir|Out-Null
 $instancias=@()
 foreach($id in @(101,202)){
  $lock=Join-Path $dir "$id.lock";$manifesto=Join-Path $dir "$id-trava.txt"
  [IO.File]::WriteAllText($manifesto,$lock)
  $i=@{pid=$id;trava=$lock;manifesto=$manifesto}
  foreach($tipo in @('saida','erro','log')){$i[$tipo]=Join-Path $dir "$id-$tipo.txt";[IO.File]::WriteAllText($i[$tipo],"conteudo-$id-$tipo")}
  $instancias+=$i
 }
 New-Item -ItemType File $instancias[0].trava|Out-Null
 $texto=Formatar-DiagnosticoTravaTeste $instancias
 foreach($i in $instancias){foreach($trecho in @("PID $($i.pid)",$i.trava,"conteudo-$($i.pid)-saida","conteudo-$($i.pid)-erro","conteudo-$($i.pid)-log")){if(!$texto.Contains($trecho)){throw "Diagnostico incompleto: $trecho"}}}
 if(!$texto.Contains('existe=True')-or!$texto.Contains('existe=False')){throw 'Existencia das travas nao informada'}
 Remove-Item $instancias[1].manifesto
 if(!(Formatar-DiagnosticoTravaTeste $instancias).Contains('nao registrado')){throw 'Inicio atrasado sem manifesto nao diagnosticado'}
 Write-Host 'PASSOU: convergencia apos 8 s, timeout de 60 s, polling 500 ms e diagnostico por instancia.'
}finally{Remove-Item -LiteralPath $dir -Recurse -Force}

$fixture=Join-Path ([IO.Path]::GetTempPath()) ('sv-fixture-'+[guid]::NewGuid().ToString('N'))
try{
 Preparar-InstalacaoSupervisorTeste (Resolve-Path (Join-Path $PSScriptRoot '..')).Path $fixture
 foreach($arq in @('scripts/supervisor.ps1','privado/alertas/parametros/de_para/itens.csv','alertas/processo/validar_parametros.py')){
  if(!(Test-Path (Join-Path $fixture $arq))){throw "Fixture incompleta: $arq"}
 }
 $supervisorFixture=[IO.File]::ReadAllText((Join-Path $fixture 'scripts/supervisor.ps1'))
 if(!$supervisorFixture.Contains('Consultar-HealthLocal $clienteHealth "http://127.0.0.1:59999/api/health"')){throw 'Fixture perdeu isolamento do health.'}
 $supervisorReal=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'supervisor.ps1'))
 if($supervisorReal.Contains('59999')){throw 'Injecao de teste alterou supervisor real.'}
 $recusou=$false;try{Preparar-InstalacaoSupervisorTeste $PSScriptRoot $fixture}catch{$recusou=$true}
 if(!$recusou){throw 'Fixture sobrescreveu destino existente.'}
 Write-Host 'Fixture compartilhada: estrutura, exemplos e destino novo aprovados.'
}finally{Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue}

# Prazo externo e EOF herdado: nao depende de o cenario cooperar.
$dir=Join-Path ([IO.Path]::GetTempPath()) ('sv-prazo-'+[guid]::NewGuid().ToString('N'))
$travado=$null;$pai=$null;$descendente=$null
try{
 New-Item -ItemType Directory $dir|Out-Null
 $node=(Get-Command node -ErrorAction Stop).Source
 $eterno=Join-Path $dir 'eterno.cjs';[IO.File]::WriteAllText($eterno,'setInterval(()=>{},1000);')
 $fase=Join-Path $dir 'fase.txt';[IO.File]::WriteAllText($fase,'espera-provocada')
 $travado=Start-Process $node -ArgumentList ('"'+$eterno+'"') -PassThru
 $relogio=[Diagnostics.Stopwatch]::StartNew()
 if(Esperar-ProcessoTeste $travado 1 $fase){throw 'Cenario travado foi aprovado.'}
 if($relogio.Elapsed.TotalSeconds-gt3){throw 'Prazo externo nao limitou o teste travado.'}
 Encerrar-ArvoreTeste $travado
 if(!$travado.WaitForExit(5000)){throw 'Watchdog deixou processo travado vivo.'}
 $entrada=Join-Path $dir 'pai.cjs'
 [IO.File]::WriteAllText($entrada,"const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');const filho=spawn(process.execPath,[path.join(__dirname,'eterno.cjs')],{stdio:'inherit'});fs.writeFileSync(path.join(__dirname,'filho.pid'),String(filho.pid));filho.unref();")
 $pai=Start-Process $node -ArgumentList ('"'+$entrada+'"') -PassThru -RedirectStandardOutput (Join-Path $dir 'saida.log') -RedirectStandardError (Join-Path $dir 'erro.log')
 if(!(Esperar-CondicaoTeste {$pai.Refresh();$pai.HasExited} -Segundos 5)){throw 'Pai da fixture nao saiu.'}
 $descendente=Get-Process -Id ([int](Get-Content (Join-Path $dir 'filho.pid') -Raw))
 $relogio.Restart()
 if(!(Esperar-ProcessoTeste $pai 1)-or$relogio.Elapsed.TotalSeconds-gt1){throw 'EOF do descendente bloqueou espera por pai ja encerrado.'}
 Write-Host '[OK] Watchdog limita processo travado e nao espera EOF herdado de descendente.'
}finally{
 foreach($p in @($descendente,$pai,$travado)){if($p){if(!$p.HasExited){Encerrar-ArvoreTeste $p};$p.Dispose()}}
 Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}
