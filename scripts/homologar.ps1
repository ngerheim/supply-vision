[CmdletBinding()]
param([string]$Destino)
$ErrorActionPreference='Stop'
$Raiz=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
. (Join-Path $PSScriptRoot 'inicializacao-logica.ps1')
$privado=Obter-PastaPrivada $Raiz
if(!$Destino){$Destino=Join-Path ([Environment]::GetFolderPath('Desktop')) ('Supply-Vision-homologacao-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.txt')}
$caminhoRelatorio=[IO.Path]::GetFullPath($Destino)
$raizPrivada=[IO.Path]::GetFullPath($privado).TrimEnd('\')+'\'
if([IO.Path]::GetExtension($caminhoRelatorio)-ne'.txt'-or$caminhoRelatorio.StartsWith($raizPrivada,[StringComparison]::OrdinalIgnoreCase)){throw 'Escolha um arquivo .txt fora da pasta privado para o relatorio.'}
$linhas=New-Object 'Collections.Generic.List[string]'
$segredos=@()
foreach($arquivo in @(Get-ChildItem -LiteralPath $privado -Filter '*.env' -Recurse -File -ErrorAction SilentlyContinue)){
 foreach($l in Get-Content $arquivo.FullName){
  if($l-match '^\s*([^#=]+)=(.+)$'){
   $chave=$Matches[1];$valor=$Matches[2]
   if($chave-match '(?i)TOKEN|PASS|SENHA|SECRET|SMTP|EMAIL|KEY'){$segredos+=$valor.Trim()}
  }
 }
}
function Mascarar-Homologacao([string]$Texto){
 foreach($s in $segredos){if($s){$Texto=$Texto.Replace($s,'[mascarado]')}}
 $Texto=[regex]::Replace($Texto,'[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}','[email mascarado]')
 $Texto=[regex]::Replace($Texto,'(?i)(authorization|bearer|token|password|senha|secret|api[_-]?key)\s*[:= ]\s*\S+','$1=[mascarado]')
 # Nao reproduz URLs com credenciais nem linhas com consultas ou registros de banco.
 if($Texto-match '(?i)://[^/\s]+@|\b(SELECT|INSERT|UPDATE|DELETE)\b|[{}]|\b(chamado|usuario|preco|payload)\s*[:=]'){return '[conteudo omitido]'}
 return $Texto
}
function Item-Homologacao([string]$Nome,[scriptblock]$Conferir){
 try{$detalhe=& $Conferir;$linhas.Add('✅ '+(Mascarar-Homologacao $Nome)+': '+(Mascarar-Homologacao ($detalhe-join' ')))}
 catch{$linhas.Add('❌ '+(Mascarar-Homologacao $Nome)+': nao aprovado/indisponivel. Consulte docs/SOCORRO.md.')} # Nao publica excecoes que podem conter segredos.
}
$linhas.Add('Supply Vision — verificacao somente leitura — '+(Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
Item-Homologacao 'Commit e alteracoes locais' {
 $commit=& git -C $Raiz rev-parse HEAD;if($LASTEXITCODE){throw 'git'}
 $mudancas=@(& git -C $Raiz status --porcelain);if($LASTEXITCODE){throw 'git'}
 "$commit; $($mudancas.Count) alteracoes locais (nomes omitidos)"
}
foreach($nome in @('status','estado')){
 Item-Homologacao "$nome.json" { $j=Get-Content (Join-Path $privado "operacao\$nome.json") -Raw|ConvertFrom-Json;"JSON legivel; atualizado: $($j.atualizado)" }
}
$cfg=@{};try{$cfg=Ler-ConfigOperacao (Join-Path $privado 'portal\configuracao\portal.env')}catch{}
foreach($url in @('http://127.0.0.1:3000',$cfg['PORTAL_URL'])){
 Item-Homologacao "Health $url" {if(!$url){throw 'url'};$h=Invoke-RestMethod ($url.TrimEnd('/')+'/api/health') -TimeoutSec 5;if($h.status-ne'ok'){throw 'health'};'respondendo'}
}
Item-Homologacao 'Tarefa e inicializacao' {
 $startup=Join-Path ([Environment]::GetFolderPath('Startup')) 'Supply Vision.cmd';$modo=Obter-ModoInicializacao $Raiz $startup
 $t=Obter-TarefaSupplyVision $Raiz
 if($modo-eq'computador'){"$modo; estado $($t.State); conta $($t.Principal.UserId)"}else{$modo}
}
Item-Homologacao 'Modo ensaio' {$op=Ler-ConfigOperacao (Join-Path $privado 'comum\operacao.env');if($op['MODO_ENSAIO']-eq'1'){'ATIVO — nenhum email ou backup em rede'}else{'desligado'}}
Item-Homologacao 'Parametros dos alertas' {
 $python=Join-Path $Raiz 'alertas\.venv\Scripts\python.exe'
 $saida=& $python -B -X utf8 (Join-Path $Raiz 'alertas\processo\validar_parametros.py') 2>&1
 if($LASTEXITCODE){throw 'parametros'};'carregados e validados (sem exibir conteudo)'
}
foreach($p in @((Join-Path $privado 'portal\backups'),$cfg['BACKUP_NETWORK_DIR'])){
 Item-Homologacao "Backups $p" {if(!$p-or!(Test-Path -LiteralPath $p)){throw 'pasta'};$arquivos=@(Get-ChildItem -LiteralPath $p -File|Sort-Object LastWriteTime -Descending);if(!$arquivos){throw 'vazio'};"$($arquivos.Count) arquivos; mais recente $($arquivos[0].LastWriteTime) (nao valida integridade)"}
}
Item-Homologacao 'Ultimas entregas' {
 $entregas=@(Get-ChildItem (Join-Path $privado 'alertas\estado-envios') -Filter '*.json' -File|Sort-Object LastWriteTime -Descending)
 if(!$entregas){throw 'sem entregas'}
 $resumo=@()
 foreach($registro in @($entregas|Select-Object -First 5)){
  $j=Get-Content $registro.FullName -Raw|ConvertFrom-Json
  $estado=if($j.estado-in@('enviado','parcial','incerto')){$j.estado}else{'desconhecido'}
  $resumo+="$($registro.LastWriteTime): $estado"
 }
 "$($entregas.Count) registros; ultimos cinco: $($resumo-join'; '); destinatarios omitidos"
}
Item-Homologacao 'Disco' {$d=Get-PSDrive -Name ([IO.Path]::GetPathRoot($Raiz).Substring(0,1));$op=Ler-ConfigOperacao (Join-Path $privado 'comum\operacao.env');$gb=[math]::Round($d.Free/1GB,1);if($gb-lt[double]$op['ESPACO_MINIMO_GB']){throw 'disco'};"$gb GB livres"}
foreach($tipo in @('supervisor','portal','emails','relatorios')){
 Item-Homologacao "Final do log $tipo" {
  $pastas=@((Join-Path $privado 'operacao'),(Join-Path $privado 'portal\logs'))
  $nomes=switch($tipo){
   'supervisor'{@('supervisor.log')}
   'portal'{@('portal-saida.log','portal-erro.log')}
   'emails'{@('emails-saida.log','emails-erro.log','portal-email.log')}
   'relatorios'{@('relatorios-saida.log','relatorios-erro.log')}
  }
  $logs=@($pastas|ForEach-Object{Get-ChildItem -LiteralPath $_ -File -ErrorAction SilentlyContinue}|Where-Object {$_.Name-in$nomes}|Sort-Object LastWriteTime -Descending)
  if(!$logs){throw 'sem log'}
  $linhas.Add('--- '+$tipo+' ---')
  foreach($l in @(Get-Content -LiteralPath $logs[0].FullName -Tail 10)){$linhas.Add((Mascarar-Homologacao $l))}
  'ultimas 10 linhas (dados sensiveis mascarados)'
 }
}
[IO.File]::WriteAllLines([IO.Path]::GetFullPath($Destino),$linhas,(New-Object Text.UTF8Encoding($true)))
Write-Host "Relatorio criado: $Destino. Itens com X exigem verificacao; consulte docs/SOCORRO.md."
