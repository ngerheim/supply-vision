Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$Raiz=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
. (Join-Path $PSScriptRoot 'inicializacao-logica.ps1')
. (Join-Path $PSScriptRoot 'migracao-logica.ps1')
$Op=Join-Path (Obter-PastaPrivada $Raiz) 'operacao';$PidFile=Join-Path $Op 'supervisor.pid.json';$StatusFile=Join-Path $Op 'status.json';$Manutencao=Join-Path $Op 'manutencao.sinal'
$Inicio=Join-Path $Raiz 'INICIAR.bat';$Parar=Join-Path $Raiz 'PARAR.bat';$Atualizador=Join-Path $PSScriptRoot 'atualizar-servidor.ps1';$Startup=Join-Path ([Environment]::GetFolderPath('Startup')) 'Supply Vision.cmd'
# A versao vem do Git, nao de um arquivo mantido a mao: um VERSAO.md so fica
# correto enquanto alguem lembra de edita-lo, e ele ficava desatualizado.
$versao=try{(& git -C $Raiz log -1 --date=format:'%d/%m/%Y' --pretty=format:'%h  %ad' 2>$null)}catch{''}
if(!$versao){$versao='versao indisponivel'}
$form=New-Object Windows.Forms.Form;$form.Text='Supply Vision';$form.Size=New-Object Drawing.Size(580,775);$form.StartPosition='CenterScreen';$form.BackColor=[Drawing.Color]::FromArgb(15,35,58);$form.ForeColor='White';$form.Font=New-Object Drawing.Font('Segoe UI',10);$form.FormBorderStyle='FixedDialog';$form.MaximizeBox=$false
$t=New-Object Windows.Forms.Label;$t.Text='Supply Vision';$t.Font=New-Object Drawing.Font('Segoe UI Semibold',23);$t.Location='30,20';$t.AutoSize=$true;$form.Controls.Add($t)
$v=New-Object Windows.Forms.Label;$v.Text=$versao;$v.ForeColor=[Drawing.Color]::FromArgb(160,188,214);$v.Location='32,64';$v.AutoSize=$true;$form.Controls.Add($v)
$painel=New-Object Windows.Forms.Panel;$painel.Location='30,100';$painel.Size='505,115';$painel.BackColor=[Drawing.Color]::FromArgb(22,49,78);$form.Controls.Add($painel)
$status=New-Object Windows.Forms.Label;$status.Location='18,14';$status.Size='470,90';$status.Font=New-Object Drawing.Font('Segoe UI Semibold',11);$painel.Controls.Add($status)
function Botao($texto,$x,$y){$b=New-Object Windows.Forms.Button;$b.Text=$texto;$b.Location=New-Object Drawing.Point($x,$y);$b.Size='240,42';$b.FlatStyle='Flat';$b.BackColor=[Drawing.Color]::FromArgb(30,91,145);$b.ForeColor='White';$b.FlatAppearance.BorderSize=0;$form.Controls.Add($b);return $b}
$iniciar=Botao 'Iniciar operação' 30 235;$parar=Botao 'Parar operação' 295 235;$validar=Botao 'Validar configuração' 30 289;$restaurar=Botao 'Testar backup' 295 289
$atualizar=Botao 'Atualizar sistema' 30 343;$atualizar.Size='505,42';$atualizar.BackColor=[Drawing.Color]::FromArgb(31,122,99)
$voltar=Botao 'Restaurar backup' 30 397;$voltar.Size='505,42';$voltar.BackColor=[Drawing.Color]::FromArgb(150,62,52)
$auto=New-Object Windows.Forms.ComboBox;$auto.DropDownStyle='DropDownList';$auto.Location='32,460';$auto.Size='505,27'
[void]$auto.Items.AddRange(@('Desligado','Ao entrar no Windows (atual)','Ao ligar o computador, sem login'))
$modos=@('desligado','login','computador');$auto.SelectedIndex=[Array]::IndexOf($modos,(Obter-ModoInicializacao $Raiz $Startup));$form.Controls.Add($auto)
$avisoSessao=New-Object Windows.Forms.Label;$avisoSessao.Location='32,586';$avisoSessao.Size='505,65';$avisoSessao.ForeColor=[Drawing.Color]::FromArgb(255,180,90);$form.Controls.Add($avisoSessao)

