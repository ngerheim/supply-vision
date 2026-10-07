# Executa o fluxo com comandos de firewall simulados, sem alterar o Windows.
$ErrorActionPreference='Stop'
$script:desativadasTeste=@()
function Get-NetFirewallRule {
  [pscustomobject]@{Name='permitir';DisplayName='Node.js';Action='Allow';Profile='Domain'}
  [pscustomobject]@{Name='bloquear';DisplayName='workerd';Action='Block';Profile='Domain'}
}
function Remove-NetFirewallRule { process {} }
function New-NetFirewallRule {}
function Disable-NetFirewallRule { param($Name);$script:desativadasTeste+=$Name }
function Get-NetIPAddress { [pscustomobject]@{IPAddress='127.0.0.1'} }
function Read-Host { 's' }
$fonte=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'restringir-firewall.ps1') -Raw
$fonte=$fonte.Replace('if (-not (EhAdmin))','if ($false)')
& ([scriptblock]::Create($fonte)) | Out-Null
if (($script:desativadasTeste -join ',') -ne 'permitir') { throw 'Regra de bloqueio foi alterada.' }
Write-Host 'OK: somente regras Allow foram desativadas.'
