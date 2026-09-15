$ErrorActionPreference='Stop'
$raizReal=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$temp=Join-Path $env:TEMP ('supply-vision-supervisor-'+[guid]::NewGuid().ToString('N'))
$processos=@();$pathAnterior=$env:Path
try{
 $dirs=@('scripts','portal\dist\server','alertas\.venv\Scripts','privado\comum','privado\portal\configuracao','privado\portal\logs','privado\alertas\config','privado\alertas\logs','privado\alertas\relatorios\diarios','privado\alertas\parametros\de_para','privado\operacao','bin')
 $dirs|ForEach-Object{New-Item -ItemType Directory -Force (Join-Path $temp $_)|Out-Null}
 Copy-Item "$raizReal\scripts\supervisor.ps1","$raizReal\scripts\operacao-logica.ps1","$raizReal\scripts\validar-operacao.ps1","$raizReal\scripts\notificacao.ps1" "$temp\scripts"
 $conteudos=@{'portal\dist\server\wrangler.json'='{}';'alertas\.venv\Scripts\python.exe'='teste';'privado\alertas\config\cfg_qlik.txt'='token';'privado\alertas\config\destinatarios.txt'='destino';'privado\alertas\parametros\de_para\itens.csv'='origem,destino';'privado\alertas\parametros\de_para\modelos.csv'='origem,destino';'acordos.xlsx'='teste'}
 foreach($item in $conteudos.GetEnumerator()){[IO.File]::WriteAllText((Join-Path $temp $item.Key),$item.Value)}
 [IO.File]::WriteAllText("$temp\bin\npm.cmd","@echo off`r`nping 127.0.0.1 -n 60 >nul`r`n",[Text.Encoding]::ASCII)
 [IO.File]::WriteAllText("$temp\privado\comum\smtp.env","SMTP_HOST=x`r`nSMTP_PORT=1`r`nSMTP_USER=x`r`nSMTP_PASSWORD=x`r`nEMAIL_FROM_NAME=x")
 [IO.File]::WriteAllText("$temp\privado\portal\configuracao\portal.env","PORTAL_URL=x`r`nBACKUP_EMAIL_TO=x")
 [IO.File]::WriteAllText("$temp\privado\alertas\config\cfg_ambiente.txt","QLIK_TENANT=x`r`nQLIK_APP_ID=x`r`nQLIK_OBJ_ID=x`r`nDESTINATARIO_ALERTA=x`r`nACORDO_PATH=$temp\acordos.xlsx")
 [IO.File]::WriteAllText("$temp\privado\comum\operacao.env","ALERTAS_HORARIOS=00:00`r`nBACKUP_HORARIOS=00:00`r`nLIMPEZA_HORARIO=00:00`r`nESPACO_MINIMO_GB=1")
 $data=Get-Date -Format yyyy-MM-dd;@{"alertas-$data-00:00"='ok';"backup-$data-00:00"='ok';"limpeza-$data-00:00"='ok'}|ConvertTo-Json|Set-Content "$temp\privado\operacao\estado.json"
 $env:Path="$temp\bin;$pathAnterior";$args=@('-NoProfile','-ExecutionPolicy','Bypass','-File',"$temp\scripts\supervisor.ps1")
 $a=Start-Process powershell.exe -ArgumentList $args -PassThru -WindowStyle Hidden;$b=Start-Process powershell.exe -ArgumentList $args -PassThru -WindowStyle Hidden;$processos=@($a,$b)
 Start-Sleep 4;$vivos=@($processos|Where-Object{!$_.HasExited});if($vivos.Count-ne1){throw "Lock falhou: $($vivos.Count) instancias ativas."}
 # Espera ativa pelo status.json. Espera fixa era corrida: a verificacao de
 # saude contra um host inexistente sozinha ja consome quase 3 segundos.
 $statusPath="$temp\privado\operacao\status.json";$apareceu=$false
 for($i=0;$i -lt 60;$i++){if(Test-Path $statusPath){$apareceu=$true;break};Start-Sleep -Milliseconds 500}
 if(!$apareceu){throw 'Supervisor nao gravou status.json dentro do prazo.'}
 $status=Get-Content $statusPath -Raw|ConvertFrom-Json;if(!$status.portal-or!$status.emails){throw 'Supervisor nao iniciou os processos simulados.'}
 New-Item -ItemType File -Force "$temp\privado\operacao\parar.sinal"|Out-Null;$vivos[0].WaitForExit(25000)|Out-Null;if(!$vivos[0].HasExited){throw 'Supervisor nao encerrou.'}
 Write-Host 'Supervisor isolado: concorrencia, estado e encerramento aprovados.' -ForegroundColor Green
}finally{$env:Path=$pathAnterior;foreach($p in $processos){if($p-and!$p.HasExited){& taskkill.exe /PID $p.Id /T /F 2>$null|Out-Null}};if(Test-Path $temp){Remove-Item $temp -Recurse -Force}}
