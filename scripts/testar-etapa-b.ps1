$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'inicializacao-logica.ps1')
$global:membros=@();$global:adicionados=@();$global:criados=0
function Get-LocalGroup {if($global:criados){return @{SID=@{Value='S-1-5-21-100-100-100-999'}}}}
function New-LocalGroup {$global:criados++;return @{SID=@{Value='S-1-5-21-100-100-100-999'}}}
function Get-LocalGroupMember {param($SID,$Group);if($SID){return @(@{SID=@{Value='S-1-5-21-100-100-100-1001'}})};return @($global:membros|ForEach-Object {@{SID=@{Value=$_}}})}
function Add-LocalGroupMember {param($Group,$Member);$global:adicionados+=$Member;$global:membros+=$Member}
$um=Preparar-GrupoOperadores
$dois=Preparar-GrupoOperadores
if($um-ne$dois-or$global:criados-ne1-or$global:adicionados.Count-ne1){throw 'Grupo deve ser fixo e aditivo'}
if(!(Testar-ContaAdministradora 'SYSTEM')){throw 'SYSTEM deve ser aceito'}
$global:logs=@();$global:avisos=@();$avisosAdmin=@{Habilitado=$true}
function Log {param($Texto);$global:logs+=$Texto}
function Avisar-Administrador {param($Controle,$Evento);$global:avisos+=$Evento}
function Get-CimInstance {throw 'acesso negado ficticio'}
Encerrar-OrfaosInstalacao 'C:\Ficticio'
if(!$global:logs.Count-or$global:avisos[-1]-ne'orfaos-falharam'){throw 'Leitura negada deve avisar sem abortar'}
function Get-CimInstance {return @{Name='node.exe';CommandLine='"C:\Ficticio\portal\scripts\processar-emails.mjs"';ProcessId=42;CreationDate='hoje'}}
function taskkill.exe {throw 'acesso negado ficticio'}
Encerrar-OrfaosInstalacao 'C:\Ficticio'
if($global:avisos.Count-ne2){throw 'Encerramento negado deve avisar sem abortar'}
Write-Host 'PASSOU: grupo fixo, reconfiguracao aditiva e duas falhas de orfaos sem abortar.'
