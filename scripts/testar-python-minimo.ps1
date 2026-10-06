$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
function Python-Teste { $global:LASTEXITCODE=0; "Python $script:versaoTeste" }
foreach($versaoTeste in @('3.11.9','3.12.0','3.14.5')) {
  $recusou=$false
  try { Validar-PythonAlertas 'Python-Teste' } catch { $recusou=$true }
  if($recusou -ne ($versaoTeste -eq '3.11.9')) { throw "Validacao incorreta: $versaoTeste" }
}
Write-Host '[OK] Python 3.11 recusado; 3.12 e superior aceitos.'
