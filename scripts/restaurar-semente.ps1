# Compatibilidade: restauracao da configuracao e banco pelo mesmo 7z da rede.
[CmdletBinding()]
param([string]$Data)
$ErrorActionPreference='Stop'
$argumentos=@('backup','restaurar','--configuracao')
if($Data){$argumentos+=@('--data',$Data)}
& (Join-Path $PSScriptRoot 'supv.ps1') @argumentos
