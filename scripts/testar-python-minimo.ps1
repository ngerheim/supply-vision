$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
function Python-Teste { $global:LASTEXITCODE=0; "Python $script:versaoTeste" }
foreach($versaoTeste in @('3.11.9','3.12.0','3.14.5')) {
  $recusou=$false
  try { Validar-PythonAlertas 'Python-Teste' } catch { $recusou=$true }
  if($recusou -ne ($versaoTeste -eq '3.11.9')) { throw "Validacao incorreta: $versaoTeste" }
}
Write-Host '[OK] Python 3.11 recusado; 3.12 e superior aceitos.'

# Com um executavel de verdade: o substituto acima nao reproduz o codigo de
# saida que o Windows PowerShell atribui a um processo nativo interrompido.
$real = (Get-Command python.exe -ErrorAction SilentlyContinue | Select-Object -First 1).Source
if ($real) {
  Validar-PythonAlertas $real
  Write-Host "[OK] Python real aceito: $real"
} elseif ($env:CI) {
  throw 'CI sem python.exe no PATH para validar com o executavel real.'
}
