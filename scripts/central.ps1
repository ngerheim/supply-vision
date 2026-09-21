Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$Raiz=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
$Op=Join-Path $Raiz 'privado\operacao';$PidFile=Join-Path $Op 'supervisor.pid.json';$StatusFile=Join-Path $Op 'status.json';$Manutencao=Join-Path $Op 'manutencao.sinal'
$Inicio=Join-Path $Raiz 'INICIAR.bat';$Parar=Join-Path $Raiz 'PARAR.bat';$Atualizador=Join-Path $PSScriptRoot 'atualizar-servidor.ps1';$Startup=Join-Path ([Environment]::GetFolderPath('Startup')) 'Supply Vision.cmd'
# A versao vem do Git, nao de um arquivo mantido a mao: um VERSAO.md so fica
# correto enquanto alguem lembra de edita-lo, e ele ficava desatualizado.
$versao=try{(& git -C $Raiz log -1 --date=format:'%d/%m/%Y' --pretty=format:'%h  %ad' 2>$null)}catch{''}
if(!$versao){$versao='versao indisponivel'}
$form=New-Object Windows.Forms.Form;$form.Text='Supply Vision';$form.Size=New-Object Drawing.Size(580,644);$form.StartPosition='CenterScreen';$form.BackColor=[Drawing.Color]::FromArgb(15,35,58);$form.ForeColor='White';$form.Font=New-Object Drawing.Font('Segoe UI',10);$form.FormBorderStyle='FixedDialog';$form.MaximizeBox=$false
$t=New-Object Windows.Forms.Label;$t.Text='Supply Vision';$t.Font=New-Object Drawing.Font('Segoe UI Semibold',23);$t.Location='30,20';$t.AutoSize=$true;$form.Controls.Add($t)
$v=New-Object Windows.Forms.Label;$v.Text=$versao;$v.ForeColor=[Drawing.Color]::FromArgb(160,188,214);$v.Location='32,64';$v.AutoSize=$true;$form.Controls.Add($v)
$painel=New-Object Windows.Forms.Panel;$painel.Location='30,100';$painel.Size='505,115';$painel.BackColor=[Drawing.Color]::FromArgb(22,49,78);$form.Controls.Add($painel)
$status=New-Object Windows.Forms.Label;$status.Location='18,14';$status.Size='470,90';$status.Font=New-Object Drawing.Font('Segoe UI Semibold',11);$painel.Controls.Add($status)
function Botao($texto,$x,$y){$b=New-Object Windows.Forms.Button;$b.Text=$texto;$b.Location=New-Object Drawing.Point($x,$y);$b.Size='240,42';$b.FlatStyle='Flat';$b.BackColor=[Drawing.Color]::FromArgb(30,91,145);$b.ForeColor='White';$b.FlatAppearance.BorderSize=0;$form.Controls.Add($b);return $b}
$iniciar=Botao 'Iniciar operação' 30 235;$parar=Botao 'Parar operação' 295 235;$portal=Botao 'Abrir Portal' 30 289;$logs=Botao 'Abrir registros' 295 289;$validar=Botao 'Validar configuração' 30 343;$restaurar=Botao 'Testar backup' 295 343
$atualizar=Botao 'Atualizar sistema' 30 397;$atualizar.Size='505,42';$atualizar.BackColor=[Drawing.Color]::FromArgb(31,122,99)
$voltar=Botao 'Restaurar backup' 30 451;$voltar.Size='505,42';$voltar.BackColor=[Drawing.Color]::FromArgb(150,62,52)
$auto=New-Object Windows.Forms.CheckBox;$auto.Text='Iniciar automaticamente com o Windows';$auto.Location='32,514';$auto.Size='330,27';$auto.Checked=Test-Path $Startup;$form.Controls.Add($auto)
$man=New-Object Windows.Forms.CheckBox;$man.Text='Modo manutenção (pausar rotinas automáticas)';$man.Location='32,548';$man.Size='390,27';$man.Checked=Test-Path $Manutencao;$form.Controls.Add($man)
$script:processoAtualizacao=$null
function Operacao-Ativa{
 return $null-ne(Obter-ProcessoRegistrado $PidFile)
}
function Parar-Operacao([int]$Limite=60){
 # O supervisor le o sinal no ritmo do proprio laco. Esperar por um relogio
 # fixo dava a operacao como parada antes da hora: a tela voltava a dizer
 # 'ativa' e a restauracao recusava o banco por achar o portal no ar.
 if(!(Operacao-Ativa)){return $true}
 Add-Content (Join-Path $Op 'supervisor.log') "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  CENTRAL: encerramento solicitado." -Encoding UTF8
 Start-Process $Parar -WindowStyle Hidden
 for($i=0;$i-lt$Limite-and(Operacao-Ativa);$i++){Start-Sleep 1}
 $encerrou=!(Operacao-Ativa)
 if(!$encerrou){
  $registro=try{Get-Content $PidFile -Raw}catch{'registro de PID indisponivel'}
  Add-Content (Join-Path $Op 'supervisor.log') "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  CENTRAL: tempo de parada esgotado. Registro: $registro" -Encoding UTF8
 }
 return $encerrou
}
function Atualizar{
 $ativo=Operacao-Ativa
 if($ativo){$detalhe='Inicializando módulos...';if(Test-Path $StatusFile){try{$st=Get-Content $StatusFile -Raw|ConvertFrom-Json;$po=if($st.portal){'online'}else{'reiniciando'};$em=if($st.emails){'online'}else{'reiniciando'};$detalhe="Portal: $po  |  E-mails: $em`nAlertas: $($st.alertas)  |  Backup: $($st.backup)`nLimpeza: $($st.limpeza)  |  Disco: $($st.espacoLivreGb) GB livres"}catch{}};$status.Text="● OPERAÇÃO ATIVA`n$detalhe";$status.ForeColor=[Drawing.Color]::FromArgb(87,211,140)}else{$status.Text="● OPERAÇÃO PARADA`nUse 'Iniciar operação' quando quiser colocar o conjunto no ar.";$status.ForeColor=[Drawing.Color]::FromArgb(255,180,90)}
}
$iniciar.Add_Click({Start-Process $Inicio -WindowStyle Hidden;Start-Sleep 2;Atualizar});$parar.Add_Click({$form.Cursor='WaitCursor';$parar.Enabled=$false;try{$ok=Parar-Operacao}finally{$parar.Enabled=$true;$form.Cursor='Default'};Atualizar;if(!$ok){[Windows.Forms.MessageBox]::Show('A operacao nao encerrou dentro do tempo esperado. Veja privado\operacao\supervisor.log.','Supply Vision','OK','Warning')|Out-Null}});$portal.Add_Click({Start-Process 'http://localhost:3000'});$logs.Add_Click({New-Item -ItemType Directory -Force $Op|Out-Null;Start-Process explorer.exe $Op})
$validar.Add_Click({try{& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'validar-operacao.ps1')|Out-Null;[Windows.Forms.MessageBox]::Show('Configuração aprovada.','Supply Vision','OK','Information')|Out-Null}catch{[Windows.Forms.MessageBox]::Show($_.Exception.Message,'Configuração reprovada','OK','Error')|Out-Null}})
$restaurar.Add_Click({try{$saida=& node.exe (Join-Path $Raiz 'portal\scripts\testar-restauracao.mjs') 2>&1;if($LASTEXITCODE){throw ($saida-join "`n")};[Windows.Forms.MessageBox]::Show(($saida-join "`n"),'Backup aprovado','OK','Information')|Out-Null}catch{[Windows.Forms.MessageBox]::Show($_.Exception.Message,'Backup reprovado','OK','Error')|Out-Null}})
$voltar.Add_Click({
 $aviso="Isto substitui o banco atual por uma copia de backup.`n`nA operacao sera parada, o estado atual sera guardado numa copia datada e os acordos, cadastros e chamados voltarao ao que eram no momento do backup.`n`nDeseja continuar?"
 if([Windows.Forms.MessageBox]::Show($aviso,'Restaurar backup','YesNo','Warning')-ne[Windows.Forms.DialogResult]::Yes){return}
 $qual=[Windows.Forms.MessageBox]::Show("Usar a copia mais recente?`n`nSim = mais recente (portal-atual)`nNao = geracao anterior (portal-atual.anterior)",'Qual backup','YesNoCancel','Question')
 if($qual-eq[Windows.Forms.DialogResult]::Cancel){return}
 try{
  if(!(Parar-Operacao)){throw 'A operacao nao encerrou. Restauracao cancelada para nao mexer no banco com o portal no ar.'}
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
  New-Item -ItemType Directory -Force $Op|Out-Null
  $saida=Join-Path $Op 'atualizacao-saida.log';$erro=Join-Path $Op 'atualizacao-erro.log'
  Remove-Item $saida,$erro -Force -ErrorAction SilentlyContinue
  $argumentosAtualizador="-NoProfile -ExecutionPolicy Bypass -File `"$Atualizador`""
  $script:processoAtualizacao=Start-Process powershell.exe -ArgumentList $argumentosAtualizador -WindowStyle Hidden -PassThru -RedirectStandardOutput $saida -RedirectStandardError $erro
  $atualizar.Enabled=$false;$atualizar.Text='Atualizando...'
 }catch{[Windows.Forms.MessageBox]::Show($_.Exception.Message,'Não foi possível atualizar','OK','Error')|Out-Null}
})
$auto.Add_CheckedChanged({if($auto.Checked){$linha="@echo off`r`nstart `"`" `"$Inicio`"`r`n";[IO.File]::WriteAllText($Startup,$linha,[Text.Encoding]::ASCII)}elseif(Test-Path $Startup){Remove-Item $Startup -Force}})
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
   $detalhe=@(Get-Content $erro,$saida -ErrorAction SilentlyContinue|Select-Object -Last 12)-join"`n"
   if(!$detalhe){$detalhe='Consulte os registros da operação para mais detalhes.'}
   [Windows.Forms.MessageBox]::Show($detalhe,'Atualização não concluída','OK','Error')|Out-Null
  }
 }
});$timer.Start();Atualizar;[void]$form.ShowDialog()
