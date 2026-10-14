Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$Raiz=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
. (Join-Path $PSScriptRoot 'inicializacao-logica.ps1')
. (Join-Path $PSScriptRoot 'migracao-logica.ps1')
. (Join-Path $PSScriptRoot 'central-logica.ps1')
$Privado=Obter-PastaPrivada $Raiz
$Op=Join-Path (Obter-PastaPrivada $Raiz) 'operacao';$PidFile=Join-Path $Op 'supervisor.pid.json';$StatusFile=Join-Path $Op 'status.json';$Manutencao=Join-Path $Op 'manutencao.sinal'
$Inicio=Join-Path $Raiz 'INICIAR.bat';$Parar=Join-Path $Raiz 'PARAR.bat';$Atualizador=Join-Path $PSScriptRoot 'atualizar-servidor.ps1';$Startup=Join-Path ([Environment]::GetFolderPath('Startup')) 'Supply Vision.cmd'
# A versao vem do Git, nao de um arquivo mantido a mao: um VERSAO.md so fica
# correto enquanto alguem lembra de edita-lo, e ele ficava desatualizado.
$versao='Consultando versão...'
$form=New-Object Windows.Forms.Form;$form.Text='Supply Vision';$form.Size=New-Object Drawing.Size(580,775);$form.StartPosition='CenterScreen';$form.BackColor=[Drawing.Color]::FromArgb(15,35,58);$form.ForeColor='White';$form.Font=New-Object Drawing.Font('Segoe UI',10);$form.FormBorderStyle='FixedDialog';$form.MaximizeBox=$false
$t=New-Object Windows.Forms.Label;$t.Text='Supply Vision';$t.Font=New-Object Drawing.Font('Segoe UI Semibold',23);$t.Location='30,20';$t.AutoSize=$true;$form.Controls.Add($t)
$v=New-Object Windows.Forms.Label;$v.Text=$versao;$v.ForeColor=[Drawing.Color]::FromArgb(160,188,214);$v.Location='32,64';$v.AutoSize=$true;$form.Controls.Add($v)
$painel=New-Object Windows.Forms.Panel;$painel.Location='30,100';$painel.Size='505,115';$painel.BackColor=[Drawing.Color]::FromArgb(22,49,78);$form.Controls.Add($painel)
$status=New-Object Windows.Forms.Label;$status.Location='18,14';$status.Size='470,90';$status.Font=New-Object Drawing.Font('Segoe UI Semibold',11);$painel.Controls.Add($status)
$andamentoTexto=New-Object Windows.Forms.Label;$andamentoTexto.Location='18,7';$andamentoTexto.Size='470,83';$andamentoTexto.Visible=$false;$painel.Controls.Add($andamentoTexto)
$andamentoBarra=New-Object Windows.Forms.ProgressBar;$andamentoBarra.Location='18,94';$andamentoBarra.Size='470,13';$andamentoBarra.Visible=$false;$painel.Controls.Add($andamentoBarra)
$script:andamentoCentral=$null;$script:proximoAndamento=[datetime]::MinValue
function Botao($texto,$x,$y){$b=New-Object Windows.Forms.Button;$b.Text=$texto;$b.Location=New-Object Drawing.Point($x,$y);$b.Size='240,42';$b.FlatStyle='Flat';$b.BackColor=[Drawing.Color]::FromArgb(30,91,145);$b.ForeColor='White';$b.FlatAppearance.BorderSize=0;$form.Controls.Add($b);return $b}
$iniciar=Botao 'Iniciar operação' 30 235;$parar=Botao 'Parar operação' 295 235;$validar=Botao 'Validar configuração' 30 289;$restaurar=Botao 'Testar backup' 295 289
$atualizar=Botao 'Atualizar sistema' 30 343;$atualizar.Size='505,42';$atualizar.BackColor=[Drawing.Color]::FromArgb(31,122,99)
$voltar=Botao 'Restaurar backup' 30 397;$voltar.Size='505,42';$voltar.BackColor=[Drawing.Color]::FromArgb(150,62,52)
$auto=New-Object Windows.Forms.ComboBox;$auto.DropDownStyle='DropDownList';$auto.Location='32,460';$auto.Size='505,27'
[void]$auto.Items.AddRange(@('Desligado','Ao entrar no Windows (atual)','Ao ligar o computador, sem login'))
$modos=@('desligado','login','computador');$auto.SelectedIndex=-1;$auto.Enabled=$false;$form.Controls.Add($auto)
$avisoSessao=New-Object Windows.Forms.Label;$avisoSessao.Location='32,586';$avisoSessao.Size='505,65';$avisoSessao.ForeColor=[Drawing.Color]::FromArgb(255,180,90);$form.Controls.Add($avisoSessao)

