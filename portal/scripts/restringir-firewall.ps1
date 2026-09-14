# Restringe o acesso de rede ao Portal Suprimentos.
# EXECUTE COMO ADMINISTRADOR (botao direito > Executar como administrador).
#
# Hoje existem regras amplas liberando node.exe e workerd.exe em QUALQUER
# porta no perfil de dominio. Este script cria uma regra especifica para a
# porta 3000 e desativa as amplas, deixando exposto so o que o portal precisa.
$ErrorActionPreference = 'Stop'
$nome = 'Portal Suprimentos (LAN 3000)'
$faixa = 'LocalSubnet'

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
Get-NetFirewallRule -DisplayName $nome -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $nome -Direction Inbound -Protocol TCP `
  -LocalPort 3000 -Action Allow -Profile Domain,Private -RemoteAddress $faixa `
  -Description 'Acesso ao Portal Suprimentos pela rede local corporativa' | Out-Null
Write-Host "  Regra criada: TCP 3000, perfis Domain/Private, origem $faixa" -ForegroundColor Green

# 2) Pausa para teste antes de fechar as regras amplas
Write-Host ''
Write-Host '  TESTE AGORA a partir de outro computador da empresa, antes de continuar.' -ForegroundColor Yellow
Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
  ForEach-Object { Write-Host "     http://$($_.IPAddress):3000/" -ForegroundColor White }
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

# 3) Desativa (nao apaga) as regras amplas de node e workerd
$amplas = Get-NetFirewallRule -Direction Inbound -Enabled True |
  Where-Object { $_.DisplayName -match 'Node\.js|workerd' }
foreach ($r in $amplas) {
  Disable-NetFirewallRule -Name $r.Name
  Write-Host "  Desativada: $($r.DisplayName) [$($r.Profile)]" -ForegroundColor Green
}

Write-Host ''
Write-Host '  === Depois ===' -ForegroundColor Cyan
Get-NetFirewallRule -Direction Inbound -Enabled True -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -match 'node|workerd|Portal Suprimentos' } |
  Select-Object DisplayName, Profile, Action | Format-Table -AutoSize

Write-Host '  Teste de novo pelo outro computador. Se algo parar de funcionar:' -ForegroundColor Yellow
Write-Host "     Get-NetFirewallRule -Direction Inbound | Where-Object { `$_.DisplayName -match 'Node\.js|workerd' } | Enable-NetFirewallRule" -ForegroundColor Gray
Write-Host ''
Read-Host '  Enter para fechar'
