# Restringe o acesso de rede ao Portal Suprimentos.
# EXECUTE COMO ADMINISTRADOR (botao direito > Executar como administrador).
#
# Regras sem programa/porta exatos nao identificam o Portal e sao preservadas.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../scripts/inicializacao-logica.ps1')
$raiz = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$node = Localizar-NodeMaquina
$config = @{}
$arquivoConfig = Join-Path (Obter-PastaPrivada $raiz) 'portal/configuracao/portal.env'
if (Test-Path -LiteralPath $arquivoConfig) { $config = Ler-ConfigOperacao $arquivoConfig }
$porta = Obter-PortaPortalLocal $config
$nome = "Portal Suprimentos (LAN $porta)"
$faixa = 'LocalSubnet'

function Testar-RegraPortal($Regra) {
  $aplicacao = @($Regra | Get-NetFirewallApplicationFilter -ErrorAction Stop)
  $filtro = @($Regra | Get-NetFirewallPortFilter -ErrorAction Stop)
  return $aplicacao.Count -eq 1 -and $filtro.Count -eq 1 -and
    [string]$aplicacao[0].Program -eq $node -and @($filtro[0].LocalPort).Count -eq 1 -and
    [string]$filtro[0].LocalPort -eq [string]$porta -and [string]$filtro[0].Protocol -in @('TCP','6')
}

function EhAdmin {
  (New-Object Security.Principal.WindowsPrincipal(
    [Security.Principal.WindowsIdentity]::GetCurrent())
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (EhAdmin)) {
  Write-Host ''
  Write-Host '  Este script precisa ser executado como Administrador.' -ForegroundColor Red
  Write-Host '  Feche, clique com o botao direito e escolha "Executar como administrador".' -ForegroundColor Yellow
  Write-Host ''
  Read-Host '  Enter para fechar'
  exit 1
}

Write-Host ''
Write-Host '  === Antes ===' -ForegroundColor Cyan
Get-NetFirewallRule -Direction Inbound -Enabled True -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -match 'node|workerd|Portal Suprimentos' } |
  Select-Object DisplayName, Profile, Action | Format-Table -AutoSize

# 1) Regra especifica do portal
Get-NetFirewallRule -DisplayName $nome -Direction Inbound -ErrorAction SilentlyContinue |
  Where-Object { $_.Action -eq 'Allow' -and (Testar-RegraPortal $_) } | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $nome -Direction Inbound -Protocol TCP `
  -Program $node -LocalPort $porta -Action Allow -Profile Domain,Private -RemoteAddress $faixa `
  -Description 'Acesso ao Portal Suprimentos pela rede local corporativa' | Out-Null
Write-Host "  Regra criada: TCP $porta, perfis Domain/Private, origem $faixa" -ForegroundColor Green

# 2) Pausa para teste antes de fechar as regras amplas
Write-Host ''
Write-Host '  TESTE AGORA a partir de outro computador da empresa, antes de continuar.' -ForegroundColor Yellow
Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
  ForEach-Object { Write-Host "     http://$($_.IPAddress):$porta/" -ForegroundColor White }
Write-Host ''
$resposta = Read-Host '  O portal abriu no outro computador? (s/n)'

if ($resposta -notmatch '^[sS]') {
  Write-Host ''
  Write-Host '  As regras amplas foram MANTIDAS. Nada mais foi alterado.' -ForegroundColor Yellow
  Write-Host '  A regra especifica continua criada e nao atrapalha.' -ForegroundColor Gray
  Write-Host ''
  Read-Host '  Enter para fechar'
  exit 0
}

# 3) Desativa somente regras atribuiveis ao programa e porta do Portal.
$amplas = Get-NetFirewallRule -Direction Inbound -Enabled True |
  Where-Object { $_.Action -eq 'Allow' -and $_.DisplayName -match 'Node\.js|workerd' -and (Testar-RegraPortal $_) }
$desativadas = @()
foreach ($r in $amplas) {
  Disable-NetFirewallRule -Name $r.Name
  $desativadas += $r.Name
  Write-Host "  Desativada: $($r.DisplayName) [$($r.Profile)]" -ForegroundColor Green
}

Write-Host ''
Write-Host '  === Depois ===' -ForegroundColor Cyan
Get-NetFirewallRule -Direction Inbound -Enabled True -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -match 'node|workerd|Portal Suprimentos' } |
  Select-Object DisplayName, Profile, Action | Format-Table -AutoSize

Write-Host '  Teste de novo pelo outro computador. Se algo parar de funcionar:' -ForegroundColor Yellow
foreach ($regra in $desativadas) {
  $nomeSeguro = $regra.Replace("'", "''")
  Write-Host "     Enable-NetFirewallRule -Name '$nomeSeguro'" -ForegroundColor Gray
}
Write-Host ''
Read-Host '  Enter para fechar'