$man=New-Object Windows.Forms.CheckBox;$man.Text='Modo manutenção (pausar rotinas automáticas)';$man.Location='32,494';$man.Size='390,27';$man.Checked=Test-Path $Manutencao;$form.Controls.Add($man)
$avisoBackup=New-Object Windows.Forms.Label;$avisoBackup.Location='32,531';$avisoBackup.Size='505,50';$avisoBackup.Font=New-Object Drawing.Font('Segoe UI',9);$avisoBackup.ForeColor=[Drawing.Color]::FromArgb(255,180,90);$form.Controls.Add($avisoBackup)
$fonteAvisoBackup=$avisoBackup.Font;$fonteAvisoEnsaio=New-Object Drawing.Font('Segoe UI Semibold',11)
$dicas=New-Object Windows.Forms.ToolTip
$dicas.SetToolTip($validar,'Confere arquivos, parâmetros, programas e permissões de escrita. Não testa login no Qlik ou SMTP.')
$dicas.SetToolTip($man,'Pausa novos alertas, backups e limpezas automáticos. Portal, e-mails e pedidos manuais continuam disponíveis; tarefas em andamento terminam.')
$migrar=Botao 'Preparar migração' 30 661;$migrar.Size='505,42'
$script:controle=Novo-ControleCentral
$script:estadoCentral=$null;$script:tarefaCentral=@{modo=$null;aviso='Consultando inicialização...'}
$script:processoAtualizacao=$null;$script:aoConcluirAcao=$null;$script:acaoTipo='';$script:suprimirMan=$false
function Mostrar-AndamentoCentral {
 $a=$script:andamentoCentral
 if(!$a){return}
 $andamentoTexto.Visible=$true;$andamentoBarra.Visible=$true;$status.Visible=$false
 $etapa=$a.etapaSegundos;$total=$a.totalSegundos
 if($a.estado-eq'andamento'){
  $agora=[datetime]::UtcNow
  $etapa=[math]::Max(0,[math]::Floor(($agora-$a.inicioEtapa).TotalSeconds));$total=[math]::Max(0,[math]::Floor(($agora-$a.inicioGeral).TotalSeconds))
 }
 $linha=if($a.estado-eq'andamento'){"Etapa $($a.numero) de $($a.total): $($a.nome)"}else{$a.nome}
 $andamentoTexto.Text="$linha`nEtapa: $etapa s | Total: $total s | Modo $($a.modo)"
 if($null-ne$a.restanteSegundos-and$a.estado-eq'andamento'){$andamentoTexto.Text+="`nRestante estimado: $($a.restanteSegundos) s"}
 $andamentoBarra.Value=$a.progresso
}
function Mostrar-EstadoCentral {
 $d=$script:estadoCentral
 $avisoSessao.Text=Aviso-SessaoRemota $script:tarefaCentral.modo ($env:SESSIONNAME-like'RDP-*')
 if($script:tarefaCentral.aviso){$avisoSessao.Text=$script:tarefaCentral.aviso}
 if(!$d){$status.Text='Consultando estado da operação...';return}
 $avisoBackup.Text=$d.avisoBackup;$avisoBackup.Font=if($d.ensaio){$fonteAvisoEnsaio}else{$fonteAvisoBackup}
 $iniciar.Enabled=!$d.migrada
 if($d.ativo){
  $detalhe='Inicializando módulos...';$st=$d.status
  if($st){$po=if($st.portal){'online'}else{'reiniciando'};$em=if($st.emails){'online'}else{'reiniciando'};$detalhe="Portal: $po  |  E-mails: $em`nAlertas: $($st.alertas)  |  Backup: $($st.backup)`nLimpeza: $($st.limpeza)  |  Disco: $($st.espacoLivreGb) GB livres"}
  $status.Text="● OPERAÇÃO ATIVA`n$detalhe";$status.ForeColor=[Drawing.Color]::FromArgb(87,211,140)
 }else{$status.Text="● OPERAÇÃO PARADA`nUse 'Iniciar operação' quando quiser colocar o conjunto no ar.";$status.ForeColor=[Drawing.Color]::FromArgb(255,180,90)}
 if($d.migrada){$status.Text='Esta instalação foi migrada para outro servidor';$status.ForeColor=[Drawing.Color]::FromArgb(255,180,90)}
}
function Atualizar {
 $medir=[Diagnostics.Stopwatch]::StartNew()
 Iniciar-ConsultasCentral $script:controle $Raiz $Privado $Startup
 $medir.Stop();$script:controle.interfaceMs=$medir.Elapsed.TotalMilliseconds
}
function Pedir-AcaoCentral([string]$Tipo,$Dados,[scriptblock]$Concluir){
 if($script:controle.trabalhos.ContainsKey('acao')){[Windows.Forms.MessageBox]::Show('Já há uma ação em andamento. Aguarde a conclusão.','Supply Vision','OK','Information')|Out-Null;return $false}
 Invalidar-ConsultasCentral $script:controle
 $script:acaoTipo=$Tipo;$script:aoConcluirAcao=$Concluir
 $form.Text='Supply Vision — ação em andamento'
 [void](Iniciar-TrabalhoCentral $script:controle 'acao' (Codigo-AcaoCentral) @($Raiz,$Privado,$Startup,$Tipo,$Dados))
 return $true
}
function Receber-ResultadosCentral {
 $rAndamento=Receber-TrabalhoCentral $script:controle 'andamento'
 if($rAndamento-and$rAndamento.geracao-eq$script:controle.geracao-and$rAndamento.ok-and$rAndamento.valor){$script:andamentoCentral=$rAndamento.valor}
 [void](Cancelar-ConsultaCentral $script:controle 'andamento' 3000)
 if([datetime]::UtcNow-ge$script:proximoAndamento){
  Iniciar-ConsultaAndamentoCentral $script:controle $Raiz $Privado
  $script:proximoAndamento=[datetime]::UtcNow.AddSeconds(1)
 }
 Mostrar-AndamentoCentral
 foreach($tipo in @('estado','tarefa')){
  $r=Receber-TrabalhoCentral $script:controle $tipo
  if($r-and$r.geracao-eq$script:controle.geracao){
   if($r.ok){
    if($tipo-eq'estado'){$script:estadoCentral=$r.valor;if($r.valor.versao){$v.Text=$r.valor.versao}}
    else{$script:tarefaCentral=$r.valor;if($r.valor.modo){$auto.SelectedIndex=[Array]::IndexOf($modos,$r.valor.modo);$auto.Enabled=$true}else{$auto.Enabled=$false}}
   }else{$script:tarefaCentral.aviso='Não foi possível consultar o estado. Os botões continuam disponíveis.'}
   Mostrar-EstadoCentral
  }
  if(Cancelar-ConsultaCentral $script:controle $tipo){$script:tarefaCentral.aviso='Consulta de estado demorou demais. Os botões continuam disponíveis.';$avisoSessao.Text=$script:tarefaCentral.aviso}
 }
 $r=Receber-TrabalhoCentral $script:controle 'acao'
 if($r){
  $form.Text='Supply Vision'
  $tipo=$script:acaoTipo;$concluir=$script:aoConcluirAcao;$script:aoConcluirAcao=$null
  Invalidar-ConsultasCentral $script:controle -Tarefa:($tipo-in@('modo','migrar','atualizar'))
  $resultado=if($r.ok){$r.valor}else{@{erro=$true;mensagem=$r.mensagem}}
  & $concluir $resultado
  Atualizar
 }
 # Apenas consulta o handle do processo; logs e Git ficam no worker.
 if($script:processoAtualizacao-and$script:processoAtualizacao.HasExited-and!$script:controle.trabalhos.ContainsKey('acao')){
  $script:processoAtualizacao.WaitForExit();$script:processoAtualizacao.Refresh()
  $codigo=$script:processoAtualizacao.ExitCode;$script:processoAtualizacao.Dispose();$script:processoAtualizacao=$null
  [void](Pedir-AcaoCentral 'fim-atualizacao' @{codigo=$codigo;saida=$script:saidaAtualizacao} {
   param($r)
   $atualizar.Enabled=$true;$atualizar.Text='Atualizar sistema';if($r.versao){$v.Text=$r.versao}
   if($r.andamento){$script:andamentoCentral=$r.andamento;Mostrar-AndamentoCentral}
   $titulo=if($r.ok){'Atualização concluída'}else{'Atualização não concluída'}
   [Windows.Forms.MessageBox]::Show($r.mensagem,$titulo,'OK',$(if($r.ok){'Information'}else{'Error'}))|Out-Null
  })
 }
}
function Reabrir-CentralElevada {
 Start-Process "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Verb RunAs -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "'+(Join-Path $PSScriptRoot 'central.ps1')+'"')
 $form.Close()
}
# Iniciar-OperacaoConfigurada continua sendo a guarda, dentro do worker.
$iniciar.Add_Click({[void](Pedir-AcaoCentral 'iniciar' @{} {
 param($r)
 if($r.erro){[Windows.Forms.MessageBox]::Show(($r.mensagem+' Para controlar uma conta da tarefa sem permissão, abra a central como administrador.'),'Iniciar operação','OK','Warning')|Out-Null}
})})
$parar.Add_Click({
 if(Pedir-AcaoCentral 'parar' @{} {
  param($r)
  $parar.Enabled=$true
  if(!$r.ok){[Windows.Forms.MessageBox]::Show('A operação não encerrou no prazo. Veja supervisor.log. Para encerrar processos da conta da tarefa à força, é necessário executar como administrador; não remova a trava nem inicie outro supervisor.','Supply Vision','OK','Warning')|Out-Null}
 }){$parar.Enabled=$false}
})
$validar.Add_Click({[void](Pedir-AcaoCentral 'validar' @{} {
 param($r)
 [Windows.Forms.MessageBox]::Show($r.mensagem,$(if($r.ok){'Supply Vision'}else{'Configuração reprovada'}),'OK',$(if($r.ok){'Information'}else{'Error'}))|Out-Null
})})
$restaurar.Add_Click({[void](Pedir-AcaoCentral 'testar-backup' @{} {
 param($r)
 [Windows.Forms.MessageBox]::Show($r.mensagem,$(if($r.ok){'Backup aprovado'}else{'Backup reprovado'}),'OK',$(if($r.ok){'Information'}else{'Error'}))|Out-Null
})})
$voltar.Add_Click({
 $aviso="Isto substitui o banco atual por uma copia de backup.`n`nA operacao sera parada, o estado atual sera guardado numa copia datada e os acordos, cadastros e chamados voltarao ao que eram no momento do backup.`n`nDeseja continuar?"
 if([Windows.Forms.MessageBox]::Show($aviso,'Restaurar backup','YesNo','Warning')-ne[Windows.Forms.DialogResult]::Yes){return}
 $qual=[Windows.Forms.MessageBox]::Show("Usar a copia mais recente?`n`nSim = mais recente (portal-atual)`nNao = ultimo backup de um dia anterior (historico de 7 dias)",'Qual backup','YesNoCancel','Question')
 if($qual-eq[Windows.Forms.DialogResult]::Cancel){return}
 [void](Pedir-AcaoCentral 'restaurar' @{anterior=($qual-eq[Windows.Forms.DialogResult]::No)} {
  param($r)
  [Windows.Forms.MessageBox]::Show($r.mensagem,$(if($r.ok){'Backup restaurado'}else{'Falha ao restaurar'}),'OK',$(if($r.ok){'Information'}else{'Error'}))|Out-Null
 })
})
$atualizar.Add_Click({
 if([Windows.Forms.MessageBox]::Show("O sistema fará um backup, pausará a operação e aplicará a versão aprovada mais recente.`n`nDeseja continuar?",'Atualizar Supply Vision','YesNo','Question')-ne[Windows.Forms.DialogResult]::Yes){return}
 if(Pedir-AcaoCentral 'atualizar' @{} {
  param($r)
  if($r.elevar){$atualizar.Enabled=$true;[Windows.Forms.MessageBox]::Show('Atualizar uma operação com a conta da tarefa exige elevação. A central será reaberta como administrador; clique Atualizar sistema nela.','Elevação necessária','OK','Information')|Out-Null;Reabrir-CentralElevada;return}
  if($r.erro){$atualizar.Enabled=$true;[Windows.Forms.MessageBox]::Show($r.mensagem,'Não foi possível atualizar','OK','Error')|Out-Null;return}
  $script:andamentoCentral=$null;$andamentoTexto.Text='Iniciando atualização...';$andamentoTexto.Visible=$true;$andamentoBarra.Visible=$true;$andamentoBarra.Value=0;$status.Visible=$false;$script:proximoAndamento=[datetime]::MinValue
  $script:processoAtualizacao=$r.processo;$script:saidaAtualizacao=$r.saida;$atualizar.Text='Atualizando...'
 }){$atualizar.Enabled=$false}
})
$auto.Add_SelectionChangeCommitted({
 if(!(Testar-Elevacao)){[Windows.Forms.MessageBox]::Show('Mudar o modo exige Executar como administrador. A central será reaberta elevada; escolha o modo novamente.','Elevação necessária','OK','Information')|Out-Null;Reabrir-CentralElevada;return}
 if(Pedir-AcaoCentral 'modo' @{modo=$modos[$auto.SelectedIndex]} {
  param($r)
  if($r.erro){[Windows.Forms.MessageBox]::Show($r.mensagem,'Inicialização não alterada','OK','Warning')|Out-Null}
 }){$auto.Enabled=$false}else{$auto.SelectedIndex=[Array]::IndexOf($modos,$script:tarefaCentral.modo)}
})
$man.Add_CheckedChanged({
 if($script:suprimirMan){return}
 $valor=$man.Checked
 if(!(Pedir-AcaoCentral 'manutencao' @{ativo=$valor} {
  param($r)
  if($r.erro){$script:suprimirMan=$true;$man.Checked=!$man.Checked;$script:suprimirMan=$false;[Windows.Forms.MessageBox]::Show($r.mensagem,'Manutenção não alterada','OK','Error')|Out-Null}
 })){$script:suprimirMan=$true;$man.Checked=!$man.Checked;$script:suprimirMan=$false}
})
$migrar.Add_Click({
 if(!(Testar-Elevacao)){[Windows.Forms.MessageBox]::Show('A central será reaberta como administrador. Clique Preparar migração novamente.','Elevação necessária')|Out-Null;Reabrir-CentralElevada;return}
 $escolha=[Windows.Forms.MessageBox]::Show("Sim = Semente para ensaio (notebook volta a funcionar).`nNão = Migração definitiva (notebook será bloqueado).`nCancelar = voltar.",'Preparar migração','YesNoCancel','Warning')
 if($escolha-eq'Cancel'){return}
 $pasta=New-Object Windows.Forms.FolderBrowserDialog;$pasta.Description='Escolha a pasta do pen drive para levar ao servidor'
 try{if($pasta.ShowDialog()-ne'OK'){return};$destino=$pasta.SelectedPath}finally{$pasta.Dispose()}
 [void](Pedir-AcaoCentral 'migrar' @{destino=$destino;modo=$(if($escolha-eq'Yes'){'ensaio'}else{'definitiva'})} {
  param($r)
  [Windows.Forms.MessageBox]::Show($(if($r.ok){'Leve a pasta ao servidor e abra MIGRAR.bat. Consulte docs/MIGRAR.md.'}else{$r.mensagem}),$(if($r.ok){'Semente pronta'}else{'Migração não concluída'}),'OK',$(if($r.ok){'Information'}else{'Error'}))|Out-Null
 })
})
$timer=New-Object Windows.Forms.Timer;$timer.Interval=5000;$timer.Add_Tick({Atualizar})
$pulso=New-Object Windows.Forms.Timer;$pulso.Interval=200;$pulso.Add_Tick({Receber-ResultadosCentral})
$form.Add_Shown({Atualizar;$timer.Start();$pulso.Start()})
$form.Add_FormClosing({param($origem,$evento)
 if($script:controle.trabalhos.ContainsKey('acao')){$evento.Cancel=$true;[Windows.Forms.MessageBox]::Show('Aguarde a ação terminar antes de fechar a central.','Supply Vision','OK','Information')|Out-Null}
})
try{[void]$form.ShowDialog()}
finally{
 $timer.Stop();$pulso.Stop();$timer.Dispose();$pulso.Dispose()
 foreach($tipo in @('estado','tarefa','andamento')){[void](Cancelar-ConsultaCentral $script:controle $tipo 0);[void](Receber-TrabalhoCentral $script:controle $tipo)}
 $dicas.Dispose();$fonteAvisoEnsaio.Dispose();$form.Dispose()
}
