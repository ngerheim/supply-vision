param([switch]$SemLogin, [switch]$Ensaio, [ValidateSet('', 'falha', 'lento')][string]$AvisoAdminTeste='')
$ErrorActionPreference='Stop'
$raizReal=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$temp=Join-Path $env:TEMP ('supply-vision-supervisor-'+[guid]::NewGuid().ToString('N'))
$processos=@();$pathAnterior=$env:Path;$privadoAnterior=$env:SUPPLY_VISION_PRIVADO;$ensaioAnterior=$env:MODO_ENSAIO;$adminAnterior=$env:ADMIN_ALERTA_EMAIL
function Remover-DiretorioTemporario([string]$Caminho){
 $alvoSeguro=[IO.Path]::GetFullPath($Caminho);$baseSegura=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
 if(!$alvoSeguro.StartsWith($baseSegura,[StringComparison]::OrdinalIgnoreCase)-or!(Split-Path $alvoSeguro -Leaf).StartsWith('supply-vision-supervisor-')){throw 'Diretorio de teste fora da raiz temporaria.'}

 # taskkill retorna antes de o Windows liberar completamente o diretorio de
 # trabalho dos filhos. A limpeza faz parte do teste, mas essa pequena janela
 # nao pode transformar um supervisor aprovado em falha de atualizacao.
 for($tentativa=1;$tentativa-le20;$tentativa++){
  try{Remove-Item -LiteralPath $Caminho -Recurse -Force -ErrorAction Stop;return}catch{
   if($tentativa-eq20){throw "Nao foi possivel limpar o teste isolado apos 10 segundos: $($_.Exception.Message)"}
   Start-Sleep -Milliseconds 500
  }
 }
}
try{
 $dirs=@('scripts','portal\dist\server','portal\scripts','alertas\.venv\Scripts','privado\comum','privado\portal\configuracao','privado\portal\logs','privado\alertas\config','privado\alertas\logs','privado\alertas\relatorios\diarios','privado\alertas\parametros\de_para','privado\operacao','bin')
 $dirs|ForEach-Object{New-Item -ItemType Directory -Force (Join-Path $temp $_)|Out-Null}
 Copy-Item "$raizReal\scripts\supervisor.ps1","$raizReal\scripts\operacao-logica.ps1","$raizReal\scripts\validar-operacao.ps1","$raizReal\scripts\notificacao.ps1","$raizReal\scripts\avisos-admin.ps1","$raizReal\scripts\inicializacao-logica.ps1" "$temp\scripts"
 $conteudos=@{'portal\dist\server\wrangler.json'='{}';'portal\dist\server\index.js'='const PORTAL_API_TOKEN="x";';'alertas\.venv\Scripts\python.exe'='teste';'privado\alertas\config\cfg_qlik.txt'='token';'privado\alertas\config\destinatarios.txt'='destino';'privado\alertas\parametros\de_para\itens.csv'='origem,destino';'privado\alertas\parametros\de_para\modelos.csv'='origem,destino';'acordos.xlsx'='teste'}
 foreach($item in $conteudos.GetEnumerator()){[IO.File]::WriteAllText((Join-Path $temp $item.Key),$item.Value)}
 New-Item -ItemType Directory -Force "$temp\alertas\processo","$temp\privado\alertas\parametros\filtros"|Out-Null
 Copy-Item "$raizReal\alertas\parametros" "$temp\alertas" -Recurse -Force
 Copy-Item "$raizReal\alertas\processo\validar_parametros.py" "$temp\alertas\processo"
 $parametros=Join-Path $raizReal 'alertas/parametros'
 foreach($exemplo in @(Get-ChildItem $parametros -Recurse -File | Where-Object Name -Like '*.exemplo.*')){
   $relativo=$exemplo.FullName.Substring($parametros.Length).TrimStart('\').Replace('.exemplo','')
   Copy-Item $exemplo.FullName (Join-Path "$temp\privado\alertas\parametros" $relativo) -Force
 }
 [IO.File]::WriteAllText("$temp\alertas\processo\pipeline.py","import json,os,pathlib,sys`npathlib.Path('../privado/operacao/pipeline-args.json').write_text(json.dumps({'args':sys.argv[1:],'ensaio':os.environ.get('MODO_ENSAIO'),'path':os.environ.get('PATH'),'cache':str(pathlib.Path(os.environ['XDG_CONFIG_HOME']).resolve()) if os.environ.get('XDG_CONFIG_HOME') else None,'cache_xdg':str(pathlib.Path(os.environ['XDG_CACHE_HOME']).resolve()) if os.environ.get('XDG_CACHE_HOME') else None,'cache_wrangler':str(pathlib.Path(os.environ['WRANGLER_CACHE_DIR']).resolve()) if os.environ.get('WRANGLER_CACHE_DIR') else None,'log_wrangler':str(pathlib.Path(os.environ['WRANGLER_LOG_PATH']).resolve()) if os.environ.get('WRANGLER_LOG_PATH') else None,'temp':str(pathlib.Path(os.environ['TEMP']).resolve())}))`nprint('pipeline ficticio concluido')")
 [IO.File]::WriteAllText("$temp\alertas\processo\verificar_saude.py", "import pathlib,time`npathlib.Path('../privado/operacao/saude-iniciada').write_text('ficticio')`ntime.sleep(600)")
 Remove-Item -LiteralPath "$temp\alertas\.venv\Scripts\python.exe" -Force
 & python.exe -m venv --without-pip "$temp\alertas\.venv"
 if($LASTEXITCODE-ne0){throw 'Nao foi possivel criar Python real para validacao do supervisor.'}
 [IO.File]::WriteAllText("$temp\portal\scripts\processar-relatorios.mjs", "import fs from 'node:fs';setInterval(()=>{if(fs.existsSync('../privado/operacao/parar.sinal'))process.exit(0)},500);")
 # Processo longo o bastante para o teste observar os modulos ativos, mas que
 # tambem respeita o sinal de parada. Assim uma maquina sem permissao para
 # taskkill /T nao deixa um cmd orfao prendendo a pasta temporaria.
 $npmFalso="@echo off`r`n:aguardar`r`nif exist `"..\privado\operacao\parar.sinal`" exit /b 0`r`nping 127.0.0.1 -n 2 >nul`r`ngoto aguardar`r`n"
 [IO.File]::WriteAllText("$temp\bin\npm.cmd",$npmFalso,[Text.Encoding]::ASCII)
 [IO.File]::WriteAllText("$temp\privado\comum\smtp.env","SMTP_HOST=x`r`nSMTP_PORT=1`r`nSMTP_USER=x`r`nSMTP_PASSWORD=x`r`nEMAIL_FROM_NAME=x")
 [IO.File]::WriteAllText("$temp\privado\portal\configuracao\portal.env","PORTAL_URL=x`r`nPORTAL_API_TOKEN=x`r`nBACKUP_EMAIL_TO=x")
 [IO.File]::WriteAllText("$temp\privado\alertas\config\cfg_ambiente.txt","QLIK_TENANT=x`r`nQLIK_APP_ID=x`r`nQLIK_OBJ_ID=x`r`nDESTINATARIO_ALERTA=x")
 [IO.File]::WriteAllText("$temp\privado\comum\operacao.env","ALERTAS_HORARIOS=00:00`r`nBACKUP_HORARIOS=00:00`r`nLIMPEZA_HORARIO=00:00`r`nESPACO_MINIMO_GB=1`r`nMODO_ENSAIO=$(if($Ensaio){'1'}else{'0'})")
 [IO.File]::WriteAllText("$temp\privado\portal\configuracao\worker.env",'segredo-ficticio')
 if($AvisoAdminTeste){Add-Content "$temp\privado\comum\operacao.env" "`r`nADMIN_ALERTA_EMAIL=admin@example.com"}
 $filho="import fs from 'node:fs';fs.appendFileSync('../privado/operacao/avisos-iniciados',process.argv[2]+'\n');"
 if($AvisoAdminTeste-eq'falha'){$filho+="process.exitCode=1;"}else{$filho+="setTimeout(()=>process.exit(0),120000);"}
 [IO.File]::WriteAllText("$temp\portal\scripts\aviso-admin.mjs",$filho)

 $data=Get-Date -Format yyyy-MM-dd;@{"backup-$data-00:00"='ok';"limpeza-$data-00:00"='ok'}|ConvertTo-Json|Set-Content "$temp\privado\operacao\estado.json"
 # Simula ambiente antigo: operacao.env deve prevalecer.
 $env:ADMIN_ALERTA_EMAIL='herdado@example.com'
 $env:MODO_ENSAIO=if($Ensaio){'0'}else{'1'}
 $env:SUPPLY_VISION_PRIVADO=Join-Path $temp 'privado'
 $env:Path="$temp\bin;$pathAnterior";$args=@('-NoProfile','-ExecutionPolicy','Bypass','-File',"$temp\scripts\supervisor.ps1")
 if($SemLogin){
  Copy-Item (Get-Command node.exe).Source "$temp\bin\node.exe"
  $args+=@('-SemLogin','-NodeExecutavel',"$temp\bin\node.exe")
 }
 $a=Start-Process powershell.exe -ArgumentList $args -PassThru -WindowStyle Hidden;$b=Start-Process powershell.exe -ArgumentList $args -PassThru -WindowStyle Hidden;$processos=@($a,$b)
 Start-Sleep 4;$vivos=@($processos|Where-Object{!$_.HasExited});if($vivos.Count-ne1){throw "Lock falhou: $($vivos.Count) instancias ativas."}
 # Espera ativa pelo status.json. Espera fixa era corrida: a verificacao de
 # saude contra um host inexistente sozinha ja consome quase 3 segundos.
 $statusPath="$temp\privado\operacao\status.json";$apareceu=$false
 for($i=0;$i -lt 60;$i++){if(Test-Path $statusPath){$apareceu=$true;break};Start-Sleep -Milliseconds 500}
 if(!$apareceu){throw 'Supervisor nao gravou status.json dentro do prazo.'}
 $status=Get-Content $statusPath -Raw|ConvertFrom-Json;if(!$status.portal-or!$status.emails-or!$status.relatorios){throw 'Supervisor nao iniciou os processos simulados.'}
 $saudeIniciada=$false
 for($i=0;$i-lt60;$i++){if(Test-Path "$temp\privado\operacao\saude-iniciada"){$saudeIniciada=$true;break};Start-Sleep -Milliseconds 500}
 if(!$saudeIniciada){throw 'Verificacao ficticia de saude nao iniciou.'}
 $pipeline=Get-Content "$temp\privado\operacao\pipeline-args.json" -Raw|ConvertFrom-Json
 $esperados=@('--slot','00:00');if($Ensaio){$esperados+='--sem-envio'}
 if(($pipeline.args-join '|')-ne($esperados-join '|')){throw 'Argumentos do pipeline divergiram do modo configurado.'}
 if($pipeline.ensaio-ne$(if($Ensaio){'1'}else{'0'})){throw 'Modo ensaio nao foi propagado ao processo Python.'}
 if($SemLogin){
  # Python resolve nomes curtos (8.3); compara destinos reais, nao a grafia do caminho.
  $pythonTeste=Join-Path $temp 'alertas\.venv\Scripts\python.exe'
  $cacheEsperado=(& $pythonTeste -c 'import pathlib,sys;print(pathlib.Path(sys.argv[1]).resolve())' (Join-Path $temp 'privado\operacao\cache')|Out-String).Trim()
  if($pipeline.cache-ne$cacheEsperado-or$pipeline.temp-ne$cacheEsperado){throw "Cache/TEMP divergentes: cache=$($pipeline.cache); TEMP=$($pipeline.temp); esperado=$cacheEsperado."}
  if($pipeline.cache_xdg-ne$cacheEsperado-or$pipeline.cache_wrangler-ne(Join-Path $cacheEsperado 'wrangler')-or$pipeline.log_wrangler-ne(Join-Path $cacheEsperado 'wrangler.log')){throw 'Wrangler dependeu de cache do perfil.'}
  $pathEsperado="$temp\bin;"+[Environment]::GetEnvironmentVariable('Path','Machine')
  if($pipeline.path-ne$pathEsperado){throw "PATH divergente: atual=$($pipeline.path); esperado=$pathEsperado."}
 }
 if($status.ensaio-ne[bool]$Ensaio){throw 'status.json nao reflete o modo ensaio.'}
 $logInicio=Get-Content "$temp\privado\operacao\supervisor.log" -Raw
 if(($logInicio.Contains('Modo ensaio ATIVO'))-ne[bool]$Ensaio){throw 'Log de inicio nao reflete o modo ensaio.'}
 if(!$AvisoAdminTeste-and((Test-Path "$temp\privado\operacao\avisos-admin.sqlite")-or(Test-Path "$temp\privado\operacao\avisos-iniciados"))){throw 'Supervisor tentou envio com ADMIN_ALERTA_EMAIL ausente.'}
 if($AvisoAdminTeste){
  $marcador="$temp\privado\operacao\avisos-iniciados"
  if($Ensaio){
   if(Test-Path $marcador){throw 'Ensaio iniciou envio ao administrador.'}
   if(!$logInicio.Contains('ensaio: aviso ao administrador suprimido — Supervisor iniciado')){throw 'Supervisor nao registrou supressao.'}
  }else{
   if(!(Test-Path $marcador)){throw 'Supervisor nao iniciou aviso ficticio.'}
   if(@(Get-Content $marcador|Where-Object{$_-eq'supervisor-iniciado'}).Count-ne1){throw 'Mais de um aviso por inicializacao.'}
   $primeiro=$status.atualizado;$progrediu=$false;$concluiu=$false
   for($i=0;$i-lt150;$i++){
    Start-Sleep -Milliseconds 500
    try{$progrediu=$progrediu-or((Get-Content $statusPath -Raw|ConvertFrom-Json).atualizado-ne$primeiro)}catch{}
    $logAtual=Get-Content "$temp\privado\operacao\supervisor.log" -Raw
    $concluiu=if($AvisoAdminTeste-eq'falha'){$logAtual.Contains('Falha no aviso ao administrador')}else{$logAtual.Contains('excedeu 60 s')}
    if($concluiu-and$progrediu){break}
   }
   if(!$progrediu-or!$concluiu-or$vivos[0].HasExited){throw 'Falha/timeout do envio bloqueou ou encerrou o supervisor.'}
  }
 }

 # status.json preso por outro processo (central, antivirus) durante mais de
 # uma volta: o supervisor registra aviso e segue; antes, encerrava tudo.
 $antes=$status.atualizado
 $trava=[IO.File]::Open($statusPath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)
 try{Start-Sleep 20}finally{$trava.Dispose()}
 if($vivos[0].HasExited){throw 'Supervisor encerrou com status.json em uso.'}
 $logSupervisor=Get-Content "$temp\privado\operacao\supervisor.log" -Raw
 if($logSupervisor -match 'ERRO FATAL|Encerrando a operacao'){throw "Supervisor tratou arquivo em uso como fatal: $logSupervisor"}
 $atualizou=$false
 for($i=0;$i -lt 40;$i++){try{if((Get-Content $statusPath -Raw|ConvertFrom-Json).atualizado-ne$antes){$atualizou=$true;break}}catch{};Start-Sleep -Milliseconds 500}
 if(!$atualizou){throw 'Supervisor nao voltou a atualizar status.json apos a liberacao.'}
 New-Item -ItemType File -Force "$temp\privado\operacao\parar.sinal"|Out-Null;$vivos[0].WaitForExit(25000)|Out-Null;if(!$vivos[0].HasExited){throw 'Supervisor nao encerrou.'}
 $statusFinal=Get-Content $statusPath -Raw|ConvertFrom-Json;if($statusFinal.ensaio-ne[bool]$Ensaio){throw 'Status de encerramento perdeu o modo ensaio.'}
 if(Test-Path -LiteralPath "$temp\privado\portal\configuracao\worker.env"){throw 'Supervisor deixou worker.env depois de encerrar.'}
 Write-Host 'Supervisor isolado: concorrencia, estado, arquivo em uso e encerramento aprovados.' -ForegroundColor Green
}catch{Write-Host ('FALHA DO CENARIO: '+$_.Exception.Message);throw}finally{$env:Path=$pathAnterior;$env:SUPPLY_VISION_PRIVADO=$privadoAnterior;$env:MODO_ENSAIO=$ensaioAnterior;$env:ADMIN_ALERTA_EMAIL=$adminAnterior;foreach($p in $processos){if($p-and!$p.HasExited){try{& taskkill.exe /PID $p.Id /T /F 2>$null|Out-Null}catch{}}};if(Test-Path $temp){Remover-DiretorioTemporario $temp}}
