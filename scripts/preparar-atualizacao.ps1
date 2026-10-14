# Executado em processo oculto separado, exclusivamente no worktree descartavel.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Instalacao,[switch]$ReinstalarNode,[switch]$ReinstalarPython)
$ErrorActionPreference='Stop'
$Raiz=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
. (Join-Path $PSScriptRoot 'atualizacao-preparo.ps1')
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
Validar-PastaPreparo $Instalacao $Raiz
# Nao herdar caminhos, credenciais, caches ou modo de producao.
Get-ChildItem Env: | Where-Object Name -Match '^(SUPPLY_VISION_|SV_|PORTAL_|SMTP_|EMAIL_|BACKUP_|QLIK_|ADMIN_|MODO_ENSAIO|RELATORIOS_|WRANGLER_|MINIFLARE_|XDG_|CLOUDFLARE_|CF_|NPM_CONFIG_|PIP_|PYTHONPATH$|VIRTUAL_ENV$)' | ForEach-Object {Remove-Item ('Env:'+$_.Name)}
$env:SUPPLY_VISION_PRIVADO=Join-Path $Raiz 'privado'
$env:PORTAL_BANCO_LOCAL='sqlite'
$env:MODO_ENSAIO='1'
$env:SV_PREPARO_RAIZ=$Raiz
$env:XDG_CONFIG_HOME=Join-Path $Raiz '.cache'
$env:XDG_CACHE_HOME=$env:XDG_CONFIG_HOME
[void][IO.Directory]::CreateDirectory($env:XDG_CONFIG_HOME)
$env:TEMP=$env:XDG_CONFIG_HOME;$env:TMP=$env:XDG_CONFIG_HOME
$env:WRANGLER_CACHE_DIR=Join-Path $env:XDG_CONFIG_HOME 'wrangler'
$env:WRANGLER_LOG_PATH=Join-Path $Raiz '.cache/wrangler.log'
$env:WRANGLER_SEND_METRICS='false'
$env:MINIFLARE_REGISTRY_PATH=Join-Path $Raiz '.cache/registry'
function Executar-Preparo([scriptblock]$Comando,[string]$Falha) {
 $preferencia=$ErrorActionPreference;$inicio=[datetime]::UtcNow
 try{$ErrorActionPreference='Continue'; & $Comando; $codigo=$LASTEXITCODE}
 finally{$ErrorActionPreference=$preferencia}
 $nome=$Falha-replace' falhou no preparo\.',''-replace' falharam no preparo\.',''-replace' falhou no preparo:',':'
 $tempo=[math]::Round(([datetime]::UtcNow-$inicio).TotalSeconds,2)
 $linha="PREPARAR / ${nome}: codigo=$codigo; duracao=$tempo s."
 Add-Content -LiteralPath (Join-Path $Raiz 'preparo-tempos.log') -Value $linha
 Write-Host $linha
 if($codigo-ne0){throw $Falha}
}
Set-Location $Raiz
try {
 & (Join-Path $PSScriptRoot 'preparar-configuracao-teste.ps1') -Destino $env:SUPPLY_VISION_PRIVADO
 # Somente modelos ficticios; nem mesmo SMTP/URL dos exemplos podem sair na rede.
 [IO.File]::WriteAllText((Join-Path $env:SUPPLY_VISION_PRIVADO 'comum/smtp.env'),"SMTP_HOST=127.0.0.1`nSMTP_PORT=1`nSMTP_USER=teste`nSMTP_PASSWORD=teste`nEMAIL_FROM_NAME=teste`n")
 Add-Content (Join-Path $env:SUPPLY_VISION_PRIVADO 'comum/operacao.env') "`nMODO_ENSAIO=1`nADMIN_ALERTA_EMAIL="
 $configPortal=Join-Path $env:SUPPLY_VISION_PRIVADO 'portal/configuracao/portal.env'
 $texto=[IO.File]::ReadAllText($configPortal)
 $texto=[regex]::Replace($texto,'(?m)^PORTAL_URL=.*$','PORTAL_URL=http://127.0.0.1:59998')
 $texto=[regex]::Replace($texto,'(?m)^BACKUP_EMAIL_TO=.*$','BACKUP_EMAIL_TO=teste@example.invalid')
 [IO.File]::WriteAllText($configPortal,($texto+"`nRELATORIOS_PORTA=59997`n"))
 $portal=Join-Path $Raiz 'portal';$alertas=Join-Path $Raiz 'alertas'
 if($ReinstalarNode-or!(Copiar-DependenciasPreparo (Join-Path $Instalacao 'portal/node_modules') (Join-Path $portal 'node_modules'))){
  Push-Location $portal
  try{Executar-Preparo {& npm.cmd ci --no-audit --no-fund} 'npm ci falhou no preparo.'}finally{Pop-Location}
 }else{Write-Host 'Node: dependencias reaproveitadas por copia isolada.'}
 # npm cria junctions para pacotes file: (fast-glob/vendor). Materializa antes
 # de mover node_modules; links absolutos apontariam para o preparo ja limpo.
 $modulos=Join-Path $portal 'node_modules'
 if(@(Get-ChildItem -LiteralPath $modulos -Recurse -Force -Attributes ReparsePoint).Count){
  [void](Copiar-DependenciasPreparo $modulos ($modulos+'-isolado'))
  [IO.Directory]::Move($modulos,($modulos+'-instalado'))
  [IO.Directory]::Move(($modulos+'-isolado'),$modulos)
 }
 if($ReinstalarPython-or!(Copiar-DependenciasPreparo (Join-Path $Instalacao 'alertas/.venv') (Join-Path $alertas '.venv'))){
  Executar-Preparo {& python.exe -m venv (Join-Path $alertas '.venv')} 'Criacao do venv falhou no preparo.'
  Executar-Preparo {& (Join-Path $alertas '.venv/Scripts/python.exe') -m pip install -r (Join-Path $alertas 'config/requirements.txt') -r (Join-Path $alertas 'config/requirements-dev.txt') --quiet} 'pip install falhou no preparo.'
 }else{Write-Host 'Python: dependencias reaproveitadas por copia isolada.'}
 Validar-PythonAlertas (Join-Path $alertas '.venv/Scripts/python.exe')
 Push-Location $portal
 try{
  Executar-Preparo {& npm.cmd run build} 'Build do Portal falhou no preparo.'
  Executar-Preparo {& npm.cmd test} 'Testes do Portal falharam no preparo.'
 }finally{Pop-Location}
 Push-Location $alertas
 try{Executar-Preparo {& (Join-Path $alertas '.venv/Scripts/python.exe') -m pytest tests -q} 'Testes dos Alertas falharam no preparo.'}finally{Pop-Location}
 foreach($teste in @('validar-operacao.ps1','testar-operacao.ps1','testar-supervisor-isolado.ps1','testar-persistencia-alertas.ps1')){
  Executar-Preparo {Executar-PowerShellOculto @('-NoProfile','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot $teste))} "Teste operacional falhou no preparo: $teste"
 }
 [IO.File]::WriteAllText((Join-Path $Raiz 'preparo-aprovado'),(& git rev-parse HEAD).Trim())
 exit 0
}catch{Write-Error "PREPARAR falhou; operacao original continua no ar: $($_.Exception.Message)" -ErrorAction Continue;exit 1}
