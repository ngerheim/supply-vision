# Somente fixtures: consulta simulada, acompanhamento real e worktree descartavel.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'supv.ps1')
$fonte=$PSScriptRoot
$base=Join-Path ([IO.Path]::GetTempPath()) ('sv-ci-espera-'+[guid]::NewGuid().ToString('N'))
$hostTeste=(Get-Process -Id $PID).Path
$worker=$null;$cliente=$null
function Exigir-CI([bool]$Ok,[string]$Nome){if(!$Ok){throw "Falhou: $Nome"};Write-Host "OK CI: $Nome"}
function Esperar-CI([scriptblock]$Condicao){
 $relogio=[Diagnostics.Stopwatch]::StartNew()
 while($relogio.Elapsed.TotalSeconds-lt15){if(& $Condicao){return $true};Start-Sleep -Milliseconds 100}
 return $false
}
try{
 [void][IO.Directory]::CreateDirectory($base)
 $privado=Join-Path $base 'fixture';$arquivo=Join-Path $privado 'operacao/atualizacao-andamento.json'
 $a=Novo-AndamentoAtualizacao $arquivo (Join-Path $base 'tempos.log')
 $id=[guid]::NewGuid().ToString('N')
 $mensagem='Aguardando CI da main (1234567): 3 de 5 checks concluidos, 2 min'
 $a.esperaCI=@{id=$id;mensagem=$mensagem}
 Publicar-AndamentoAtualizacao $a 'PREPARAR / Consulta CI'
 $lido=Consultar-AndamentoAdministrado $privado
 Exigir-CI ($lido.esperaCI.id-eq$id) 'espera preservada no JSON do acompanhamento'
 $texto=@(Mostrar-ProgressoSupv $lido 6>&1)-join"`n"
 Exigir-CI ($texto.Trim()-eq$mensagem) 'mensagem mostra SHA, checks e minutos'
 & {
  $script:supvPrivado=$privado
  function Consultar-AtualizacaoAdministrada {return @{HasExited=$false;Id=123}}
  function Start-Sleep {throw (New-Object OperationCanceledException 'Ctrl+C simulado')}
  try{[void](Acompanhar-AtualizacaoSupv)}catch{}
 }
 Exigir-CI (Testar-CancelamentoEsperaCI $a $id) 'interrupcao sinaliza cancelamento cooperativo'
 Exigir-CI (!(Testar-CancelamentoEsperaCI $a ('f'*32))) 'sinal antigo nao cancela outra espera'
 Remove-Item ($arquivo+'.cancelar-ci')
 $a.esperaCI=$null;Publicar-AndamentoAtualizacao $a 'PREPARAR / Build do Portal'
 Solicitar-CancelamentoEsperaCI $arquivo
 Exigir-CI (!(Test-Path ($arquivo+'.cancelar-ci'))) 'fora da espera nao cancela atualizacao'
 $a.erro='CI da main reprovado: Portal (failure). re-run no GitHub, PR de correcao ou supv atualizar --completo.'
 Publicar-AndamentoAtualizacao $a 'PREPARAR reprovado' 'falhou'
 $texto=@(Mostrar-ProgressoSupv (Consultar-AndamentoAdministrado $privado) 6>&1)-join"`n"
 Exigir-CI ($texto.Contains($a.erro)) 'falha mantem check e alternativas visiveis no acompanhamento'

 # Worktree Git real: prova remocao da pasta e do registro apos cancelamento.
 $instalacao=Join-Path $base 'instalacao';[void][IO.Directory]::CreateDirectory($instalacao)
 $gitFixture=Executar-NativoOperacao 'git' @('-C',$instalacao,'init','--initial-branch=main')
 if($gitFixture.codigo){throw ('Git init da fixture falhou. '+($gitFixture.saida-join' '))}
 $gitFixture=Executar-NativoOperacao 'git' @('-C',$instalacao,'-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','--allow-empty','-m','fixture')
 if($gitFixture.codigo){throw ('Commit da fixture falhou. '+($gitFixture.saida-join' '))}
 $preparo=Nova-PastaPreparo $instalacao
 $gitFixture=Executar-NativoOperacao 'git' @('-C',$instalacao,'worktree','add','--detach',$preparo,'HEAD')
 if($gitFixture.codigo){throw ('Worktree da fixture falhou. '+($gitFixture.saida-join' '))}
 [IO.File]::WriteAllText((Join-Path $instalacao 'sentinela'),'operacao no ar')
 $scriptWorker=Join-Path $base 'worker-ci.ps1'
 $codigoWorker=@'
param($Fonte,$Instalacao,$Preparo,$Arquivo)
$ErrorActionPreference='Stop'
. (Join-Path $Fonte 'atualizacao-preparo.ps1')
function Obter-ChecksCIPreparo($Sha){
 foreach($nome in @('Portal','Portal - instalacao nova e autenticacao real','PowerShell','Alertas','Atualizacao real')){
  @{name=$nome;head_sha=$Sha;status='queued';conclusion=$null;app=@{slug='github-actions';id=15368}}
 }
}
function Consultar-CIPRIdentica {return @{rapido=$false;motivo='fixture sem PR identica'}}
$a=Novo-AndamentoAtualizacao $Arquivo (Join-Path (Split-Path $Arquivo) 'tempos.log')
Publicar-AndamentoAtualizacao $a 'PREPARAR / Consulta CI'
try{[void](Consultar-CIPreparo ('a'*40) -Andamento $a);throw 'Espera prosseguiu sem aprovacao.'}
catch [OperationCanceledException]{
 Publicar-AndamentoAtualizacao $a 'Espera do CI cancelada; operacao continua no ar' 'falhou'
 Limpar-PastaPreparo $Instalacao $Preparo
 exit 17
}
'@
 [IO.File]::WriteAllText($scriptWorker,$codigoWorker)
 $argumentos=@('-NoProfile','-File',$scriptWorker,$fonte,$instalacao,$preparo,$arquivo)
 $argumentos=(@($argumentos|ForEach-Object {Proteger-ArgumentoAtualizacao $_})-join' ')
 $worker=Start-Process $hostTeste -ArgumentList $argumentos -PassThru -RedirectStandardOutput (Join-Path $base 'worker-saida.log') -RedirectStandardError (Join-Path $base 'worker-erro.log')
 Exigir-CI (Esperar-CI {(Consultar-AndamentoAdministrado $privado).esperaCI}) 'worker real publicou CI pendente'
 if($env:OS-eq'Windows_NT'){
  $scriptCliente=Join-Path $base 'cliente-ci.ps1'
  [IO.File]::WriteAllText($scriptCliente,@'
param($Fonte,$Privado,[int]$Worker)
. (Join-Path $Fonte 'supv.ps1')
$script:supvPrivado=$Privado
function Consultar-AtualizacaoAdministrada {Get-Process -Id $Worker -ErrorAction SilentlyContinue}
Acompanhar-AtualizacaoSupv
'@)
  $argumentos=(@(@('-NoProfile','-File',$scriptCliente,$fonte,$privado,[string]$worker.Id)|ForEach-Object {Proteger-ArgumentoAtualizacao $_})-join' ')
  $cliente=Start-Process $hostTeste -ArgumentList $argumentos -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $base 'cliente-saida.log') -RedirectStandardError (Join-Path $base 'cliente-erro.log')
  Exigir-CI (Esperar-CI {Select-String -LiteralPath (Join-Path $base 'cliente-saida.log') -Pattern 'checks concluidos' -Quiet}) 'cliente real acompanha a espera'
  $sinal=Join-Path $base 'ctrl-c.ps1'
  [IO.File]::WriteAllText($sinal,@'
param([int]$Cliente)
Add-Type -TypeDefinition @"
using System;using System.Runtime.InteropServices;
public static class SinalCI {
 [DllImport("kernel32.dll")] public static extern bool FreeConsole();
 [DllImport("kernel32.dll")] public static extern bool AttachConsole(uint id);
 [DllImport("kernel32.dll")] public static extern bool SetConsoleCtrlHandler(IntPtr handler,bool add);
 [DllImport("kernel32.dll")] public static extern bool GenerateConsoleCtrlEvent(uint e,uint group);
}
"@
[void][SinalCI]::FreeConsole()
if(![SinalCI]::AttachConsole($Cliente)){exit 1}
[void][SinalCI]::SetConsoleCtrlHandler([IntPtr]::Zero,$true)
if(![SinalCI]::GenerateConsoleCtrlEvent(0,0)){exit 2}
Start-Sleep -Milliseconds 300
'@)
  & $hostTeste -NoProfile -File $sinal -Cliente $cliente.Id
  Exigir-CI ($LASTEXITCODE-eq0-and(Esperar-CI {$cliente.Refresh();$cliente.HasExited})) 'Ctrl+C real encerra cliente durante espera'
 }else{
  Solicitar-CancelamentoEsperaCI $arquivo
  Write-Host 'PULADO: Ctrl+C nativo exige Windows; interrupcao simulada e sinal real exercitados no Linux.'
 }
 Exigir-CI (Esperar-CI {$worker.Refresh();$worker.HasExited}) 'worker encerra antes do proximo polling'
 $worker.WaitForExit()
 Exigir-CI ($worker.ExitCode-eq17) 'worker cancelou sem prosseguir'
 Exigir-CI (!(Test-Path $preparo)) 'pasta de preparo removida'
 $worktrees=(& git -C $instalacao worktree list --porcelain)-join"`n"
 Exigir-CI ($LASTEXITCODE-eq0-and!$worktrees.Contains((Split-Path $preparo -Leaf))) 'registro Git do preparo removido'
 Exigir-CI ([IO.File]::ReadAllText((Join-Path $instalacao 'sentinela'))-eq'operacao no ar') 'instalacao preservada'
 Exigir-CI (!(Test-Path ($arquivo+'.cancelar-ci'))-and!(Consultar-AndamentoAdministrado $privado).esperaCI) 'sinal e espera limpos'
 Write-Host 'PASSOU: acompanhamento, cancelamento cooperativo e limpeza real do preparo.'
}finally{
 foreach($p in @($cliente,$worker)){if($p){try{if(!$p.HasExited){$p.Kill()};$p.Dispose()}catch{}}}
 Remove-Item $base -Recurse -Force -ErrorAction SilentlyContinue
}
$global:LASTEXITCODE=0
