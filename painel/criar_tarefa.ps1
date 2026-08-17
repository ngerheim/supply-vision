# Cria a tarefa agendada do painel, que o operacao_painel.md documenta e que
# nunca existiu no Agendador. Sem ela o parquet fica parado (13/08 contra 17/08 de
# hoje) e o refresh das 06:30 no Servico le um arquivo congelado, terminando com
# sucesso e sem mudar nada no painel.
#
# LogonType Interactive = "Executar somente quando o usuario estiver conectado".
# Nao e preferencia: o gateway pessoal e aplicacao interativa e nao sobe sem
# sessao ativa, entao um refresh disparado sem sessao falharia depois.
#
# Nao ha -WorkingDirectory porque o atualizar_painel.ps1 se localiza sozinho
# (parametro $Raiz com default C:\Projetos\supply-vision-privado + Set-Location).

$ErrorActionPreference = 'Stop'
$nome = 'SupplyVision - Painel'
$script = 'C:\Projetos\supply-vision-privado\painel\atualizar_painel.ps1'

if (-not (Test-Path $script)) { throw "script nao encontrado: $script" }

$existente = Get-ScheduledTask -TaskName $nome -ErrorAction SilentlyContinue
if ($existente) {
    Write-Output "ja existe -- removendo para recriar"
    Unregister-ScheduledTask -TaskName $nome -Confirm:$false
}

$acao = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`""

# 06:00, antes do refresh das 06:30 no Servico. A extracao do Qlik levou ate
# ~400 s nas medicoes e o timeout do executar.py e 1000 s, entao 30 min de folga
# cobrem o pior caso com margem.
$gatilho = New-ScheduledTaskTrigger -Daily -At 06:00

$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive -RunLevel Limited

# StartWhenAvailable: se a maquina estiver suspensa as 06:00, roda ao acordar em
# vez de simplesmente perder o dia.
$config = New-ScheduledTaskSettingsSet -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $nome -Action $acao -Trigger $gatilho `
    -Principal $principal -Settings $config `
    -Description 'Gera o parquet do painel (executar.py) e roda o porteiro (conferir.py). O refresh no Power BI Service e agendado separadamente, as 06:30.' | Out-Null

Write-Output "criada."
$t = Get-ScheduledTask -TaskName $nome
$i = $t | Get-ScheduledTaskInfo
Write-Output ""
Write-Output "nome        : $($t.TaskName)"
Write-Output "estado      : $($t.State)"
Write-Output "logon       : $($t.Principal.LogonType)  (Interactive = so com usuario conectado)"
Write-Output "usuario     : $($t.Principal.UserId)"
Write-Output "acao        : $($t.Actions[0].Execute) $($t.Actions[0].Arguments)"
Write-Output "proxima     : $($i.NextRunTime)"
