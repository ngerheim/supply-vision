# Executa o fluxo com comandos de firewall simulados, sem alterar o Windows.
$ErrorActionPreference='Stop'
$script:desativadasTeste=@()
$script:removidasTeste=@();$script:criadasTeste=@()
$nodeTeste='C:\ficticio\node.exe'
$script:regrasTeste=@(
 [pscustomobject]@{Name='permitir';DisplayName='Node.js';Action='Allow';Profile='Domain';Programa=$nodeTeste;Porta='3000';Protocolo='TCP'},
 [pscustomobject]@{Name='bloquear';DisplayName='workerd';Action='Block';Profile='Domain';Programa=$nodeTeste;Porta='3000';Protocolo='TCP'},
 [pscustomobject]@{Name='outro-node';DisplayName='Node.js';Action='Allow';Profile='Domain';Programa='C:\alheio\node.exe';Porta='3000';Protocolo='TCP'},
 [pscustomobject]@{Name='outra-porta';DisplayName='Node.js';Action='Allow';Profile='Domain';Programa=$nodeTeste;Porta='4000';Protocolo='TCP'},
 [pscustomobject]@{Name='generica';DisplayName='Node.js';Action='Allow';Profile='Domain';Programa=$nodeTeste;Porta='Any';Protocolo='TCP'},
 [pscustomobject]@{Name='udp';DisplayName='Node.js';Action='Allow';Profile='Domain';Programa=$nodeTeste;Porta='3000';Protocolo='UDP'},
 [pscustomobject]@{Name='legada';DisplayName='Portal Suprimentos (LAN 3000)';Action='Allow';Profile='Domain, Private';Programa='Any';Porta='3000';Protocolo='TCP';Description='Acesso ao Portal Suprimentos pela rede local corporativa';RemoteAddress='LocalSubnet'},
 [pscustomobject]@{Name='especifica';DisplayName='Portal Suprimentos (LAN 3000)';Action='Allow';Profile='Domain, Private';Programa=$nodeTeste;Porta='3000';Protocolo='TCP'}
)
function Get-NetFirewallRule {
  param($DisplayName)
  $script:regrasTeste|Where-Object {!$DisplayName-or$_.DisplayName-eq$DisplayName}
}
function Get-NetFirewallApplicationFilter {process {[pscustomobject]@{Program=$_.Programa}}}
function Get-NetFirewallPortFilter {process {[pscustomobject]@{LocalPort=$_.Porta;Protocol=$_.Protocolo}}}
function Remove-NetFirewallRule { process {$script:removidasTeste+=$_.Name} }
function New-NetFirewallRule {param($Program,$LocalPort);$script:criadasTeste+=@{Program=$Program;LocalPort=$LocalPort}}
function Disable-NetFirewallRule { param($Name);$script:desativadasTeste+=$Name }
function Get-NetIPAddress { [pscustomobject]@{IPAddress='127.0.0.1'} }
function Read-Host { 's' }
. (Join-Path $PSScriptRoot '../../scripts/inicializacao-logica.ps1')
function Localizar-NodeMaquina {return $nodeTeste}
function Obter-PastaPrivada {return (Join-Path $PSScriptRoot 'fixture-ausente')}
function Test-Path {param($LiteralPath);return $LiteralPath-like'*/portal/configuracao/portal.env'-or$LiteralPath-like'*\portal\configuracao\portal.env'}
function Ler-ConfigOperacao {return @{PORTAL_PORTA=$script:portaTeste}}
$fonte=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'restringir-firewall.ps1') -Raw
$fonte=$fonte.Replace('if (-not (EhAdmin))','if ($false)')
$fonte=$fonte.Replace(". (Join-Path `$PSScriptRoot '../../scripts/inicializacao-logica.ps1')",'').Replace('$PSScriptRoot',("'"+$PSScriptRoot+"'"))
foreach($script:portaTeste in @(3000,3210)){
 $script:desativadasTeste=@();$script:removidasTeste=@();$script:criadasTeste=@()
 foreach($regra in $script:regrasTeste){
  if($regra.Name-in@('permitir','especifica','bloquear','outro-node','udp')){$regra.Porta=[string]$script:portaTeste}
  if($regra.Name-eq'especifica'){$regra.DisplayName="Portal Suprimentos (LAN $script:portaTeste)"}
 }
 & ([scriptblock]::Create($fonte)) | Out-Null
 if (($script:desativadasTeste -join ',') -ne 'permitir') { throw 'Regra alheia ou de bloqueio foi alterada.' }
 if(($script:removidasTeste-join',')-ne'especifica'){throw 'Remocao atingiu regra alheia ou legada sem programa.'}
 if($script:criadasTeste.Count-ne1-or$script:criadasTeste[0].Program-ne$nodeTeste-or$script:criadasTeste[0].LocalPort-ne$script:portaTeste){throw 'Regra criada sem programa/porta da instalacao.'}
}
Write-Host 'OK: programa e porta exatos; regras alheias, genericas, bloqueio e formato legado preservados.'
