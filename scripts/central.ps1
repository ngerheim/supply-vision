Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$Raiz=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Op=Join-Path $Raiz 'privado\operacao';$PidFile=Join-Path $Op 'supervisor.pid.json';$StatusFile=Join-Path $Op 'status.json';$Manutencao=Join-Path $Op 'manutencao.sinal'
$Inicio=Join-Path $Raiz 'INICIAR.bat';$Parar=Join-Path $Raiz 'PARAR.bat';$Startup=Join-Path ([Environment]::GetFolderPath('Startup')) 'Supply Vision.cmd'
# A versao vem do Git, nao de um arquivo mantido a mao: um VERSAO.md so fica
# correto enquanto alguem lembra de edita-lo, e ele ficava desatualizado.
$versao=try{(& git -C $Raiz log -1 --date=format:'%d/%m/%Y' --pretty=format:'%h  %ad' 2>$null)}catch{''}
if(!$versao){$versao='versao indisponivel'}
$form=New-Object Windows.Forms.Form;$form.Text='Supply Vision';$form.Size=New-Object Drawing.Size(580,520);$form.StartPosition='CenterScreen';$form.BackColor=[Drawing.Color]::FromArgb(15,35,58);$form.ForeColor='White';$form.Font=New-Object Drawing.Font('Segoe UI',10);$form.FormBorderStyle='FixedDialog';$form.MaximizeBox=$false
$t=New-Object Windows.Forms.Label;$t.Text='Supply Vision';$t.Font=New-Object Drawing.Font('Segoe UI Semibold',23);$t.Location='30,20';$t.AutoSize=$true;$form.Controls.Add($t)
$v=New-Object Windows.Forms.Label;$v.Text=$versao;$v.ForeColor=[Drawing.Color]::FromArgb(160,188,214);$v.Location='32,64';$v.AutoSize=$true;$form.Controls.Add($v)
$painel=New-Object Windows.Forms.Panel;$painel.Location='30,100';$painel.Size='505,115';$painel.BackColor=[Drawing.Color]::FromArgb(22,49,78);$form.Controls.Add($painel)
$status=New-Object Windows.Forms.Label;$status.Location='18,14';$status.Size='470,90';$status.Font=New-Object Drawing.Font('Segoe UI Semibold',11);$painel.Controls.Add($status)
function Botao($texto,$x,$y){$b=New-Object Windows.Forms.Button;$b.Text=$texto;$b.Location=New-Object Drawing.Point($x,$y);$b.Size='240,42';$b.FlatStyle='Flat';$b.BackColor=[Drawing.Color]::FromArgb(30,91,145);$b.ForeColor='White';$b.FlatAppearance.BorderSize=0;$form.Controls.Add($b);return $b}
$iniciar=Botao 'Iniciar operação' 30 235;$parar=Botao 'Parar operação' 295 235;$portal=Botao 'Abrir Portal' 30 289;$logs=Botao 'Abrir registros' 295 289;$validar=Botao 'Validar configuração' 30 343;$restaurar=Botao 'Testar backup' 295 343
$auto=New-Object Windows.Forms.CheckBox;$auto.Text='Iniciar automaticamente com o Windows';$auto.Location='32,404';$auto.Size='330,27';$auto.Checked=Test-Path $Startup;$form.Controls.Add($auto)
$man=New-Object Windows.Forms.CheckBox;$man.Text='Modo manutenção (pausar rotinas automáticas)';$man.Location='32,438';$man.Size='390,27';$man.Checked=Test-Path $Manutencao;$form.Controls.Add($man)
function Atualizar{
 $ativo=$false;if(Test-Path $PidFile){try{$r=Get-Content $PidFile -Raw|ConvertFrom-Json;$ativo=$null-ne(Get-Process -Id $r.pid -ErrorAction SilentlyContinue)}catch{}}
 if($ativo){$detalhe='Inicializando módulos...';if(Test-Path $StatusFile){try{$st=Get-Content $StatusFile -Raw|ConvertFrom-Json;$po=if($st.portal){'online'}else{'reiniciando'};$em=if($st.emails){'online'}else{'reiniciando'};$detalhe="Portal: $po  |  E-mails: $em`nAlertas: $($st.alertas)  |  Backup: $($st.backup)`nLimpeza: $($st.limpeza)  |  Disco: $($st.espacoLivreGb) GB livres"}catch{}};$status.Text="● OPERAÇÃO ATIVA`n$detalhe";$status.ForeColor=[Drawing.Color]::FromArgb(87,211,140)}else{$status.Text="● OPERAÇÃO PARADA`nUse 'Iniciar operação' quando quiser colocar o conjunto no ar.";$status.ForeColor=[Drawing.Color]::FromArgb(255,180,90)}
}
$iniciar.Add_Click({Start-Process $Inicio -WindowStyle Hidden;Start-Sleep 2;Atualizar});$parar.Add_Click({Start-Process $Parar -WindowStyle Hidden;Start-Sleep 2;Atualizar});$portal.Add_Click({Start-Process 'http://localhost:3000'});$logs.Add_Click({New-Item -ItemType Directory -Force $Op|Out-Null;Start-Process explorer.exe $Op})
$validar.Add_Click({try{& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'validar-operacao.ps1')|Out-Null;[Windows.Forms.MessageBox]::Show('Configuração aprovada.','Supply Vision','OK','Information')|Out-Null}catch{[Windows.Forms.MessageBox]::Show($_.Exception.Message,'Configuração reprovada','OK','Error')|Out-Null}})
$restaurar.Add_Click({try{$saida=& node.exe (Join-Path $Raiz 'portal\scripts\testar-restauracao.mjs') 2>&1;if($LASTEXITCODE){throw ($saida-join "`n")};[Windows.Forms.MessageBox]::Show(($saida-join "`n"),'Backup aprovado','OK','Information')|Out-Null}catch{[Windows.Forms.MessageBox]::Show($_.Exception.Message,'Backup reprovado','OK','Error')|Out-Null}})
$auto.Add_CheckedChanged({if($auto.Checked){$linha="@echo off`r`nstart `"`" `"$Inicio`"`r`n";[IO.File]::WriteAllText($Startup,$linha,[Text.Encoding]::ASCII)}elseif(Test-Path $Startup){Remove-Item $Startup -Force}})
$man.Add_CheckedChanged({New-Item -ItemType Directory -Force $Op|Out-Null;if($man.Checked){New-Item -ItemType File -Force $Manutencao|Out-Null}else{Remove-Item $Manutencao -Force -ErrorAction SilentlyContinue};Atualizar})
$timer=New-Object Windows.Forms.Timer;$timer.Interval=5000;$timer.Add_Tick({Atualizar});$timer.Start();Atualizar;[void]$form.ShowDialog()
