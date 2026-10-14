# Apenas fixtures novas; exercita renomeacoes reais inclusive falha parcial.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'atualizacao-preparo.ps1')
$base=Join-Path ([IO.Path]::GetTempPath()) ('sv-h1-'+[guid]::NewGuid().ToString('N'))
$raiz=Join-Path $base 'instalacao'
function Exigir($Condicao,[string]$Mensagem){if(!$Condicao){throw $Mensagem}}
try{
 New-Item -ItemType Directory -Force $raiz|Out-Null
 foreach($caso in @('sucesso','falha-parcial','dependencias')){
  $preparo=Nova-PastaPreparo $raiz
  New-Item -ItemType Directory -Force $preparo|Out-Null
  foreach($rel in @('portal/dist','portal/node_modules','alertas/.venv')){
   New-Item -ItemType Directory -Force (Join-Path $raiz $rel),(Join-Path $preparo $rel)|Out-Null
   [IO.File]::WriteAllText((Join-Path $raiz "$rel/versao"),'anterior')
   [IO.File]::WriteAllText((Join-Path $preparo "$rel/versao"),'nova')
  }
  if($caso-eq'dependencias'){
   $copia=Join-Path $preparo 'copia'
   Exigir (Copiar-DependenciasPreparo (Join-Path $raiz 'portal/node_modules') $copia) 'Nao reaproveitou dependencias.'
   [IO.File]::WriteAllText((Join-Path $copia 'versao'),'teste alterou copia')
   Exigir ((Get-Content (Join-Path $raiz 'portal/node_modules/versao'))-eq'anterior') 'Copia alterou producao.'
   $vendor=Join-Path $raiz 'portal/vendor/pacote'
   New-Item -ItemType Directory -Force $vendor|Out-Null
   [IO.File]::WriteAllText((Join-Path $vendor 'versao'),'vendor')
   $link=Join-Path $raiz 'portal/node_modules/pacote'
   New-Item -ItemType $(if($env:OS-eq'Windows_NT'){'Junction'}else{'SymbolicLink'}) -Path $link -Target $vendor|Out-Null
   $isolado=Join-Path $preparo 'com-vendor'
   [void](Copiar-DependenciasPreparo (Join-Path $raiz 'portal/node_modules') $isolado)
   if((Get-Item -LiteralPath (Join-Path $isolado 'pacote') -Force).Attributes-band[IO.FileAttributes]::ReparsePoint){throw 'Junction sobreviveu a copia.'}
   [IO.File]::WriteAllText((Join-Path $isolado 'pacote/versao'),'teste')
   Exigir ((Get-Content (Join-Path $vendor 'versao'))-eq'vendor') 'Link copiado alterou vendor da instalacao.'
   $privado=Join-Path $raiz 'privado';New-Item -ItemType Directory -Force $privado|Out-Null
   New-Item -ItemType $(if($env:OS-eq'Windows_NT'){'Junction'}else{'SymbolicLink'}) -Path (Join-Path $raiz 'portal/node_modules/proibido') -Target $privado|Out-Null
   $recusou=$false
   try{[void](Copiar-DependenciasPreparo (Join-Path $raiz 'portal/node_modules') (Join-Path $preparo 'proibido'))}catch{$recusou=$true}
   Exigir $recusou 'Copia seguiu link para privado da producao.'
   Exigir (!(Copiar-DependenciasPreparo (Join-Path $raiz 'ausente') (Join-Path $preparo 'ausente'))) 'Dependencias ausentes devem instalar.'
  }else{
   if($caso-eq'falha-parcial'){Remove-Item (Join-Path $preparo 'alertas/.venv') -Recurse -Force}
   $falhou=$false
   try{Trocar-ArtefatosPreparo $raiz $preparo}catch{$falhou=$true;if($caso-eq'sucesso'){throw}}
   Exigir ($falhou-eq($caso-eq'falha-parcial')) 'Resultado inesperado da troca.'
   Exigir ((Get-Content (Join-Path $raiz 'portal/dist/versao'))-eq'nova') 'Dist nao entrou.'
   Restaurar-ArtefatosPreparo $raiz $preparo
   foreach($rel in @('portal/dist','portal/node_modules','alertas/.venv')){Exigir ((Get-Content (Join-Path $raiz "$rel/versao"))-eq'anterior') "Reversao incompleta: $rel"}
   Restaurar-ArtefatosPreparo $raiz $preparo # idempotente
  }
  Remove-Item -LiteralPath $preparo -Recurse -Force
  Write-Host "[OK] H1 artefatos: $caso"
 }
 # Processo real, sem depender de mocks: ambos os canais e argumentos com
 # espacos/aspas/barras atravessam o lancador, com codigo de saida preservado.
 $filho=Join-Path $base 'filho com espacos.ps1'
 [IO.File]::WriteAllText($filho,'param($Texto) Write-Output ($Texto|ConvertTo-Json -Compress); [Console]::Error.WriteLine("stderr-ficticio"); exit 7')
 $argumento='com espaco "aspas" e barra\'
 $hostTeste=(Get-Process -Id $PID).Path
 $saida=@(Executar-PowerShellOculto @('-NoProfile','-File',$filho,$argumento) $hostTeste)
 Exigir ($LASTEXITCODE-eq7) 'Lancador oculto perdeu codigo de saida.'
 Exigir (($saida[0].Trim()|ConvertFrom-Json)-eq$argumento) 'Lancador oculto alterou argumentos.'
 Exigir (($saida-join' ')-like'*stderr-ficticio*') 'Lancador oculto perdeu stderr.'
 Write-Host '[OK] Processo oculto: argumentos, stdout, stderr e codigo 7.'
 $rejeitou=$false;try{Validar-PastaPreparo $raiz $raiz}catch{$rejeitou=$true};Exigir $rejeitou 'Aceitou instalacao como preparo.'
}finally{if(Test-Path $base){Remove-Item $base -Recurse -Force}}

$global:LASTEXITCODE=0
