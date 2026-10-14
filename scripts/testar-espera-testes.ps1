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

# Prazo externo e EOF herdado: a prontidao vem do proprio descendente, por
# IPC. PID devolvido por spawn() sozinho nao prova que o Node chegou a iniciar.
$dir=Join-Path ([IO.Path]::GetTempPath()) ('sv-prazo-'+[guid]::NewGuid().ToString('N'))
$travado=$null;$pai=$null;$descendente=$null;$escritor=$null
function Testar-ProcessoEncerradoFixture($Processo){
 if($Processo.WaitForExit(0)){return $true}
 # Linux pode manter um neto morto como zumbi ate o init recolher; nao e um
 # processo executando. Windows exige o handle sinalizado, sem esta excecao.
 if($env:OS-ne'Windows_NT'){
  $stat="/proc/$($Processo.Id)/stat"
  if(Test-Path $stat){return [IO.File]::ReadAllText($stat)-match'\) Z '}
 }
 return $false
}
function Esperar-ProntidaoArvoreTeste($Processo,[string]$Arquivo){
 if(!(Esperar-CondicaoTeste {
  $Processo.Refresh()
  if($Processo.HasExited){throw 'Pai da fixture encerrou antes do handshake do descendente.'}
  Test-Path -LiteralPath $Arquivo
 } -Segundos 10)){throw 'Descendente nao confirmou prontidao por IPC em 10 s.'}
 $registro=Get-Content -LiteralPath $Arquivo -Raw|ConvertFrom-Json
 if($registro.pai-ne$Processo.Id){throw 'Handshake pertence a outro pai.'}
 $filho=Get-Process -Id ([int]$registro.filho) -ErrorAction SilentlyContinue
 if(!$filho){throw 'Descendente confirmou prontidao, mas encerrou antes de iniciar o ensaio.'}
 $filho.Refresh();if($filho.HasExited){throw 'Descendente saiu antes do ensaio.'}
 # Captura o handle antes de matar a arvore: nao consulta um PID desaparecido
 # nem confunde eventual reutilizacao do PID com o processo desta fixture.
 [void]$filho.Handle
 return $filho
}
try{
 New-Item -ItemType Directory $dir|Out-Null
 $node=(Get-Command node -ErrorAction Stop).Source
 $eterno=Join-Path $dir 'eterno.cjs'
 [IO.File]::WriteAllText($eterno,@'
const timer=setInterval(()=>{},1000);
process.on('disconnect',()=>{}); // EOF do pai nao encerra o escritor.
process.send({pronto:true,pid:process.pid});
'@)
 $entrada=Join-Path $dir 'pai.cjs'
 [IO.File]::WriteAllText($entrada,@'
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const modo=process.argv[2];
const filho=spawn(process.execPath,[path.join(__dirname,'eterno.cjs')],{
  stdio:['ignore','inherit','inherit','ipc'],detached:modo==='eof'
});
filho.on('error',erro=>{console.error(erro);process.exit(10);});
filho.once('exit',()=>{if(modo!=='eof')process.exit(11);});
filho.once('message',msg=>{
  if(!msg.pronto||msg.pid!==filho.pid)process.exit(12);
  const arquivo=path.join(__dirname,modo+'-pronto.json');
  fs.writeFileSync(arquivo+'.tmp',JSON.stringify({pai:process.pid,filho:msg.pid}));
  fs.renameSync(arquivo+'.tmp',arquivo);
  if(modo==='eof'){
    const liberacao=setInterval(()=>{
      if(fs.existsSync(path.join(__dirname,'liberar-pai'))){
        clearInterval(liberacao);filho.disconnect();filho.unref();process.exit(0);
      }
    },50);
  }
});
'@)
 $fase=Join-Path $dir 'fase.txt';[IO.File]::WriteAllText($fase,'espera-provocada')
 $travado=Start-Process $node -ArgumentList @(('"'+$entrada+'"'),'arvore') -PassThru -RedirectStandardOutput (Join-Path $dir 'arvore-saida.log') -RedirectStandardError (Join-Path $dir 'arvore-erro.log')
 $descendente=Esperar-ProntidaoArvoreTeste $travado (Join-Path $dir 'arvore-pronto.json')
 $relogio=[Diagnostics.Stopwatch]::StartNew()
 if(Esperar-ProcessoTeste $travado 1 $fase){throw 'Cenario travado foi aprovado ou saiu antes do prazo.'}
 $esperaMs=$relogio.ElapsedMilliseconds
 if($esperaMs-lt1000-or$esperaMs-gt3000){throw "Espera provocada fora do intervalo de 1000 a 3000 ms: $esperaMs ms."}
 $travado.Refresh();$descendente.Refresh()
 if($travado.HasExited-or$descendente.HasExited){throw 'Pai/descendente sairam espontaneamente antes de o prazo encerrar a arvore.'}
 Encerrar-ArvoreTeste $travado
 if(!$travado.WaitForExit(5000)){throw 'Watchdog deixou o pai travado vivo.'}
 if(!(Esperar-CondicaoTeste {Testar-ProcessoEncerradoFixture $descendente} -Segundos 5)){throw 'Watchdog encerrou o pai mas deixou o descendente vivo.'}
 # Ausencia agora e o resultado esperado. O handle acima e a prova de que
 # foi aquele descendente, antes vivo, que terminou depois do prazo.
 $restante=Get-Process -Id $descendente.Id -ErrorAction SilentlyContinue
 if($restante){try{if(!(Testar-ProcessoEncerradoFixture $restante)){throw 'Descendente continua ativo apos encerramento pelo prazo.'}}finally{$restante.Dispose()}}
 Write-Host "[OK] Espera provocada durou $esperaMs ms; pai e descendente encerrados pelo prazo."

 # Caso separado: EOF herdado, sem depender de uma corrida pai -> filho.
 # O pai aguarda liberacao explicita e o escritor tem console independente.
 $pai=Start-Process $node -ArgumentList @(('"'+$entrada+'"'),'eof') -PassThru -RedirectStandardOutput (Join-Path $dir 'saida.log') -RedirectStandardError (Join-Path $dir 'erro.log')
 $escritor=Esperar-ProntidaoArvoreTeste $pai (Join-Path $dir 'eof-pronto.json')
 [IO.File]::WriteAllText((Join-Path $dir 'liberar-pai'),'sair')
 if(!(Esperar-CondicaoTeste {$pai.Refresh();$pai.HasExited} -Segundos 5)){throw 'Pai da fixture EOF nao saiu apos liberacao.'}
 $escritor.Refresh();if($escritor.HasExited){throw 'Escritor de EOF terminou antes da verificacao; fixture nao reteve o pipe.'}
 $relogio.Restart()
 if(!(Esperar-ProcessoTeste $pai 1)-or$relogio.Elapsed.TotalSeconds-gt1){throw 'EOF do descendente bloqueou espera por pai ja encerrado.'}
 Write-Host '[OK] Espera pelo pai encerrado nao aguarda EOF do escritor ainda vivo.'
}catch{
 foreach($nome in @('arvore-erro.log','erro.log')){if(Test-Path (Join-Path $dir $nome)){Get-Content (Join-Path $dir $nome) -Tail 20|Write-Host}}
 throw
}finally{
 foreach($p in @($escritor,$descendente,$pai,$travado)){if($p){if(!(Testar-ProcessoEncerradoFixture $p)){Encerrar-ArvoreTeste $p};$p.Dispose()}}
 Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}
