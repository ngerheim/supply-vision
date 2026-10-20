# Confirma que um slot concluido permanece registrado durante verificacoes
# posteriores. O teste interrompe o supervisor nessa janela e exige que o
# estado ja contenha o horario concluido.
param([string]$AgoraSimulado='2026-10-13T14:00:01Z',[ValidatePattern('^\d{2}:\d{2}$')][string]$Slot='14:00')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'espera-testes.ps1')
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
$agoraFixo=[datetimeoffset]::Parse($AgoraSimulado,[Globalization.CultureInfo]::InvariantCulture).UtcDateTime
$alvo=[datetime]::ParseExact(($agoraFixo.ToString('yyyy-MM-dd')+' '+$Slot),'yyyy-MM-dd HH:mm',[Globalization.CultureInfo]::InvariantCulture)
if($agoraFixo-lt$alvo){throw 'O slot de teste deve estar devido no relogio simulado.'}
$raizReal = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$temp = Join-Path $env:TEMP ('supply-vision-persistencia-' + [guid]::NewGuid().ToString('N'))
$proc = $null
$pathAnterior = $env:Path
$privadoAnterior = $env:SUPPLY_VISION_PRIVADO
$fasePersistencia='preparar fixture'
function Mostrar-FalhaPersistencia($Falha,[string]$Fase) {
 Write-Host "FALHA persistencia: slot=$Slot; agora=$AgoraSimulado; fase=$Fase; motivo=$($Falha.Exception.Message)"
 if($Falha.InvocationInfo){Write-Host $Falha.InvocationInfo.PositionMessage}
 foreach($rel in @('privado/operacao/supervisor.log','supervisor-saida.log','supervisor-erro.log')){
  $arquivo=Join-Path $temp $rel
  try{if(Test-Path -LiteralPath $arquivo){Write-Host "Diagnostico ${rel}:";Get-Content -LiteralPath $arquivo -Tail 30 -Encoding UTF8 -ErrorAction Stop|Write-Host}}catch{Write-Host "Diagnostico indisponivel: $($_.Exception.Message)"}
 }
}
function Encerrar-ArvoreTeste($Processo) {
  if (!$Processo -or $Processo.HasExited) { return }
  # taskkill /T pode exigir elevacao em algumas instalacoes do Windows. Para o
  # teste, levantamos a arvore antes de matar o pai e encerramos apenas os
  # processos que ele proprio criou.
  $todos = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
  $ids = @([int]$Processo.Id)
  do {
    $novos = @($todos | Where-Object { $ids -contains [int]$_.ParentProcessId -and $ids -notcontains [int]$_.ProcessId } | ForEach-Object { [int]$_.ProcessId })
    if ($novos) { $ids += $novos }
  } while ($novos)
  [array]::Reverse($ids)
  foreach ($idProcesso in $ids) { Stop-Process -Id $idProcesso -Force -ErrorAction SilentlyContinue }
  $Processo.WaitForExit(15000) | Out-Null
}
try {
 $portasFixture=Reservar-PortasFixtureTeste
 Preparar-InstalacaoSupervisorTeste $raizReal $temp


  # Injecao SOMENTE na copia descartavel: nenhum relogio de producao e alterado.
  $arquivoSupervisor=Join-Path $temp 'scripts/supervisor.ps1'
  $fonte=[IO.File]::ReadAllText($arquivoSupervisor)
  $ponto='$config=Ler-ConfigOperacao $ConfigOperacao'
  if(!$fonte.Contains($ponto)-or!$fonte.Contains('function Salvar-Estado{')){throw 'Ponto de injecao do teste nao encontrado.'}
  $relogio=@"
function Get-Date {
 param([string]`$Format)
 `$agora=[datetimeoffset]::Parse('$AgoraSimulado',[Globalization.CultureInfo]::InvariantCulture).UtcDateTime
 if(`$Format){return `$agora.ToString(`$Format,[Globalization.CultureInfo]::InvariantCulture)}
 return `$agora
}
"@
  $fonte=$fonte.Replace($ponto,($ponto+"`n"+$relogio))
  # Amplia a janela entre log e disco: o criterio antigo falharia sempre aqui.
  $fonte=$fonte.Replace('function Salvar-Estado{',"function Salvar-Estado{`n Start-Sleep -Milliseconds 1200")
  [IO.File]::WriteAllText($arquivoSupervisor,$fonte,(New-Object Text.UTF8Encoding($true)))


  $fasePersistencia='preparar Python e configuracao ficticia'
  # Python real, via juncao para o .venv do projeto (nao copia os 142 MB).
  & cmd.exe /c mklink /J "$temp\alertas\.venv" "$raizReal\alertas\.venv" | Out-Null
  if ($LASTEXITCODE) { throw "mklink da fixture falhou: codigo=$LASTEXITCODE; slot=$Slot" }
  if (-not (Test-Path "$temp\alertas\.venv\Scripts\python.exe")) { throw 'Nao foi possivel preparar o Python de teste.' }

 [IO.File]::WriteAllText("$temp\portal\scripts\processar-relatorios.mjs", "import fs from 'node:fs';setInterval(()=>{if(fs.existsSync('../privado/operacao/parar.sinal'))process.exit(0)},500);")
  # pipeline falso: termina imediatamente com sucesso.
  [IO.File]::WriteAllText("$temp\alertas\processo\pipeline.py", "import sys`nsys.exit(0)`n")
  # verificar_saude falso: segura a execucao, abrindo a janela do incidente.
  $data=$agoraFixo.ToString('yyyy-MM-dd')
  $chaveAlertas="alertas-$data-$Slot"
  $marcadorSaude=Join-Path $temp 'privado/operacao/saude-iniciada.json'
  $saudeTeste=@"
import json, pathlib, time
pasta = pathlib.Path(__file__).resolve().parents[2] / 'privado' / 'operacao'
estado = json.loads((pasta / 'estado.json').read_text(encoding='utf-8-sig'))
marcador = pasta / 'saude-iniciada.json'
temporario = pasta / 'saude-iniciada.tmp'
temporario.write_text(json.dumps({'chave': '$chaveAlertas', 'persistido': bool(estado.get('$chaveAlertas'))}), encoding='utf-8')
temporario.replace(marcador)
time.sleep(30)
"@
  [IO.File]::WriteAllText("$temp\alertas\processo\verificar_saude.py", $saudeTeste)


  $conteudos = @{
    'portal\dist\server\index.js'                 = '{}'
    'privado\alertas\config\cfg_qlik.txt'              = 'token'
    'privado\alertas\config\destinatarios.txt'         = 'destino'
    'acordos.xlsx'                                     = 'teste'
  }
  foreach ($item in $conteudos.GetEnumerator()) { [IO.File]::WriteAllText((Join-Path $temp $item.Key), $item.Value) }
  [IO.File]::WriteAllText("$temp\bin\npm.cmd", "@echo off`r`nping 127.0.0.1 -n 120 >nul`r`n", [Text.Encoding]::ASCII)
  [IO.File]::WriteAllText("$temp\privado\comum\smtp.env", "SMTP_HOST=x`r`nSMTP_PORT=1`r`nSMTP_USER=x`r`nSMTP_PASSWORD=x`r`nEMAIL_FROM_NAME=x")
  [IO.File]::WriteAllText("$temp\privado\portal\configuracao\portal.env", "PORTAL_URL=http://127.0.0.1:$($portasFixture[0])`r`nPORTAL_PORTA=$($portasFixture[0])`r`nRELATORIOS_PORTA=$($portasFixture[1])`r`nPORTAL_API_TOKEN=x`r`nBACKUP_EMAIL_TO=x")
  [IO.File]::WriteAllText("$temp\privado\alertas\config\cfg_ambiente.txt", "QLIK_TENANT=x`r`nQLIK_APP_ID=x`r`nQLIK_OBJ_ID=x`r`nDESTINATARIO_ALERTA=x")
  [IO.File]::WriteAllText("$temp\privado\comum\operacao.env", "MODO_ENSAIO=1`r`nALERTAS_HORARIOS=$Slot`r`nBACKUP_HORARIOS=23:59`r`nLIMPEZA_HORARIO=23:59`r`nESPACO_MINIMO_GB=1")

  # Estado inicial: backup e limpeza ja feitos; o slot de ALERTAS fica pendente.
  @{ "backup-$data-23:59" = 'ok'; "limpeza-$data-23:59" = 'ok' } | ConvertTo-Json | Set-Content "$temp\privado\operacao\estado.json"

  $env:SUPPLY_VISION_PRIVADO = Join-Path $temp 'privado'
  $env:Path = "$temp\bin;$pathAnterior"
  $fasePersistencia='iniciar supervisor'
  Write-Host "Persistencia: inicio; slot=$Slot; agora=$AgoraSimulado; fixture=$temp"
  $proc = Start-Process powershell.exe -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $temp 'supervisor-saida.log') -RedirectStandardError (Join-Path $temp 'supervisor-erro.log') -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "$temp\scripts\supervisor.ps1");[void]$proc.Handle

  # O log de conclusao antecede o flush. Sincroniza com a entrada REAL da
  # saude, que registra o estado visto antes de qualquer trabalho demorado.
  $fasePersistencia='aguardar saude e persistencia'
  $prazo=[Diagnostics.Stopwatch]::StartNew()
  while(!(Test-Path -LiteralPath $marcadorSaude)-and$prazo.Elapsed.TotalSeconds-lt60){
    if($proc.HasExited){throw 'Supervisor encerrou antes da verificacao simulada.'}
    Start-Sleep -Milliseconds 100
  }
  if(!(Test-Path -LiteralPath $marcadorSaude)){
    Get-Content "$temp\privado\operacao\supervisor.log" -ErrorAction SilentlyContinue|Write-Host
    throw 'Supervisor nao iniciou a verificacao de saude no prazo.'
  }
  $observado=Get-Content -LiteralPath $marcadorSaude -Raw|ConvertFrom-Json
  if($observado.chave-ne$chaveAlertas-or!$observado.persistido){throw "REGRESSAO: saude iniciou sem persistencia de '$chaveAlertas'."}
  # Agora a saude esta no sleep 30. Interrompe sem finally, como o incidente.
  $fasePersistencia='interromper arvore do supervisor'
  Encerrar-ArvoreTeste $proc

  $fasePersistencia='conferir estado em disco e slot devido'
  # O marcador precisa ja estar em disco.
  $estado = Get-Content "$temp\privado\operacao\estado.json" -Raw | ConvertFrom-Json
  if (-not $estado.$chaveAlertas) {
    throw "REGRESSAO: '$chaveAlertas' nao foi persistido antes da verificacao de saude; o slot seria reprocessado."
  }

  # E o slot nao pode mais ser considerado devido.
  . "$raizReal\scripts\operacao-logica.ps1"
  $mapa = @{}
  $estado.psobject.Properties | ForEach-Object { $mapa[$_.Name] = $_.Value }
  $devido = Obter-SlotDevido 'alertas' $Slot $mapa $agoraFixo
  if ($devido) { throw "REGRESSAO: o slot '$($devido.chave)' ainda consta pendente apos a conclusao." }

  Write-Host "Persistencia dos alertas: $AgoraSimulado / $Slot; marcador observado pela saude e preservado apos interrupcao." -ForegroundColor Green
} catch {
  Mostrar-FalhaPersistencia $_ $fasePersistencia
  throw
} finally {
  $env:Path = $pathAnterior
  $env:SUPPLY_VISION_PRIVADO = $privadoAnterior
  try{
    if ($proc -and !$proc.HasExited) { Encerrar-ArvoreTeste $proc }
    # rmdir remove so a juncao, sem percorrer o venv compartilhado. Codigo
    # nao zero precisa de motivo; nao pode vazar como falha muda do -File.
    if (Test-Path "$temp\alertas\.venv") {
      $limpeza=Executar-NativoOperacao 'cmd.exe' @('/d','/c','rmdir',('"'+"$temp\alertas\.venv"+'"'))
      if($limpeza.codigo-ne0){throw "rmdir da juncao falhou: codigo=$($limpeza.codigo); saida=$($limpeza.saida -join ' | ')"}
    }
    if (Test-Path $temp) { Remove-Item $temp -Recurse -Force -ErrorAction Stop }
  }catch{
    Mostrar-FalhaPersistencia $_ 'limpeza da fixture'
    throw
  }
}

# Todas as chamadas nativas relevantes foram conferidas acima.
# -File nao deve herdar LASTEXITCODE de um comando auxiliar da fixture.
exit 0
