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
. (Join-Path $PSScriptRoot 'diagnostico-logica.ps1')
$segredos=Obter-SegredosHomologacao $privado
function Item-Homologacao([string]$Nome,[scriptblock]$Conferir,[switch]$Classificar){
 try{$detalhe=& $Conferir;$icone='✅';if($Classificar){$icone=switch($detalhe.nivel){'ok'{'✅'} 'aviso'{'⚠️'} 'erro'{'❌'}};$detalhe=$detalhe.mensagem};$linhas.Add($icone+' '+(Mascarar-Homologacao $Nome $segredos)+': '+(Mascarar-Homologacao ($detalhe-join' ') $segredos))}
 catch{$linhas.Add('❌ '+(Mascarar-Homologacao $Nome $segredos)+': nao aprovado/indisponivel. Consulte AGENTS.md#diagnostico-e-recuperacao.')} # Nao publica excecoes que podem conter segredos.
}
$linhas.Add('Supply Vision — verificacao somente leitura — '+(Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
Item-Homologacao 'Commit e alteracoes locais' {
 $r=Executar-NativoOperacao 'git' @('-C',$Raiz,'rev-parse','HEAD');if($r.codigo-ne0){throw 'git'}
 $commit=$r.stdout-join''
 $r=Executar-NativoOperacao 'git' @('-C',$Raiz,'status','--porcelain');if($r.codigo-ne0){throw 'git'}
 $mudancas=@($r.stdout)
 "$commit; $($mudancas.Count) alteracoes locais (nomes omitidos)"
}
foreach($nome in @('status','estado')){
 $arquivoJson=Join-Path $privado "operacao\$nome.json"
 Item-Homologacao "$nome.json" { $j=Get-Content -LiteralPath $arquivoJson -Raw -Encoding UTF8|ConvertFrom-Json;if($null-eq$j-or$j-is[string]-or$j-is[array]-or$j-is[ValueType]){throw 'Objeto JSON esperado'};'JSON legivel e valido' }
}
$cfg=@{};try{$cfg=Ler-ConfigOperacao (Join-Path $privado 'portal\configuracao\portal.env')}catch{}
foreach($url in @('http://127.0.0.1:3000',$cfg['PORTAL_URL'])){
 Item-Homologacao "Health $url" {if(!$url){throw 'url'};$h=Invoke-RestMethod ($url.TrimEnd('/')+'/api/health') -TimeoutSec 5;if($h.status-ne'ok'){throw 'health'};'respondendo'}
}
Item-Homologacao 'Tarefa e inicializacao' {
 $modo=Obter-ModoInicializacao $Raiz
 $t=Obter-TarefaSupplyVision $Raiz
 if($modo-eq'computador'){$aviso=Obter-AvisoContaTarefa $Raiz;if($aviso){throw $aviso};"$modo; estado $($t.State); conta $($t.Principal.UserId)"}else{$modo}
}
Item-Homologacao 'Conta da tarefa' { $aviso=Obter-AvisoContaTarefa $Raiz;if($aviso){@{nivel='erro';mensagem=$aviso}}else{@{nivel='ok';mensagem='nenhuma falha de logon registrada'}} } -Classificar
Item-Homologacao 'Permissao da conta da tarefa' {$t=Obter-TarefaSupplyVision $Raiz;if($t-and!(Testar-ContaAdministradora $t.Principal.UserId)){throw 'conta nao administradora local'};'conta administradora local ou modo sem tarefa'}
Item-Homologacao 'Modo ensaio' {$op=Ler-ConfigOperacao (Join-Path $privado 'comum\operacao.env');if($op['MODO_ENSAIO']-eq'1'){'ATIVO — nenhum email ou backup em rede'}else{'desligado'}}
Item-Homologacao 'Parametros dos alertas' {
 $python=Join-Path $Raiz 'alertas\.venv\Scripts\python.exe'
 $r=Executar-NativoOperacao $python @('-B','-X','utf8',(Join-Path $Raiz 'alertas/processo/validar_parametros.py'))
 if($r.codigo-ne0){throw 'parametros'};'carregados e validados (sem exibir conteudo)'
}
Item-Homologacao 'Backups locais' {
 $op=Ler-ConfigOperacao (Join-Path $privado 'comum\operacao.env')
 $inicio=(Get-Item -LiteralPath $privado).CreationTime
 Obter-SituacaoBackupLocal (Join-Path $privado 'portal\backups') $op $inicio (Get-Date)
} -Classificar
foreach($p in @($cfg['BACKUP_NETWORK_DIR'])){
 Item-Homologacao "Backups $p" {if(!$p-or!(Test-Path -LiteralPath $p)){throw 'pasta'};$arquivos=@(Get-ChildItem -LiteralPath $p -File|Sort-Object LastWriteTime -Descending);if(!$arquivos){throw 'vazio'};"$($arquivos.Count) arquivos; mais recente $($arquivos[0].LastWriteTime) (nao valida integridade)"}
}
Item-Homologacao 'Ultimas entregas' {
 $node=Localizar-NodeMaquina
 $r=Executar-NativoOperacao $node @((Join-Path $Raiz 'portal/scripts/ultimas-entregas.mjs'),'--privado',$privado)
 $saida=$r.stdout
 if($r.codigo-ne0){throw 'Consulta de entregas indisponivel.'}
 $j=($saida-join"`n")|ConvertFrom-Json
 $resumo=@()
 foreach($tipo in @('alertas','relatorios')){
  $entregas=@($j.$tipo)
  if(!$entregas){$resumo+="${tipo}: nenhum envio confirmado ainda";continue}
  $itens=@($entregas|ForEach-Object {([datetimeoffset]::Parse($_.data).LocalDateTime.ToString('yyyy-MM-dd HH:mm:ss'))+': '+$_.estado})
  $resumo+="${tipo}: "+($itens-join', ')
 }
 $resumo+=@($j.avisos)
 @{nivel=$(if($j.avisos.Count-or(!$j.alertas-and!$j.relatorios)){'aviso'}else{'ok'});mensagem=(($resumo-join'; ')+'; destinatarios omitidos')}
} -Classificar
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
  foreach($l in @(Get-Content -LiteralPath $logs[0].FullName -Encoding UTF8 -Tail 10)){$linhas.Add((Mascarar-Homologacao $l $segredos))}
  'ultimas 10 linhas (dados sensiveis mascarados)'
 }
}
[IO.File]::WriteAllLines([IO.Path]::GetFullPath($Destino),$linhas,(New-Object Text.UTF8Encoding($true)))
Write-Host "Relatorio criado: $Destino. Itens com X exigem verificacao; consulte AGENTS.md#diagnostico-e-recuperacao."
