# Somente Git, arquivos e processos descartaveis; nenhum dado de producao.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'atualizacao-preparo.ps1')
$base=Join-Path ([IO.Path]::GetTempPath()) ('sv-limpeza-'+[guid]::NewGuid().ToString('N'))
$raiz=Join-Path $base 'instalacao';$processoProducao=$null
$removerReal=(Get-Command Remover-ArvorePreparo).ScriptBlock
function Exigir-Limpeza($Ok,$Mensagem){if(!$Ok){throw $Mensagem}}
try{
 New-Item -ItemType Directory -Force $raiz|Out-Null
 & git -C $raiz init --quiet
 [IO.File]::WriteAllText((Join-Path $raiz 'versionado'),'ficticio')
 & git -C $raiz add versionado
 & git -C $raiz -c user.name=Fixture -c user.email=fixture@example.invalid commit -qm fixture
 if($LASTEXITCODE){throw 'Git da fixture falhou.'}
 $producao=Join-Path $raiz 'privado';New-Item -ItemType Directory $producao|Out-Null
 $sentinela=Join-Path $producao 'sentinela';[IO.File]::WriteAllText($sentinela,'preservar')
 (Get-Item $sentinela).IsReadOnly=$true
 foreach($caso in @('worktree','residual-sem-registro','transitoria','pendente')){
  $preparo=Nova-PastaPreparo $raiz
  if($caso-eq'worktree'){& git -C $raiz worktree add --detach $preparo --quiet;if($LASTEXITCODE){throw 'Worktree da fixture falhou.'}}
  else{New-Item -ItemType Directory $preparo|Out-Null}
  $arq=Join-Path $preparo 'somente-leitura';[IO.File]::WriteAllText($arq,'descartavel');(Get-Item $arq).IsReadOnly=$true
  New-Item -ItemType $(if($env:OS-eq'Windows_NT'){'Junction'}else{'SymbolicLink'}) -Path (Join-Path $preparo 'link-producao') -Target $producao|Out-Null
  $gerador=Join-Path $base 'caminho-longo.mjs'
  [IO.File]::WriteAllText($gerador,"import fs from 'node:fs';import path from 'node:path';const p=path.join(process.argv[2],...Array(6).fill('a'.repeat(60)));fs.mkdirSync(p,{recursive:true});fs.writeFileSync(path.join(p,'arquivo'),'ficticio');")
  & node $gerador $preparo;if($LASTEXITCODE){throw 'Caminho longo da fixture falhou.'}
  $script:tentativas=0;$script:casoLimpeza=$caso
  function Remover-ArvorePreparo([string]$Preparo){
   $script:tentativas++
   if($script:casoLimpeza-eq'pendente'-or($script:casoLimpeza-eq'transitoria'-and$script:tentativas-lt3)){throw 'Arquivo em uso ficticio'}
   & $removerReal $Preparo
  }
  $global:LASTEXITCODE=42;$erro=''
  try{Limpar-PastaPreparo $raiz $preparo}catch{$erro=$_.Exception.Message}
  Exigir-Limpeza ($LASTEXITCODE-eq42) 'Limpeza alterou codigo de saida do atualizador.'
  if($caso-eq'pendente'){
   Exigir-Limpeza ($script:tentativas-eq4-and$erro.Contains($preparo)-and$erro.Contains('Arquivo em uso ficticio')) 'Aviso nao identifica caminho e motivo apos quatro tentativas.'
   $script:casoLimpeza='repeticao'
   Limpar-PreparosAntigos $raiz
   Exigir-Limpeza (!(Test-Path $preparo)) 'Proxima atualizacao nao limpou sobra antiga.'
  }else{
   Exigir-Limpeza (!$erro-and!(Test-Path $preparo)) "Limpeza falhou em ${caso}: $erro"
   if($caso-eq'transitoria'){Exigir-Limpeza ($script:tentativas-eq3) 'Nao repetiu falha transitoria.'}
  }
  Exigir-Limpeza ((Get-Content $sentinela)-eq'preservar'-and(Get-Item $sentinela).IsReadOnly) 'Limpeza seguiu link/alterou producao.'
  Write-Host "[OK] Limpeza: $caso; atributos, caminho longo e link isolados."
 }
 # A sobra pode conter artefatos de recuperacao, ou pertencer a outro preparo ativo.
 $resgate=Nova-PastaPreparo $raiz;$ativo=Nova-PastaPreparo $raiz;$trocaAtiva=Nova-PastaPreparo $raiz
 New-Item -ItemType Directory $resgate,$ativo,$trocaAtiva|Out-Null
 @{pid=$PID;inicio=(Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o')}|ConvertTo-Json|Set-Content (Join-Path $ativo 'preparo-processo.json') -Encoding UTF8
 @{pid=$PID;inicio=(Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o')}|ConvertTo-Json|Set-Content (Join-Path $trocaAtiva 'preparo-atualizador.json') -Encoding UTF8
 Limpar-PreparosAntigos $raiz @{preparo=$resgate;fase='recuperando'}
 Exigir-Limpeza ((Test-Path $resgate)-and(Test-Path $ativo)-and(Test-Path $trocaAtiva)) 'Removeu preparo/atualizador ativo ou artefatos de recuperacao.'
 $rejeitou=$false;try{Limpar-PastaPreparo $raiz $raiz}catch{$rejeitou=$true}
 Exigir-Limpeza $rejeitou 'Aceitou producao como pasta de preparo.'
 foreach($cmd in @('node "'+$raiz+'/portal/scripts/processar-emails.mjs"','node "'+$preparo+'-extra/filho.mjs"')){
  Exigir-Limpeza (!(Processo-DestePreparo @{CommandLine=$cmd} $preparo)) 'Selecionou processo de outra instalacao.'
 }
 Exigir-Limpeza (Processo-DestePreparo @{CommandLine=('node "'+$preparo+'/filho.mjs"')} $preparo) 'Nao reconheceu processo descartavel.'
 Write-Host '[OK] Sobras ativas/resgate e processos de producao preservados.'
 if($env:OS-eq'Windows_NT'){
  # Arvore REAL: filho segura FileShare.None, neto Node continua escrevendo.
  # O teste roda em outro processo: fechar o job nunca pode matar este pai.
  $preparo=Nova-PastaPreparo $raiz;New-Item -ItemType Directory $preparo|Out-Null
  $hostTeste=(Get-Process -Id $PID).Path
  $prodScript=Join-Path $producao 'vivo.mjs';[IO.File]::WriteAllText($prodScript,'setInterval(()=>{},1000)')
  $processoProducao=Start-Process (Get-Command node.exe).Source -ArgumentList (Proteger-ArgumentoAtualizacao $prodScript) -PassThru -WindowStyle Hidden
  $neto=Join-Path $preparo 'neto.mjs';[IO.File]::WriteAllText($neto,'setInterval(()=>{},1000)')
  $filho=Join-Path $preparo 'filho.ps1'
  [IO.File]::WriteAllText($filho,@'
param($Preparo,$Node)
$h=[IO.File]::Open((Join-Path $Preparo 'handle-aberto'),[IO.FileMode]::Create,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
$neto=Start-Process $Node -ArgumentList ('"'+(Join-Path $Preparo 'neto.mjs')+'"') -PassThru -WindowStyle Hidden
@{filho=$PID;neto=$neto.Id}|ConvertTo-Json|Set-Content (Join-Path $Preparo 'pids.json')
while($true){Start-Sleep -Milliseconds 100}
'@)
  $entrada=Join-Path $preparo 'entrada.ps1'
  [IO.File]::WriteAllText($entrada,@'
param($Biblioteca,$Preparo,$HostTeste,$Node)
$ErrorActionPreference='Stop'
. $Biblioteca
Entrar-JobPreparo
$argsFilho=@('-NoProfile','-File',(Join-Path $Preparo 'filho.ps1'),$Preparo,$Node)
$filho=Start-Process $HostTeste -ArgumentList (@($argsFilho|ForEach-Object {Proteger-ArgumentoAtualizacao $_})-join' ') -PassThru -WindowStyle Hidden
$limite=(Get-Date).AddSeconds(15)
while(!(Test-Path (Join-Path $Preparo 'pids.json'))){if((Get-Date)-gt$limite){throw 'Filho nao iniciou'};Start-Sleep -Milliseconds 100}
exit 7
'@)
  $saida=@(Executar-PowerShellOculto @('-NoProfile','-File',$entrada,(Join-Path $PSScriptRoot 'atualizacao-preparo.ps1'),$preparo,$hostTeste,(Get-Command node.exe).Source) $hostTeste)
  Exigir-Limpeza ($LASTEXITCODE-eq7) "Job perdeu desfecho do PREPARAR: $saida"
  $pids=Get-Content (Join-Path $preparo 'pids.json') -Raw|ConvertFrom-Json
  $limite=(Get-Date).AddSeconds(5)
  while((Get-Process -Id $pids.filho,$pids.neto -ErrorAction SilentlyContinue)-and(Get-Date)-lt$limite){Start-Sleep -Milliseconds 100}
  Exigir-Limpeza (!(Get-Process -Id $pids.filho,$pids.neto -ErrorAction SilentlyContinue)) 'Job deixou filho/neto vivos.'
  Exigir-Limpeza (!$processoProducao.HasExited) 'Job encerrou processo da producao ficticia.'
  $script:casoLimpeza='job';Limpar-PastaPreparo $raiz $preparo
  Exigir-Limpeza (!(Test-Path $preparo)) 'Handle do filho impediu limpeza apos sair do job.'
  Write-Host '[OK] Job Object real: filho/neto encerrados; handle liberado; PID da producao vivo.'
 }else{Write-Host '[SKIP] Job Object real exige Windows; demais verificacoes executadas.'}
}finally{
 if($processoProducao){if(!$processoProducao.HasExited){$processoProducao.Kill();[void]$processoProducao.WaitForExit(3000)};$processoProducao.Dispose()}
 if(Test-Path $base){Get-ChildItem $base -Recurse -Force -File|Where-Object {!($_.Attributes-band[IO.FileAttributes]::ReparsePoint)}|ForEach-Object {$_.IsReadOnly=$false};Remove-Item $base -Recurse -Force}
}
$global:LASTEXITCODE=0
