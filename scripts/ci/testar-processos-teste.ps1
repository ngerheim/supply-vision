$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'processos-teste.ps1')

# Relogio e executor substituidos so neste escopo: fronteira exata de 5 s,
# sem depender da velocidade do runner ou provocar uma DLL defeituosa real.
& {
 function Executar-TentativaTesteCI {
  param($Executavel,$Argumentos)
  if($Executavel-ne'fixture.exe'-or($Argumentos-join'|')-ne'um|dois'){throw 'Argumentos perdidos.'}
  $r=$script:resultados[[Math]::Min($script:chamadas,$script:resultados.Count-1)]
  $script:chamadas++
  return $r
 }
 $crash=@{codigo=-1073741502;saida=@();duracaoSegundos=0.01}
 $ok=@{codigo=0;saida=@('passou');duracaoSegundos=0.02}
 foreach($caso in @(
  @{nome='recuperado';resultados=@($crash,$ok);chamadas=2;falha=$false},
  @{nome='duplo';resultados=@($crash,$crash);chamadas=2;falha=$true},
  @{nome='segunda falha normal';resultados=@($crash,@{codigo=7;saida=@('erro final');duracaoSegundos=0.01});chamadas=2;falha=$true},
  @{nome='stdout';resultados=@(@{codigo=-1073741502;saida=@('stdout');duracaoSegundos=0.01});chamadas=1;falha=$true},
  @{nome='stderr';resultados=@(@{codigo=-1073741502;saida=@('stderr');duracaoSegundos=0.01});chamadas=1;falha=$true},
  @{nome='linha vazia';resultados=@(@{codigo=-1073741502;saida=@('');duracaoSegundos=0.01});chamadas=1;falha=$true},
  @{nome='outro codigo';resultados=@(@{codigo=7;saida=@();duracaoSegundos=0.01});chamadas=1;falha=$true},
  @{nome='cinco segundos';resultados=@(@{codigo=-1073741502;saida=@();duracaoSegundos=5});chamadas=1;falha=$true},
  @{nome='lento';resultados=@(@{codigo=-1073741502;saida=@();duracaoSegundos=6});chamadas=1;falha=$true}
 )){
  $script:resultados=$caso.resultados;$script:chamadas=0;$captura=@{erro=''}
  $texto=@(& {
   try{Invocar-ProcessoTesteCI 'fixture.exe' @('um','dois') -Teste 'teste-ficticio' -Slot '08:00'}catch{$captura.erro=$_.Exception.Message}
  } 6>&1)-join"`n"
  if($script:chamadas-ne$caso.chamadas-or[bool]$captura.erro-ne$caso.falha){throw "Resultado incorreto: $($caso.nome)"}
  if($caso.chamadas-eq2){
   if(@($texto-split"`n"|Where-Object {$_-like'REPETICAO 0xC0000142:*teste=teste-ficticio; slot=08:00; duracao=*s'}).Count-ne1){throw 'Log de repeticao ausente/duplicado.'}
   if($caso.falha-and$captura.erro-notlike'*houve repeticao*2 tentativas*'){throw 'Falha omitiu repeticao.'}
  }elseif($texto-like'*REPETICAO*'-or$captura.erro-like'*houve repeticao*'){throw 'Repeticao indevida.'}
 }
}
# Transporte real no PS5.1: ambas as streams e o codigo assinado sao preservados.
$node=(Get-Command node.exe -CommandType Application -ErrorAction Stop|Select-Object -First 1).Source
foreach($stream in @('nenhuma','stdout','stderr')){
 $escrita=switch($stream){'stdout'{"console.log('saida ficticia');"};'stderr'{"console.error('erro ficticio');"};default{''}}
 $r=Executar-TentativaTesteCI $node @('-e',($escrita+'process.exit(-1073741502)'))
 if($r.codigo-ne-1073741502-or($stream-eq'nenhuma'-and$r.saida.Count)-or($stream-ne'nenhuma'-and!$r.saida.Count)-or$r.duracaoSegundos-le0){throw "Transporte perdeu codigo/saida/duracao: $stream; $($r|ConvertTo-Json -Compress)"}
}
$pasta=Join-Path ([IO.Path]::GetTempPath()) ('sv-ci-processos-'+[guid]::NewGuid().ToString('N'))
try{
 [void][IO.Directory]::CreateDirectory($pasta)
 $entrada=Join-Path $pasta 'filho.cjs';$contador=Join-Path $pasta 'contador'
 [IO.File]::WriteAllText($entrada,@'
const fs=require('node:fs');
const arquivo=process.argv[2];
const n=fs.existsSync(arquivo)?Number(fs.readFileSync(arquivo,'utf8'))+1:1;
fs.writeFileSync(arquivo,String(n));
process.exit(n===1||process.argv[3]==='duplo'?-1073741502:0);
'@)
 foreach($modo in @('recuperado','duplo')){
  if(Test-Path $contador){Remove-Item -LiteralPath $contador}
  $captura=@{erro=''}
  $texto=@(& {
   try{Invocar-ProcessoTesteCI $node @($entrada,$contador,$modo) -Teste 'filho-real' -Slot '11:00'}catch{$captura.erro=$_.Exception.Message}
  } 6>&1)-join"`n"
  if([IO.File]::ReadAllText($contador)-ne'2'-or$texto-notlike'REPETICAO 0xC0000142:*teste=filho-real; slot=11:00; duracao=*s*'){throw 'Filho real nao repetiu exatamente uma vez.'}
  if(($modo-eq'duplo'-and$captura.erro-notlike'*codigo=-1073741502*houve repeticao*')-or($modo-eq'recuperado'-and$captura.erro)){throw 'Resultado da repeticao real incorreto.'}
 }
}finally{Remove-Item -LiteralPath $pasta -Recurse -Force}
Write-Host 'PASSOU: repeticao unica, diagnostico, streams reais, codigo assinado e fronteira de 5 s.'
$global:LASTEXITCODE=0
