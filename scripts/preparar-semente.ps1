# Compatibilidade: a semente agora integra o backup 7z unico da rede.
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
. (Join-Path $PSScriptRoot 'inicializacao-logica.ps1')
$Raiz=Split-Path $PSScriptRoot
[void](Aplicar-ModoEnsaio (Ler-ConfigOperacao (Join-Path (Obter-PastaPrivada $Raiz) 'comum/operacao.env')))
$r=Executar-NativoOperacao (Localizar-NodeMaquina) @((Join-Path $Raiz 'portal/scripts/backup.mjs'))
$r.saida|ForEach-Object {Write-Host $_}
if($r.codigo-ne0){throw 'Backup nao confirmado. Confira a rede, senha e 7-Zip.'}