$man=New-Object Windows.Forms.CheckBox;$man.Text='Modo manutenção (pausar rotinas automáticas)';$man.Location='32,494';$man.Size='390,27';$man.Checked=Test-Path $Manutencao;$form.Controls.Add($man)
$avisoBackup=New-Object Windows.Forms.Label;$avisoBackup.Location='32,531';$avisoBackup.Size='505,50';$avisoBackup.Font=New-Object Drawing.Font('Segoe UI',9);$avisoBackup.ForeColor=[Drawing.Color]::FromArgb(255,180,90);$form.Controls.Add($avisoBackup)
$fonteAvisoBackup=$avisoBackup.Font;$fonteAvisoEnsaio=New-Object Drawing.Font('Segoe UI Semibold',11)
$dicas=New-Object Windows.Forms.ToolTip
$dicas.SetToolTip($validar,'Confere arquivos, parâmetros, programas e permissões de escrita. Não testa login no Qlik ou SMTP.')
$dicas.SetToolTip($man,'Pausa novos alertas, backups e limpezas automáticos. Portal, e-mails e pedidos manuais continuam disponíveis; tarefas em andamento terminam.')
$migrar=Botao 'Preparar migração' 30 661;$migrar.Size='505,42'
$migrar.Add_Click({
 try{
  if(!(Testar-Elevacao)){[Windows.Forms.MessageBox]::Show('A central será reaberta como administrador. Clique Preparar migração novamente.','Elevação necessária')|Out-Null;Reabrir-CentralElevada;return}
  $escolha=[Windows.Forms.MessageBox]::Show("Sim = Semente para ensaio (notebook volta a funcionar).`nNão = Migração definitiva (notebook será bloqueado).`nCancelar = voltar.",'Preparar migração','YesNoCancel','Warning')
  if($escolha-eq'Cancel'){return}
  $pasta=New-Object Windows.Forms.FolderBrowserDialog;$pasta.Description='Escolha a pasta do pen drive para levar ao servidor'
  try{if($pasta.ShowDialog()-ne'OK'){return};$destino=$pasta.SelectedPath}finally{$pasta.Dispose()}
  $modo=if($escolha-eq'Yes'){'ensaio'}else{'definitiva'}
  Preparar-Migracao $Raiz (Obter-PastaPrivada $Raiz) $Startup $destino $modo
  [Windows.Forms.MessageBox]::Show('Leve a pasta ao servidor e abra MIGRAR.bat. Consulte docs/MIGRAR.md.','Semente pronta')|Out-Null
 }catch{[Windows.Forms.MessageBox]::Show($_.Exception.Message,'Migração não concluída')|Out-Null}
 Atualizar
})
$script:processoAtualizacao=$null
function Operacao-Ativa{
 return !(Testar-SupervisorEncerrado (Obter-PastaPrivada $Raiz))
}
function Atualizar{
 $modo=Obter-ModoInicializacao $Raiz $Startup
 $avisoSessao.Text=Aviso-SessaoRemota $modo ($env:SESSIONNAME-like'RDP-*')
 try{$avisoConta=Obter-AvisoContaTarefa $Raiz;if($avisoConta){$avisoSessao.Text=$avisoConta}}catch{}
 $ensaio=$false
 try{$ensaio=(Ler-ConfigOperacao (Join-Path (Obter-PastaPrivada $Raiz) 'comum\operacao.env'))['MODO_ENSAIO']-eq'1'}catch{}
 # Enquanto ativo, mostra o modo efetivo mesmo se o arquivo foi editado sem reiniciar.
 if((Operacao-Ativa)-and(Test-Path $StatusFile)){try{$ensaio=!!(Get-Content $StatusFile -Raw|ConvertFrom-Json).ensaio}catch{}}
 if($ensaio){$avisoBackup.Text=Obter-AvisoEnsaio $true;$avisoBackup.Font=$fonteAvisoEnsaio}
 else{$avisoBackup.Text=Obter-AvisoBackup (Obter-PastaPrivada $Raiz);$avisoBackup.Font=$fonteAvisoBackup}
 $iniciar.Enabled=!(Test-Path (Join-Path $Op 'migrada.sinal'))
 $ativo=Operacao-Ativa
 if($ativo){$detalhe='Inicializando módulos...';if(Test-Path $StatusFile){try{$st=Get-Content $StatusFile -Raw|ConvertFrom-Json;$po=if($st.portal){'online'}else{'reiniciando'};$em=if($st.emails){'online'}else{'reiniciando'};$detalhe="Portal: $po  |  E-mails: $em`nAlertas: $($st.alertas)  |  Backup: $($st.backup)`nLimpeza: $($st.limpeza)  |  Disco: $($st.espacoLivreGb) GB livres"}catch{}};$status.Text="● OPERAÇÃO ATIVA`n$detalhe";$status.ForeColor=[Drawing.Color]::FromArgb(87,211,140)}else{$status.Text="● OPERAÇÃO PARADA`nUse 'Iniciar operação' quando quiser colocar o conjunto no ar.";$status.ForeColor=[Drawing.Color]::FromArgb(255,180,90)}
 if(!$iniciar.Enabled){$status.Text='Esta instalação foi migrada para outro servidor';$status.ForeColor=[Drawing.Color]::FromArgb(255,180,90)}
}
$iniciar.Add_Click({try{Iniciar-OperacaoConfigurada $Raiz;Start-Sleep 2;Atualizar}catch{[Windows.Forms.MessageBox]::Show(($_.Exception.Message+' Para controlar uma tarefa SYSTEM sem permissão, abra a central como administrador.'),'Iniciar operação','OK','Warning')|Out-Null}});$parar.Add_Click({$form.Cursor='WaitCursor';$parar.Enabled=$false;try{$ok=Parar-Operacao $Raiz}finally{$parar.Enabled=$true;$form.Cursor='Default'};Atualizar;if(!$ok){[Windows.Forms.MessageBox]::Show('A operação não encerrou no prazo. Veja supervisor.log. Para encerrar processos SYSTEM à força, é necessário executar como administrador; não remova a trava nem inicie outro supervisor.','Supply Vision','OK','Warning')|Out-Null}})
$validar.Add_Click({try{$saida=& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'validar-operacao.ps1') 2>&1;if($LASTEXITCODE-ne0){throw ($saida-join "`n")};[Windows.Forms.MessageBox]::Show('Configuração aprovada.','Supply Vision','OK','Information')|Out-Null}catch{[Windows.Forms.MessageBox]::Show($_.Exception.Message,'Configuração reprovada','OK','Error')|Out-Null}})
$restaurar.Add_Click({try{$saida=& node.exe (Join-Path $Raiz 'portal\scripts\testar-restauracao.mjs') 2>&1;if($LASTEXITCODE){throw ($saida-join "`n")};[Windows.Forms.MessageBox]::Show(($saida-join "`n"),'Backup aprovado','OK','Information')|Out-Null}catch{[Windows.Forms.MessageBox]::Show($_.Exception.Message,'Backup reprovado','OK','Error')|Out-Null}})
$voltar.Add_Click({
 $aviso="Isto substitui o banco atual por uma copia de backup.`n`nA operacao sera parada, o estado atual sera guardado numa copia datada e os acordos, cadastros e chamados voltarao ao que eram no momento do backup.`n`nDeseja continuar?"
 if([Windows.Forms.MessageBox]::Show($aviso,'Restaurar backup','YesNo','Warning')-ne[Windows.Forms.DialogResult]::Yes){return}
 $qual=[Windows.Forms.MessageBox]::Show("Usar a copia mais recente?`n`nSim = mais recente (portal-atual)`nNao = ultimo backup de um dia anterior (historico de 7 dias)",'Qual backup','YesNoCancel','Question')
 if($qual-eq[Windows.Forms.DialogResult]::Cancel){return}
 try{
  if(!(Parar-Operacao $Raiz)){throw 'A operacao nao encerrou. Restauracao cancelada para nao mexer no banco com o portal no ar.'}
  $argumentos=@((Join-Path $Raiz 'portal\scripts\restaurar-backup.mjs'),'--sim')
  if($qual-eq[Windows.Forms.DialogResult]::No){$argumentos+='--anterior'}
  $saida=& node.exe @argumentos 2>&1
  if($LASTEXITCODE){throw ($saida-join "`n")}
  [Windows.Forms.MessageBox]::Show((($saida-join "`n")+"`n`nInicie a operacao para voltar ao ar."),'Backup restaurado','OK','Information')|Out-Null
 }catch{[Windows.Forms.MessageBox]::Show($_.Exception.Message,'Falha ao restaurar','OK','Error')|Out-Null}
 Atualizar
})
$atualizar.Add_Click({
 $confirmar=[Windows.Forms.MessageBox]::Show("O sistema fará um backup, pausará a operação e aplicará a versão aprovada mais recente.`n`nDeseja continuar?",'Atualizar Supply Vision','YesNo','Question')
 if($confirmar-ne[Windows.Forms.DialogResult]::Yes){return}
 try{
  if((Obter-TarefaSupplyVision $Raiz)-and!(Testar-Elevacao)){[Windows.Forms.MessageBox]::Show('Atualizar uma operação SYSTEM exige elevação. A central será reaberta como administrador; clique Atualizar sistema nela.','Elevação necessária','OK','Information')|Out-Null;Reabrir-CentralElevada;return}
  New-Item -ItemType Directory -Force $Op|Out-Null
  $saida=Join-Path $Op 'atualizacao-saida.log';$erro=Join-Path $Op 'atualizacao-erro.log'
  Remove-Item $saida,$erro -Force -ErrorAction SilentlyContinue
  $argumentosAtualizador="-NoProfile -ExecutionPolicy Bypass -File `"$Atualizador`""
  $script:processoAtualizacao=Start-Process powershell.exe -ArgumentList $argumentosAtualizador -WindowStyle Hidden -PassThru -RedirectStandardOutput $saida -RedirectStandardError $erro
  $atualizar.Enabled=$false;$atualizar.Text='Atualizando...'
 }catch{[Windows.Forms.MessageBox]::Show($_.Exception.Message,'Não foi possível atualizar','OK','Error')|Out-Null}
})
function Reabrir-CentralElevada {
 Start-Process "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Verb RunAs -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "'+(Join-Path $PSScriptRoot 'central.ps1')+'"')
 $form.Close()
}
$auto.Add_SelectionChangeCommitted({
 $modo=$modos[$auto.SelectedIndex]
 try{
  if(!(Testar-Elevacao)){
   [Windows.Forms.MessageBox]::Show('Mudar o modo exige Executar como administrador. A central será reaberta elevada; escolha o modo novamente.','Elevação necessária','OK','Information')|Out-Null
   Reabrir-CentralElevada;return
  }
  if(Operacao-Ativa){throw 'Pare a operação antes de mudar o modo de inicialização.'}
  Definir-ModoInicializacao $Raiz (Obter-PastaPrivada $Raiz) $Startup $modo
 }catch{[Windows.Forms.MessageBox]::Show($_.Exception.Message,'Inicialização não alterada','OK','Warning')|Out-Null}
 $auto.SelectedIndex=[Array]::IndexOf($modos,(Obter-ModoInicializacao $Raiz $Startup));Atualizar
})
$man.Add_CheckedChanged({New-Item -ItemType Directory -Force $Op|Out-Null;if($man.Checked){New-Item -ItemType File -Force $Manutencao|Out-Null}else{Remove-Item $Manutencao -Force -ErrorAction SilentlyContinue};Atualizar})
$timer=New-Object Windows.Forms.Timer;$timer.Interval=5000;$timer.Add_Tick({
 Atualizar
 if($script:processoAtualizacao-and$script:processoAtualizacao.HasExited){
  $script:processoAtualizacao.WaitForExit();$script:processoAtualizacao.Refresh()
  $codigo=$script:processoAtualizacao.ExitCode;$script:processoAtualizacao.Dispose();$script:processoAtualizacao=$null
  $atualizar.Enabled=$true;$atualizar.Text='Atualizar sistema'
  $v.Text=try{(& git -C $Raiz log -1 --date=format:'%d/%m/%Y' --pretty=format:'%h  %ad' 2>$null)}catch{'versão indisponível'}
  $saidaTexto=@(Get-Content (Join-Path $Op 'atualizacao-saida.log') -ErrorAction SilentlyContinue)-join"`n"
  $concluiu = ($codigo -eq 0) -or ($saidaTexto -match '=== Atualizado: .+ ===') -or ($saidaTexto -like '*Nada a fazer*')
  if($concluiu){
   $mensagem=if($saidaTexto-like'*Nada a fazer*'){'O sistema já está na versão mais recente.'}else{'Sistema atualizado e operação reiniciada.'}
   [Windows.Forms.MessageBox]::Show($mensagem,'Atualização concluída','OK','Information')|Out-Null
  }
  else{
   $erro=Join-Path $Op 'atualizacao-erro.log';$saida=Join-Path $Op 'atualizacao-saida.log'
   $linhasErro=@(Get-Content $erro -ErrorAction SilentlyContinue|Select-Object -Last 8)
   $linhasSaida=@(Get-Content $saida -ErrorAction SilentlyContinue|Select-Object -Last 12)
   $detalhe=@($(if($linhasErro){'ERRO:';$linhasErro});$(if($linhasSaida){'ULTIMAS ETAPAS:';$linhasSaida}))-join"`n"
   if(!$detalhe){$detalhe='Consulte os registros da operação para mais detalhes.'}
   [Windows.Forms.MessageBox]::Show($detalhe,'Atualização não concluída','OK','Error')|Out-Null
  }
 }
});$timer.Start();Atualizar;[void]$form.ShowDialog()
