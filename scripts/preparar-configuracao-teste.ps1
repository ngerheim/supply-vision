# Apenas modelos ficticios, em destino novo; nunca envia e-mail ou consulta Qlik.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Destino)
$ErrorActionPreference='Stop'
$Raiz=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if(Test-Path -LiteralPath $Destino){throw 'O destino de teste deve ser uma pasta nova.'}
foreach($dir in @('comum','portal/configuracao','alertas/config','alertas/parametros/de_para','alertas/parametros/filtros')) { New-Item -ItemType Directory -Force (Join-Path $Destino $dir)|Out-Null }
Copy-Item (Join-Path $Raiz 'compartilhado/smtp.env.example') (Join-Path $Destino 'comum/smtp.env')
Copy-Item (Join-Path $Raiz 'compartilhado/operacao.env.example') (Join-Path $Destino 'comum/operacao.env')
$portalEnv=Get-Content (Join-Path $Raiz 'portal/portal.env.example') -Raw -Encoding UTF8
$bytes=New-Object byte[] 32;$rng=[Security.Cryptography.RandomNumberGenerator]::Create()
try{$rng.GetBytes($bytes)}finally{$rng.Dispose()}
$token=($bytes|ForEach-Object{$_.ToString('x2')})-join''
[IO.File]::WriteAllText((Join-Path $Destino 'portal/configuracao/portal.env'),([regex]::Replace($portalEnv,'(?m)^PORTAL_API_TOKEN=.*$',"PORTAL_API_TOKEN=$token")))
foreach($nome in @('cfg_ambiente','cfg_qlik','destinatarios')) { Copy-Item (Join-Path $Raiz "alertas/config/$nome.exemplo.txt") (Join-Path $Destino "alertas/config/$nome.txt") }
Get-ChildItem (Join-Path $Raiz 'alertas/parametros/de_para/*.exemplo.csv')|ForEach-Object{Copy-Item $_.FullName (Join-Path $Destino ('alertas/parametros/de_para/'+($_.Name -replace '\.exemplo\.csv$','.csv')))}
Get-ChildItem (Join-Path $Raiz 'alertas/parametros/filtros/*.exemplo.txt')|ForEach-Object{Copy-Item $_.FullName (Join-Path $Destino ('alertas/parametros/filtros/'+($_.Name -replace '\.exemplo\.txt$','.txt')))}
