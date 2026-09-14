# Abre a porta 3000 para a rede local. Execute como Administrador.
$ErrorActionPreference = 'Stop'

$existente = Get-NetFirewallRule -DisplayName "Portal Suprimentos*" -ErrorAction SilentlyContinue
if ($existente) { $existente | Remove-NetFirewallRule }

New-NetFirewallRule `
  -DisplayName "Portal Suprimentos (LAN 3000)" `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort 3000 `
  -Action Allow `
  -Profile Domain,Private `
  -RemoteAddress LocalSubnet `
  -Description "Acesso ao Portal Suprimentos pela rede local corporativa" | Out-Null

Write-Host ""
Write-Host "Regra criada. O portal agora aceita conexoes da rede local." -ForegroundColor Green
Write-Host ""
Write-Host "Enderecos para os colegas:" -ForegroundColor Cyan
Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
  ForEach-Object { Write-Host "   http://$($_.IPAddress):3000/   ($($_.InterfaceAlias))" }
Write-Host ""
Write-Host "Para revogar o acesso depois, execute:" -ForegroundColor Yellow
Write-Host '   Remove-NetFirewallRule -DisplayName "Portal Suprimentos (LAN 3000)"'
Write-Host ""
Read-Host "Pressione Enter para fechar"
