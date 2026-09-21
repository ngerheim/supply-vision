# Confirma que um slot concluido permanece registrado durante verificacoes
# posteriores. O teste interrompe o supervisor nessa janela e exige que o
# estado ja contenha o horario concluido.
$ErrorActionPreference = 'Stop'
$raizReal = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$temp = Join-Path $env:TEMP ('supply-vision-persistencia-' + [guid]::NewGuid().ToString('N'))
$proc = $null
$pathAnterior = $env:Path
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
  $dirs = @('scripts', 'portal\dist\server', 'alertas\processo', 'privado\comum',
            'privado\portal\configuracao', 'privado\portal\logs', 'privado\alertas\config',
            'privado\alertas\logs', 'privado\alertas\relatorios\diarios',
            'privado\alertas\parametros\de_para', 'privado\operacao', 'bin')
  $dirs | ForEach-Object { New-Item -ItemType Directory -Force (Join-Path $temp $_) | Out-Null }
  Copy-Item "$raizReal\scripts\supervisor.ps1", "$raizReal\scripts\operacao-logica.ps1", "$raizReal\scripts\validar-operacao.ps1", "$raizReal\scripts\notificacao.ps1" "$temp\scripts"

  # Python real, via juncao para o .venv do projeto (nao copia os 142 MB).
  & cmd.exe /c mklink /J "$temp\alertas\.venv" "$raizReal\alertas\.venv" | Out-Null
  if (-not (Test-Path "$temp\alertas\.venv\Scripts\python.exe")) { throw 'Nao foi possivel preparar o Python de teste.' }

  # pipeline falso: termina imediatamente com sucesso.
  [IO.File]::WriteAllText("$temp\alertas\processo\pipeline.py", "import sys`nsys.exit(0)`n")
  # verificar_saude falso: segura a execucao, abrindo a janela do incidente.
  [IO.File]::WriteAllText("$temp\alertas\processo\verificar_saude.py", "import time`ntime.sleep(30)`n")

  $conteudos = @{
    'portal\dist\server\wrangler.json'                 = '{}'
    'privado\alertas\config\cfg_qlik.txt'              = 'token'
    'privado\alertas\config\destinatarios.txt'         = 'destino'
    'privado\alertas\parametros\de_para\itens.csv'     = 'origem,destino'
    'privado\alertas\parametros\de_para\modelos.csv'   = 'origem,destino'
    'acordos.xlsx'                                     = 'teste'
  }
  foreach ($item in $conteudos.GetEnumerator()) { [IO.File]::WriteAllText((Join-Path $temp $item.Key), $item.Value) }
  [IO.File]::WriteAllText("$temp\bin\npm.cmd", "@echo off`r`nping 127.0.0.1 -n 120 >nul`r`n", [Text.Encoding]::ASCII)
  [IO.File]::WriteAllText("$temp\privado\comum\smtp.env", "SMTP_HOST=x`r`nSMTP_PORT=1`r`nSMTP_USER=x`r`nSMTP_PASSWORD=x`r`nEMAIL_FROM_NAME=x")
  [IO.File]::WriteAllText("$temp\privado\portal\configuracao\portal.env", "PORTAL_URL=http://127.0.0.1:59999`r`nPORTAL_API_TOKEN=x`r`nBACKUP_EMAIL_TO=x")
  [IO.File]::WriteAllText("$temp\privado\alertas\config\cfg_ambiente.txt", "QLIK_TENANT=x`r`nQLIK_APP_ID=x`r`nQLIK_OBJ_ID=x`r`nDESTINATARIO_ALERTA=x")
  [IO.File]::WriteAllText("$temp\privado\comum\operacao.env", "ALERTAS_HORARIOS=00:00`r`nBACKUP_HORARIOS=23:59`r`nLIMPEZA_HORARIO=23:59`r`nESPACO_MINIMO_GB=1")

  # Estado inicial: backup e limpeza ja feitos; o slot de ALERTAS fica pendente.
  $data = Get-Date -Format yyyy-MM-dd
  $chaveAlertas = "alertas-$data-00:00"
  @{ "backup-$data-23:59" = 'ok'; "limpeza-$data-23:59" = 'ok' } | ConvertTo-Json | Set-Content "$temp\privado\operacao\estado.json"

  $env:Path = "$temp\bin;$pathAnterior"
  $proc = Start-Process powershell.exe -PassThru -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "$temp\scripts\supervisor.ps1")

  # Espera o supervisor registrar a conclusao dos alertas.
  $logPath = "$temp\privado\operacao\supervisor.log"
  $concluiu = $false
  for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Milliseconds 500
    if ((Test-Path $logPath) -and (Select-String -LiteralPath $logPath -Pattern 'Alertas concluidos' -Quiet)) { $concluiu = $true; break }
  }
  if (-not $concluiu) { throw 'O supervisor nao chegou a concluir os alertas simulados.' }

  # Neste ponto verificar_saude.py esta rodando (sleep 30). Mata a arvore a
  # forca, sem dar chance ao finally - exatamente como um desligamento.
  Encerrar-ArvoreTeste $proc

  # O marcador precisa ja estar em disco.
  $estado = Get-Content "$temp\privado\operacao\estado.json" -Raw | ConvertFrom-Json
  if (-not $estado.$chaveAlertas) {
    throw "REGRESSAO: '$chaveAlertas' nao foi persistido antes da verificacao de saude; o slot seria reprocessado."
  }

  # E o slot nao pode mais ser considerado devido.
  . "$raizReal\scripts\operacao-logica.ps1"
  $mapa = @{}
  $estado.psobject.Properties | ForEach-Object { $mapa[$_.Name] = $_.Value }
  $devido = Obter-SlotDevido 'alertas' '00:00' $mapa (Get-Date)
  if ($devido) { throw "REGRESSAO: o slot '$($devido.chave)' ainda consta pendente apos a conclusao." }

  Write-Host 'Persistencia dos alertas: marcador gravado antes da verificacao de saude.' -ForegroundColor Green
} finally {
  $env:Path = $pathAnterior
  if ($proc -and !$proc.HasExited) { Encerrar-ArvoreTeste $proc }
  if (Test-Path "$temp\alertas\.venv") { & cmd.exe /c rmdir "$temp\alertas\.venv" 2>$null | Out-Null }
  if (Test-Path $temp) { Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue }
}
