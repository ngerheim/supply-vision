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
