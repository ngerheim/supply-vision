$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
. (Join-Path $PSScriptRoot 'inicializacao-logica.ps1')
. (Join-Path $PSScriptRoot 'central-logica.ps1')
. (Join-Path $PSScriptRoot 'espera-testes.ps1')
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;using System.Threading;
public static class SvCentralTeste {
 public static int Tarefas,Infos,Supervisores,Atraso=200;public static bool Bloquear;
 public static ManualResetEventSlim Porta=new ManualResetEventSlim(false);
 public static void Tarefa(){Interlocked.Increment(ref Tarefas);Thread.Sleep(Atraso);if(Bloquear)Porta.Wait();}
 public static void Info(){Interlocked.Increment(ref Infos);Thread.Sleep(Atraso);}
 public static void Supervisor(){Interlocked.Increment(ref Supervisores);Thread.Sleep(30);}
 public static void Zerar(){Tarefas=Infos=Supervisores=0;Porta.Reset();Bloquear=false;}
}
'@
$pasta=Join-Path ([IO.Path]::GetTempPath()) ('sv-central-'+[guid]::NewGuid().ToString('N'))
$envAnterior=$env:SUPPLY_VISION_PRIVADO;$controle=Novo-ControleCentral
function Exigir-Central([bool]$Ok,[string]$Nome){if(!$Ok){throw "Falhou: $Nome"};Write-Host "OK central: $Nome"}
try{
 $Raiz=Join-Path $pasta 'repo';$Privado=Join-Path $pasta 'privado';$Startup=Join-Path $pasta 'inicio.cmd'
 foreach($dir in @((Join-Path $Raiz 'scripts'),(Join-Path $Privado 'comum'),(Join-Path $Privado 'operacao'),(Join-Path $Privado 'portal/configuracao'))){New-Item -ItemType Directory -Force $dir|Out-Null}
 $env:SUPPLY_VISION_PRIVADO=$Privado
 foreach($nome in @('operacao-logica','inicializacao-logica','administracao-logica','central-logica','atualizacao-preparo')){Copy-Item (Join-Path $PSScriptRoot "$nome.ps1") (Join-Path $Raiz 'scripts')}
 Set-Content (Join-Path $Privado 'comum/operacao.env') 'MODO_ENSAIO=0'
 Set-Content (Join-Path $Privado 'operacao/status.json') '{"portal":true,"emails":true,"ensaio":false}'
 Set-Content (Join-Path $Privado 'portal/configuracao/portal.env') 'BACKUP_EMAIL_TO=teste@example.com'
 $mocks=@'
function Get-ScheduledTask { [SvCentralTeste]::Tarefa();return @{Actions=@{Arguments=(Join-Path $PSScriptRoot 'supervisor.ps1')}} }
function Get-ScheduledTaskInfo { [SvCentralTeste]::Info();return @{LastTaskResult=0} }
function Testar-SupervisorEncerrado { [SvCentralTeste]::Supervisor();return $false }
'@
 Add-Content (Join-Path $Raiz 'scripts/inicializacao-logica.ps1') $mocks
 . ([scriptblock]::Create($mocks.Replace("(Join-Path `$PSScriptRoot 'supervisor.ps1')","(Join-Path `$Raiz 'scripts/supervisor.ps1')")))
 # Oracle: Atualizar exato da main 25e4a25, com consultas simuladas apenas.
 foreach($nome in @('avisoSessao','avisoBackup','iniciar','status')){Set-Variable $nome ([pscustomobject]@{Text='';Font=$null;Enabled=$true;ForeColor=$null})}
 $fonteAvisoEnsaio=$null;$fonteAvisoBackup=$null;$Op=Join-Path $Privado 'operacao';$StatusFile=Join-Path $Op 'status.json'
 function Operacao-Ativa {return !(Testar-SupervisorEncerrado $Privado)}
 . (Join-Path $PSScriptRoot '../testes/fixtures/central-atualizar-antes.ps1')
 [SvCentralTeste]::Zerar();$antes=[Diagnostics.Stopwatch]::StartNew();Atualizar;$antes.Stop()
 Exigir-Central ([SvCentralTeste]::Tarefas-eq2-and[SvCentralTeste]::Infos-eq1-and[SvCentralTeste]::Supervisores-eq2) 'antes: 2 tarefas + 1 info + 2 supervisor na thread chamadora'
 $tempoAntes=$antes.ElapsedMilliseconds
 [SvCentralTeste]::Zerar();[SvCentralTeste]::Bloquear=$true
 $inicio=[datetime]::UtcNow;$medir=[Diagnostics.Stopwatch]::StartNew();Iniciar-ConsultasCentral $controle $Raiz $Privado $Startup $inicio;$medir.Stop()
 $tempoDepois=$medir.ElapsedMilliseconds
 Exigir-Central ($tempoDepois-lt$tempoAntes) 'dispatch nao espera consulta lenta'
 Iniciar-ConsultasCentral $controle $Raiz $Privado $Startup $inicio.AddSeconds(5)
 Exigir-Central ($controle.trabalhos.Count-eq2) 'sem sobreposicao enquanto tarefa bloqueada'
 $script:rEstado=$null
 Exigir-Central (Esperar-CondicaoTeste {$script:rEstado=Receber-TrabalhoCentral $controle 'estado';$null-ne$script:rEstado} -Segundos 15) 'estado chega mesmo com Agendador bloqueado'
 Exigir-Central ($script:rEstado.ok-and$script:rEstado.valor.ativo-and$controle.trabalhos.ContainsKey('tarefa')) 'estado independente da tarefa'
 Exigir-Central (Iniciar-TrabalhoCentral $controle 'acao' { 'clique atendido' }) 'clique despacha com Agendador bloqueado'
 Exigir-Central (!(Iniciar-TrabalhoCentral $controle 'acao' {'duplicado'})) 'acao nao sobrepoe'
 $script:rAcao=$null
 Exigir-Central (Esperar-CondicaoTeste {$script:rAcao=Receber-TrabalhoCentral $controle 'acao';$null-ne$script:rAcao} -Segundos 15) 'acao termina durante consulta lenta'
 Exigir-Central ($script:rAcao.valor-eq'clique atendido') 'resultado da acao preservado'
 [SvCentralTeste]::Porta.Set();$script:rTarefa=$null
 Exigir-Central (Esperar-CondicaoTeste {$script:rTarefa=Receber-TrabalhoCentral $controle 'tarefa';$null-ne$script:rTarefa} -Segundos 15) 'tarefa conclui'
 Exigir-Central ([SvCentralTeste]::Tarefas-eq1-and[SvCentralTeste]::Infos-eq1) 'depois: uma consulta de cada por ciclo'
 Iniciar-ConsultasCentral $controle $Raiz $Privado $Startup $inicio.AddSeconds(59)
 Exigir-Central (!$controle.trabalhos.ContainsKey('tarefa')) 'cache ate 59 s'
 Iniciar-ConsultasCentral $controle $Raiz $Privado $Startup $inicio.AddSeconds(60)
 Exigir-Central ($controle.trabalhos.ContainsKey('tarefa')) 'renova aos 60 s'
 [SvCentralTeste]::Bloquear=$false
 foreach($tipo in @('estado','tarefa')){Exigir-Central (Esperar-CondicaoTeste {(Receber-TrabalhoCentral $controle $tipo)-ne$null} -Segundos 15) "limpa $tipo"}
 [SvCentralTeste]::Porta.Reset()
 [void](Iniciar-TrabalhoCentral $controle 'estado' { [SvCentralTeste]::Porta.Wait();'antigo' })
 $geracao=$controle.geracao;Invalidar-ConsultasCentral $controle
 Exigir-Central ($controle.geracao-ne$geracao) 'resultado antigo identificado por geracao'
 $cancelar=[Diagnostics.Stopwatch]::StartNew();Exigir-Central (Cancelar-ConsultaCentral $controle 'estado' 0) 'cancelamento assincorno';$cancelar.Stop()
 Exigir-Central (!(Iniciar-TrabalhoCentral $controle 'estado' {'duplicado'})) 'nao substitui worker ainda cancelando'
 [SvCentralTeste]::Porta.Set()
 Exigir-Central (Esperar-CondicaoTeste {(Receber-TrabalhoCentral $controle 'estado')-ne$null} -Segundos 15) 'libera recursos do cancelamento'
 # Delegacao dos botoes reais, sem tarefas, node, firewall ou dados externos.
 $script:chamadas=@();$script:paradaOk=$true;$script:elevado=$true
 function Iniciar-OperacaoConfigurada {$script:chamadas+='iniciar'}
 function Parar-Operacao {$script:chamadas+='parar';return $script:paradaOk}
 function Localizar-NodeMaquina {return 'node-ficticio'}
 function node-ficticio {$script:chamadas+=('node '+($args-join' '));$global:LASTEXITCODE=0;return 'backup conferido'}
 function powershell.exe {$script:chamadas+='validar';$global:LASTEXITCODE=0;return 'validado'}
 function Start-Process {$script:chamadas+='atualizar';return @{Id=123;StartTime=[datetime]::UtcNow}}
 function Testar-Elevacao {return $script:elevado}
 function Testar-SupervisorEncerrado {return $true}
 function Definir-ModoInicializacao {$script:chamadas+='modo'}
 function Preparar-Migracao {$script:chamadas+='migrar'}
 [void](Executar-AcaoCentral $Raiz $Privado $Startup 'iniciar' @{})
 [void](Executar-AcaoCentral $Raiz $Privado $Startup 'parar' @{})
 [void](Executar-AcaoCentral $Raiz $Privado $Startup 'validar' @{})
 [void](Executar-AcaoCentral $Raiz $Privado $Startup 'testar-backup' @{})
 [void](Executar-AcaoCentral $Raiz $Privado $Startup 'restaurar' @{anterior=$true})
 [void](Executar-AcaoCentral $Raiz $Privado $Startup 'modo' @{modo='computador'})
 [void](Executar-AcaoCentral $Raiz $Privado $Startup 'migrar' @{destino=$pasta;modo='ensaio'})
 [void](Executar-AcaoCentral $Raiz $Privado $Startup 'manutencao' @{ativo=$true})
 Exigir-Central (Test-Path (Join-Path $Privado 'operacao/manutencao.sinal')) 'manutencao liga'
 [void](Executar-AcaoCentral $Raiz $Privado $Startup 'manutencao' @{ativo=$false})
 Exigir-Central (!(Test-Path (Join-Path $Privado 'operacao/manutencao.sinal'))) 'manutencao desliga'
 [void](Executar-AcaoCentral $Raiz $Privado $Startup 'atualizar' @{})
 Exigir-Central ($script:chamadas-contains'atualizar'-and$script:chamadas-contains'iniciar'-and$script:chamadas-contains'modo'-and$script:chamadas-contains'migrar') 'botoes delegam ao fluxo atual'
 Exigir-Central (@($script:chamadas|Where-Object {$_-like'node *--anterior*'}).Count-eq1) 'restauracao anterior preservada'
 $script:paradaOk=$false;$antesNode=@($script:chamadas|Where-Object {$_-like'node *'}).Count;$recusou=$false
 try{Executar-AcaoCentral $Raiz $Privado $Startup 'restaurar' @{}|Out-Null}catch{$recusou=$true}
 Exigir-Central ($recusou-and@($script:chamadas|Where-Object {$_-like'node *'}).Count-eq$antesNode) 'parada incompleta impede restauracao'
 $script:elevado=$false
 Exigir-Central ((Executar-AcaoCentral $Raiz $Privado $Startup 'atualizar' @{}).elevar) 'atualizacao da tarefa ainda exige elevacao'
 $diag=Get-Content (Join-Path $Privado 'operacao/central-diagnostico.log') -Raw
 Exigir-Central ($diag-match'tarefa_ms=\d+; tarefa_info_ms=\d+'-and$diag-match'supervisor_ms=\d+') 'tempos por consulta registrados'
 Write-Host "MEDICAO controlada: atraso=$([SvCentralTeste]::Atraso) ms/consulta; Atualizar antes=$tempoAntes ms; dispatch depois=$tempoDepois ms; cancelar=$($cancelar.ElapsedMilliseconds) ms."
 if($env:OS-eq'Windows_NT'){
  Add-Type -AssemblyName System.Windows.Forms
  $janela=New-Object Windows.Forms.Form;$janela.ShowInTaskbar=$false;$janela.Location='-32000,-32000'
  $botao=New-Object Windows.Forms.Button;$janela.Controls.Add($botao);$script:cliques=0
  $botao.Add_Click({$script:cliques++})
  [SvCentralTeste]::Porta.Reset()
  [void](Iniciar-TrabalhoCentral $controle 'tarefa' {[SvCentralTeste]::Porta.Wait();'fim'})
  $janela.Show();$relogio=[Diagnostics.Stopwatch]::StartNew()
  while($relogio.ElapsedMilliseconds-lt650){$botao.PerformClick();[Windows.Forms.Application]::DoEvents();Start-Sleep -Milliseconds 10}
  Exigir-Central ($script:cliques-ge10-and!$controle.trabalhos['tarefa'].async.IsCompleted) 'WinForms atende cliques com worker lento'
  $janela.Close();$janela.Dispose();[SvCentralTeste]::Porta.Set()
 }else{Write-Host 'PULADO: WinForms real exige Windows; demais testes de runspace executados.'}
 # Andamento real em arquivo, sem consultar Git nem Agendador na UI.
 . (Join-Path $PSScriptRoot 'atualizacao-preparo.ps1')
 $arquivoAndamento=Join-Path $Op 'atualizacao-andamento.json';$arquivoTempos=Join-Path $Op 'atualizacao-tempos.log'
 $agora=[datetime]::UtcNow
 $a=Novo-AndamentoAtualizacao $arquivoAndamento $arquivoTempos $agora.AddSeconds(-30)
 Publicar-AndamentoAtualizacao $a 'PREPARAR / Build do Portal' -Modo rapido
 $lido=Consultar-AndamentoCentral $Privado $agora
 Exigir-Central ($lido.modo-eq'rapido'-and$lido.numero-gt1-and$lido.totalSegundos-eq30-and$null-eq$lido.restanteSegundos) 'arquivo de andamento sem historico mostra somente decorrido'
 [IO.File]::WriteAllText($arquivoTempos,"PREPARAR / Build do Portal: codigo=0; duracao=72 s.`n[2026-01-01 00:00:00] Resumo atualizacao: total=731 s; medicao=ficticia.`n")
 $a=Novo-AndamentoAtualizacao $arquivoAndamento $arquivoTempos $agora.AddSeconds(-30)
 Publicar-AndamentoAtualizacao $a 'PREPARAR / Build do Portal' -Modo rapido
 $lido=Consultar-AndamentoCentral $Privado $agora
 Exigir-Central ($lido.restanteSegundos-ge71-and$lido.restanteSegundos-le72) 'estimativa usa duracao da atualizacao anterior'
 [SvCentralTeste]::Porta.Reset()
 [void](Iniciar-TrabalhoCentral $controle 'tarefa' {[SvCentralTeste]::Porta.Wait()})
 Iniciar-ConsultaAndamentoCentral $controle $Raiz $Privado
 $script:rAndamento=$null
 Exigir-Central (Esperar-CondicaoTeste {$script:rAndamento=Receber-TrabalhoCentral $controle 'andamento';$null-ne$script:rAndamento} -Segundos 15) 'andamento chega com Agendador bloqueado'
 Exigir-Central ($script:rAndamento.ok-and$script:rAndamento.valor.modo-eq'rapido') 'worker le arquivo publicado'
 [SvCentralTeste]::Porta.Set()
 [void](Esperar-CondicaoTeste {(Receber-TrabalhoCentral $controle 'tarefa')-ne$null} -Segundos 15)
 Publicar-AndamentoAtualizacao $a 'Atualizacao concluida' 'concluido'
 $lido=Consultar-AndamentoCentral $Privado
 Exigir-Central ($lido.estado-eq'concluido'-and$lido.progresso-eq100-and$lido.resumo-like'*total=731 s*') 'resultado final e tempos totais'
 Publicar-AndamentoAtualizacao $a 'Atualizacao falhou' 'falhou'
 Exigir-Central ((Consultar-AndamentoCentral $Privado).estado-eq'falhou') 'resultado de falha'
 [IO.File]::WriteAllText($arquivoAndamento,'{parcial')
 Exigir-Central ($null-eq(Consultar-AndamentoCentral $Privado)) 'arquivo parcial nao derruba central'
 Write-Host 'PASSOU: central responsiva, cache, exclusao mutua, resultados antigos, cancelamento e botoes.'
}finally{
 [SvCentralTeste]::Porta.Set();$env:SUPPLY_VISION_PRIVADO=$envAnterior
 foreach($chave in @($controle.trabalhos.Keys)){
  [void](Cancelar-ConsultaCentral $controle $chave 0)
  [void](Esperar-CondicaoTeste {(Receber-TrabalhoCentral $controle $chave)-ne$null} -Segundos 15)
 }
 Remove-Item -LiteralPath $pasta -Recurse -Force -ErrorAction SilentlyContinue
}
