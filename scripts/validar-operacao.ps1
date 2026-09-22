[CmdletBinding()]
param([string]$Raiz)
$ErrorActionPreference='Stop'
if(!$Raiz){$Raiz=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path}
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
$privado=Join-Path $Raiz 'privado';$erros=[Collections.Generic.List[string]]::new()
function Falha([string]$m){$erros.Add($m)}
function Exigir-Arquivo([string]$p){
 try{
  if(!(Test-Path -LiteralPath $p -PathType Leaf -ErrorAction Stop)){Falha "Arquivo ausente: $p"}
  elseif((Get-Item -LiteralPath $p -ErrorAction Stop).Length-eq0){Falha "Arquivo vazio: $p"}
 }catch{Falha "Sem acesso ao arquivo: $p ($($_.Exception.Message))"}
}
function Ler-Chaves([string]$p,[string[]]$chaves){
 try{
  if(!(Test-Path -LiteralPath $p -PathType Leaf -ErrorAction Stop)){Falha "Arquivo ausente: $p";return}
  $linhas=@(Get-Content -LiteralPath $p -ErrorAction Stop)
 }catch{Falha "Sem acesso ao arquivo: $p ($($_.Exception.Message))";return}
 $valores=@{};foreach($l in $linhas){$t=$l.Trim();if($t-and!$t.StartsWith('#')-and$t.Contains('=')){$k,$v=$t.Split('=',2);$valores[$k.Trim().ToUpper()]=$v.Trim()}};foreach($k in $chaves){if(!$valores[$k]){Falha "Configuracao ausente em $p`: $k"}};return $valores
}
$op=Join-Path $privado 'comum\operacao.env';try{$cfg=Ler-ConfigOperacao $op;Validar-Horarios $cfg}catch{Falha $_.Exception.Message}
if($cfg){$minimo=0.0;if(![double]::TryParse($cfg['ESPACO_MINIMO_GB'],[Globalization.NumberStyles]::Number,[Globalization.CultureInfo]::InvariantCulture,[ref]$minimo)-or$minimo-lt1){Falha 'ESPACO_MINIMO_GB deve ser um numero maior ou igual a 1.'}}
Ler-Chaves (Join-Path $privado 'comum\smtp.env') @('SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASSWORD','EMAIL_FROM_NAME')|Out-Null
$portalEnv=Join-Path $privado 'portal\configuracao\portal.env'
Ler-Chaves $portalEnv @('PORTAL_URL','PORTAL_API_TOKEN','BACKUP_EMAIL_TO')|Out-Null

# Chave repetida: cada leitor escolhe uma ocorrencia diferente. O build do
# Portal e o rodar.py dos Alertas liam o mesmo arquivo e adotavam linhas
# distintas, e a rota interna respondia 401 sem nada parecer errado.
function Chaves-Repetidas([string]$p){
 if(!(Test-Path -LiteralPath $p -PathType Leaf)){return}
 $vistas=@{}
 foreach($l in @(Get-Content -LiteralPath $p -ErrorAction SilentlyContinue)){
  $t=$l.Trim(); if(!$t -or $t.StartsWith('#') -or !$t.Contains('=')){continue}
  $k=$t.Split('=',2)[0].Trim().ToUpper()
  $v=$t.Split('=',2)[1].Trim(); if(!$v){continue}
  if(!$vistas.ContainsKey($k)){$vistas[$k]=@()}
  $vistas[$k]+=$v
 }
 foreach($k in $vistas.Keys){
  if(@($vistas[$k]|Sort-Object -Unique).Count -gt 1){
   Falha "Chave repetida com valores diferentes em $p`: $k ($($vistas[$k].Count) linhas). Deixe apenas uma."
  }
 }
}
Chaves-Repetidas $portalEnv
Chaves-Repetidas (Join-Path $privado 'comum\smtp.env')
Chaves-Repetidas (Join-Path $privado 'comum\operacao.env')

# O PORTAL_API_TOKEN e embutido no bundle na compilacao, enquanto os Alertas o
# leem do arquivo a cada execucao. Trocar o token sem recompilar deixa os dois
# lados discordando, e o unico sintoma e a rota interna recusando o pipeline.
$dist=Join-Path $Raiz 'portal\dist'
$tokenArquivo=''
try{
 $linhaToken=@(Get-Content -LiteralPath $portalEnv -ErrorAction Stop)|Where-Object{$_ -match '^\s*PORTAL_API_TOKEN\s*=\s*\S'}|Select-Object -Last 1
 if($linhaToken){$tokenArquivo=($linhaToken -split '=',2)[1].Trim()}
}catch{}
if($tokenArquivo -and (Test-Path -LiteralPath $dist)){
 $noBundle=@(Get-ChildItem -LiteralPath $dist -Recurse -File -Include *.js -ErrorAction SilentlyContinue|Select-String -Pattern ([regex]::Escape($tokenArquivo)) -List -ErrorAction SilentlyContinue).Count
 if(!$noBundle){
  Falha 'O PORTAL_API_TOKEN do portal.env nao esta no Portal compilado. Recompile (Atualizar sistema, ou atualizar-servidor.ps1 -Reaplicar) antes de operar: os Alertas receberao 401.'
 }
}
$amb=Ler-Chaves (Join-Path $privado 'alertas\config\cfg_ambiente.txt') @('QLIK_TENANT','QLIK_APP_ID','QLIK_OBJ_ID','DESTINATARIO_ALERTA')
Exigir-Arquivo (Join-Path $privado 'alertas\config\cfg_qlik.txt');Exigir-Arquivo (Join-Path $privado 'alertas\config\destinatarios.txt')
Exigir-Arquivo (Join-Path $privado 'alertas\parametros\de_para\itens.csv');Exigir-Arquivo (Join-Path $privado 'alertas\parametros\de_para\modelos.csv')
Exigir-Arquivo (Join-Path $Raiz 'portal\dist\server\wrangler.json');Exigir-Arquivo (Join-Path $Raiz 'alertas\.venv\Scripts\python.exe')
foreach($d in @((Join-Path $privado 'operacao'),(Join-Path $privado 'portal\logs'),(Join-Path $privado 'alertas\logs'),(Join-Path $privado 'alertas\relatorios\diarios'),(Join-Path $privado 'alertas\relatorios\historicos'))){try{New-Item -ItemType Directory -Force $d|Out-Null;$t=Join-Path $d ('.escrita-'+[guid]::NewGuid().ToString('N'));[IO.File]::WriteAllText($t,'ok');Remove-Item $t -Force}catch{Falha "Sem permissao de escrita: $d"}}
foreach($cmd in @('node.exe','npm.cmd')){if(!(Get-Command $cmd -ErrorAction SilentlyContinue)){Falha "Programa ausente: $cmd"}}
if($erros.Count){$erros|ForEach-Object{Write-Error $_ -ErrorAction Continue};throw "Validacao operacional reprovada em $($erros.Count) item(ns)."}
Write-Host 'Configuracao operacional aprovada.' -ForegroundColor Green
