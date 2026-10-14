# Funcoes sem efeitos ao carregar; todos os destinos pertencem ao worktree novo.
function Nova-PastaPreparo([string]$Raiz) {
 return Join-Path (Split-Path $Raiz -Parent) ('.'+(Split-Path $Raiz -Leaf)+'-preparo-'+[guid]::NewGuid().ToString('N'))
}
function Validar-PastaPreparo([string]$Raiz,[string]$Preparo) {
 $r=[IO.Path]::GetFullPath($Raiz);$p=[IO.Path]::GetFullPath($Preparo)
 $prefixo='.'+(Split-Path $r -Leaf)+'-preparo-'
 if((Split-Path $p -Parent)-ne(Split-Path $r -Parent)-or(Split-Path $p -Leaf)-notmatch('^'+[regex]::Escape($prefixo)+'[0-9a-f]{32}$')){throw 'Pasta de preparo fora do local autorizado.'}
 if((Test-Path $p)-and((Get-Item -LiteralPath $p -Force).Attributes-band[IO.FileAttributes]::ReparsePoint)){throw 'Preparo nao pode ser um link.'}
}
function Copiar-ArvoreDependencias([string]$Origem,[string]$Destino,[string[]]$Bases,[int]$Profundidade=0) {
 if($Profundidade-gt64){throw 'Ciclo ou profundidade excessiva nas dependencias.'}
 $item=Get-Item -LiteralPath $Origem -Force
 if($item.Attributes-band[IO.FileAttributes]::ReparsePoint){
  $alvo=@($item.Target)[0]
  if(!$alvo){throw 'Link de dependencia sem destino verificavel.'}
  if(![IO.Path]::IsPathRooted($alvo)){$alvo=Join-Path (Split-Path $Origem -Parent) $alvo}
  $alvo=[IO.Path]::GetFullPath($alvo)
  $seguro=$false
  foreach($base in $Bases){if($alvo.StartsWith($base,[StringComparison]::OrdinalIgnoreCase)){$seguro=$true}}
  if(!$seguro){throw 'Link de dependencia fora de node_modules/venv/vendor; preparo cancelado.'}
  # Materializa o destino. Nenhum link para instalacao/preparo sobrevive a troca.
  Copiar-ArvoreDependencias $alvo $Destino $Bases ($Profundidade+1)
  return
 }
 if($item.PSIsContainer){
  New-Item -ItemType Directory -Force $Destino|Out-Null
  foreach($filho in @(Get-ChildItem -LiteralPath $Origem -Force)){
   Copiar-ArvoreDependencias $filho.FullName (Join-Path $Destino $filho.Name) $Bases ($Profundidade+1)
  }
 }else{Copy-Item -LiteralPath $Origem -Destination $Destino -Force}
}
function Copiar-DependenciasPreparo([string]$Origem,[string]$Destino) {
 # Nunca usar junction/hardlink: testes e npm podem escrever nos pacotes.
 if(!(Test-Path -LiteralPath $Origem -PathType Container)){return $false}
 $base=[IO.Path]::GetFullPath($Origem).TrimEnd('\','/')+[IO.Path]::DirectorySeparatorChar
 $bases=@($base)
 if((Split-Path $Origem -Leaf)-eq'node_modules'){
  $bases+=([IO.Path]::GetFullPath((Join-Path (Split-Path $Origem -Parent) 'vendor'))+[IO.Path]::DirectorySeparatorChar)
 }
 Copiar-ArvoreDependencias $Origem $Destino $bases
 return $true
}
function Trocar-ArtefatosPreparo([string]$Raiz,[string]$Preparo) {
 Validar-PastaPreparo $Raiz $Preparo
 foreach($rel in @('portal/dist','portal/node_modules','alertas/.venv')){
  $destino=Join-Path $Raiz $rel;$novo=Join-Path $Preparo $rel;$antigo=Join-Path $Preparo ('anteriores/'+$rel)
  if(!(Test-Path -LiteralPath $novo -PathType Container)){throw "Artefato preparado ausente: $rel"}
  New-Item -ItemType Directory -Force (Split-Path $antigo -Parent)|Out-Null
  if(Test-Path -LiteralPath $destino){[IO.Directory]::Move($destino,$antigo)}
  # Marcador antes da segunda renomeacao permite reverter tambem troca parcial.
  [IO.File]::WriteAllText((Join-Path $Preparo ('trocado-'+($rel-replace'[/\\]','-'))),'ok')
  [IO.Directory]::Move($novo,$destino)
 }
}
function Restaurar-ArtefatosPreparo([string]$Raiz,[string]$Preparo) {
 Validar-PastaPreparo $Raiz $Preparo
 foreach($rel in @('portal/dist','portal/node_modules','alertas/.venv')){
  $marca=Join-Path $Preparo ('trocado-'+($rel-replace'[/\\]','-'))
  $destino=Join-Path $Raiz $rel;$antigo=Join-Path $Preparo ('anteriores/'+$rel);$falho=Join-Path $Preparo ('reprovados/'+$rel)
  # Uma falha ao gravar o marcador pode vir DEPOIS de guardar o anterior.
  if(!(Test-Path -LiteralPath $marca)-and!(Test-Path -LiteralPath $antigo)){continue}
  New-Item -ItemType Directory -Force (Split-Path $falho -Parent)|Out-Null
  if(Test-Path -LiteralPath $destino){[IO.Directory]::Move($destino,$falho)}
  if(Test-Path -LiteralPath $antigo){[IO.Directory]::Move($antigo,$destino)}
  if(Test-Path -LiteralPath $marca){Remove-Item -LiteralPath $marca -Force}
 }
}
function Limpar-PastaPreparo([string]$Raiz,[string]$Preparo) {
 if(!$Preparo){return}
 Validar-PastaPreparo $Raiz $Preparo
 if(Test-Path -LiteralPath $Preparo){
  & git -C $Raiz worktree remove --force $Preparo
  if($LASTEXITCODE-ne0){throw "Nao foi possivel limpar o preparo: $Preparo"}
 }
}

function Proteger-ArgumentoAtualizacao([string]$Argumento) {
 # Regras CommandLineToArgvW, incluindo barras antes de aspas e no fim.
 $texto=[regex]::Replace($Argumento,'(\\*)"','$1$1\"')
 return '"'+[regex]::Replace($texto,'(\\+)$','$1$1')+'"'
}
function Executar-PowerShellOculto([string[]]$Argumentos,[string]$Executavel='powershell.exe') {
 # -WindowStyle sozinho esconde a janela so depois que powershell inicia.
 # CreateNoWindow impede a criacao do console, inclusive em chamada direta.
 $info=New-Object Diagnostics.ProcessStartInfo
 $info.FileName=$Executavel
 $info.Arguments=(@($Argumentos|ForEach-Object {Proteger-ArgumentoAtualizacao ([string]$_)})-join' ')
 $info.WorkingDirectory=(Get-Location).Path
 $info.UseShellExecute=$false;$info.CreateNoWindow=$true
 $info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
 $processo=New-Object Diagnostics.Process
 $processo.StartInfo=$info
 try{
  [void]$processo.Start()
  # Drena os dois canais ao mesmo tempo: npm/pytest nao podem bloquear num
  # buffer cheio de stderr, nem esperar EOF antes de ler stdout.
  $saida=$processo.StandardOutput.ReadToEndAsync();$erro=$processo.StandardError.ReadToEndAsync()
  $aviso=[Diagnostics.Stopwatch]::StartNew()
  while(!$processo.WaitForExit(500)){
   if($aviso.Elapsed.TotalSeconds-ge30){Write-Host 'Atualizacao em andamento; aguardando o processo oculto.';$aviso.Restart()}
  }
  $texto=$saida.GetAwaiter().GetResult();$falha=$erro.GetAwaiter().GetResult()
  if($texto){Write-Output $texto}
  if($falha){Write-Output $falha}
  $global:LASTEXITCODE=$processo.ExitCode
 }finally{$processo.Dispose()}
}
