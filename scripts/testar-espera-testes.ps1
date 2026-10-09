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
