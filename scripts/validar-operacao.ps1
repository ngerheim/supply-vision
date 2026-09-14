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
Ler-Chaves (Join-Path $privado 'portal\configuracao\portal.env') @('PORTAL_URL','BACKUP_EMAIL_TO')|Out-Null
$amb=Ler-Chaves (Join-Path $privado 'alertas\config\cfg_ambiente.txt') @('QLIK_TENANT','QLIK_APP_ID','QLIK_OBJ_ID','DESTINATARIO_ALERTA','ACORDO_PATH')
Exigir-Arquivo (Join-Path $privado 'alertas\config\cfg_qlik.txt');Exigir-Arquivo (Join-Path $privado 'alertas\config\destinatarios.txt')
Exigir-Arquivo (Join-Path $privado 'alertas\parametros\de_para\itens.csv');Exigir-Arquivo (Join-Path $privado 'alertas\parametros\de_para\modelos.csv')
if($amb-and$amb['ACORDO_PATH']){Exigir-Arquivo $amb['ACORDO_PATH']}
Exigir-Arquivo (Join-Path $Raiz 'portal\dist\server\wrangler.json');Exigir-Arquivo (Join-Path $Raiz 'alertas\.venv\Scripts\python.exe')
foreach($d in @((Join-Path $privado 'operacao'),(Join-Path $privado 'portal\logs'),(Join-Path $privado 'alertas\logs'),(Join-Path $privado 'alertas\relatorios\diarios'),(Join-Path $privado 'alertas\relatorios\historicos'))){try{New-Item -ItemType Directory -Force $d|Out-Null;$t=Join-Path $d ('.escrita-'+[guid]::NewGuid().ToString('N'));[IO.File]::WriteAllText($t,'ok');Remove-Item $t -Force}catch{Falha "Sem permissao de escrita: $d"}}
foreach($cmd in @('node.exe','npm.cmd')){if(!(Get-Command $cmd -ErrorAction SilentlyContinue)){Falha "Programa ausente: $cmd"}}
if($erros.Count){$erros|ForEach-Object{Write-Error $_ -ErrorAction Continue};throw "Validacao operacional reprovada em $($erros.Count) item(ns)."}
Write-Host 'Configuracao operacional aprovada.' -ForegroundColor Green
