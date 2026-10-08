$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
$anterior=$env:MODO_ENSAIO
try {
 foreach($config in @(@{},@{MODO_ENSAIO='0'},@{MODO_ENSAIO='true'})) {
  $env:MODO_ENSAIO='1'
  if(Aplicar-ModoEnsaio $config){throw 'Ensaio foi ativado sem valor 1.'}
  if($env:MODO_ENSAIO-ne'0'){throw 'Modo herdado nao foi desativado.'}
  if(((Argumentos-Pipeline '08:00' $false)-join '|')-ne 'processo\pipeline.py|--slot|08:00'){throw 'Chamada normal foi alterada.'}
 }
 if(!(Aplicar-ModoEnsaio @{MODO_ENSAIO='1'})){throw 'Ensaio nao ativou.'}
 if($env:MODO_ENSAIO-ne'1'){throw 'Ensaio nao foi propagado.'}
 if(((Argumentos-Pipeline '08:00' $true)-join '|')-ne 'processo\pipeline.py|--slot|08:00|--sem-envio'){throw 'Ensaio nao acrescentou --sem-envio.'}
 if((Obter-AvisoEnsaio $true)-ne'MODO ENSAIO — nenhum e-mail ou backup em rede'){throw 'Aviso da central incorreto.'}
 if((Obter-AvisoEnsaio $false)-ne''){throw 'Aviso apareceu fora do ensaio.'}
 Write-Host 'Modo ensaio: configuracao, argumentos e aviso aprovados.'
} finally { $env:MODO_ENSAIO=$anterior }
