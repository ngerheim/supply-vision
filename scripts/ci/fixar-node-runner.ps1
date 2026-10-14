# Exclusivo do runner descartavel: setup-node muda o PATH do usuario, enquanto
# o supervisor SYSTEM e o atualizador escolhem HKLM/PATH da maquina.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Versao)
$ErrorActionPreference='Stop'
if($env:GITHUB_ACTIONS-ne'true'-or$env:RUNNER_OS-ne'Windows'-or$env:OS-ne'Windows_NT'){
 throw 'Fixar Node da maquina exige o runner Windows descartavel do GitHub Actions.'
}
$nodeSelecionado=(Get-Command node.exe -ErrorAction Stop).Source
$versaoReal=(& $nodeSelecionado --version|Out-String).Trim()
if($LASTEXITCODE-or$versaoReal-ne('v'+$Versao)){throw "Node do setup-node diverge do servidor: esperado=$Versao; obtido=$versaoReal."}
$pastaNode=Split-Path $nodeSelecionado
if(!(Test-Path (Join-Path $pastaNode 'npm.cmd'))){throw 'Node do runner nao inclui npm.cmd.'}
$registro='HKLM:\SOFTWARE\Node.js'
New-Item -Path $registro -Force|Out-Null
Set-ItemProperty -Path $registro -Name InstallPath -Value $pastaNode
$caminhoMaquina=[Environment]::GetEnvironmentVariable('Path','Machine')
[Environment]::SetEnvironmentVariable('Path',($pastaNode+';'+$caminhoMaquina),'Machine')
. (Join-Path $PSScriptRoot '../inicializacao-logica.ps1')
$nodeMaquina=Localizar-NodeMaquina
if($nodeMaquina-ne$nodeSelecionado-or(& $nodeMaquina --version)-ne('v'+$Versao)){throw 'Supervisor SYSTEM/atualizador nao selecionou o Node do servidor.'}
Write-Host "Node CLI e da maquina: $versaoReal; $nodeMaquina"
