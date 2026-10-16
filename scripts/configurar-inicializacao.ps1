[CmdletBinding()]
param([ValidateSet('desligado','computador')][Parameter(Mandatory=$true)][string]$Modo,[switch]$ContaPersonalizada,[string]$NodeExecutavel)
$ErrorActionPreference='Stop'
$raiz=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
. (Join-Path $PSScriptRoot 'inicializacao-logica.ps1')
if(!(Testar-Elevacao)){throw 'Escolher o modo exige executar como administrador.'}
if($ContaPersonalizada-and$Modo-ne'computador'){throw 'ContaPersonalizada so pode ser usada no modo computador.'}
$credencial=$null
if($Modo-eq'computador'){$credencial=Get-Credential -Message 'Conta que executara a tarefa Supply Vision';if(!$credencial){throw 'Conta nao informada.'}}
Definir-ModoInicializacao $raiz (Obter-PastaPrivada $raiz) $Modo $NodeExecutavel $credencial

Write-Host "Inicializacao configurada com sucesso: $Modo." -ForegroundColor Green
if($credencial){Write-Host 'Se a senha da conta mudar, execute novamente este comando com -ContaPersonalizada para atualizar a tarefa.'}
