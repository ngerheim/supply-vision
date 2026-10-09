# Envio isolado em processos Node: nenhuma espera SMTP na volta principal.
function Novo-ControleAvisosAdmin([hashtable]$Config, [bool]$Ensaio, [string]$Node, [string]$Portal) {
  $email = [string]$Config['ADMIN_ALERTA_EMAIL']
  $habilitado = @($email.Split(',') | Where-Object { $_.Trim() }).Count -gt 0
  return @{ Habilitado=$habilitado; Email=$email; Ensaio=$Ensaio; Node=$Node; Portal=$Portal; Pendentes=@{} }
}

function Nome-EventoAdmin([string]$Evento) {
  $nomes = @{
    'tarefa-falhou'='Tarefa principal falhou ao iniciar'
 'vigilancia-health'='Vigilância: Portal indisponível'
 'portal-parou'='Portal parou de responder'
    'portal-reiniciado'='Portal reiniciado automaticamente'
    'backup-falhou'='Backup falhou'
    'alertas-falharam'='Alertas falharam'
    'alertas-revisao'='Alertas exigem revisão de entrega'
    'disco-baixo'='Espaço em disco baixo'
    'supervisor-iniciado'='Supervisor iniciado'
  }
  if (!$nomes.ContainsKey($Evento)) { throw 'Evento de administrador desconhecido.' }
  return $nomes[$Evento]
}

function Avisar-Administrador([hashtable]$Controle, [string]$Evento) {
  if (!$Controle.Habilitado) { return }
  try {
    $nome = Nome-EventoAdmin $Evento
    if ($Controle.Ensaio) { Log "ensaio: aviso ao administrador suprimido — $nome"; return }
    # Um processo por tipo; o Node controla a janela persistente de 60 minutos.
    if ($Controle.Pendentes.ContainsKey($Evento)) { return }
    $anterior = $env:ADMIN_ALERTA_EMAIL
    try {
      $env:ADMIN_ALERTA_EMAIL = $Controle.Email
      $processo = Start-Process $Controle.Node -ArgumentList @('scripts\aviso-admin.mjs', $Evento) -WorkingDirectory $Controle.Portal -WindowStyle Hidden -PassThru
    } finally { $env:ADMIN_ALERTA_EMAIL = $anterior }
    $Controle.Pendentes[$Evento] = @{ Processo=$processo; Cronometro=[Diagnostics.Stopwatch]::StartNew(); Timeout=$false }
  } catch { Log "Falha ao iniciar aviso ao administrador — $Evento. A operação continua." }
}

function Atualizar-AvisosAdmin([hashtable]$Controle) {
  foreach ($evento in @($Controle.Pendentes.Keys)) {
    try {
      $item = $Controle.Pendentes[$evento]; $p = $item.Processo
      $p.Refresh()
      if ($p.HasExited) {
        if (!$item.Timeout) {
          if ($p.ExitCode -eq 0) { Log "Aviso ao administrador enviado — $(Nome-EventoAdmin $evento)." }
          elseif ($p.ExitCode -eq 2) { Log "Aviso ao administrador limitado a 1 por 60 minutos — $(Nome-EventoAdmin $evento)." }
          else { Log "Falha no aviso ao administrador — $(Nome-EventoAdmin $evento). A operação continua." }
        }
        $p.Dispose(); $Controle.Pendentes.Remove($evento)
      } elseif ($item.Cronometro.Elapsed.TotalSeconds -ge 60) {
        if (!$item.Timeout) { Log "Aviso ao administrador excedeu 60 s — $(Nome-EventoAdmin $evento). Encerrando envio; a operação continua."; $item.Timeout=$true }
        # Kill nao espera SMTP, nao usa WaitForExit e nao bloqueia a volta.
        $p.Kill()
      }
    } catch { Log "Falha ao acompanhar aviso ao administrador — $evento. A operação continua." }
  }
}

function Encerrar-AvisosAdmin([hashtable]$Controle) {
  foreach ($item in $Controle.Pendentes.Values) {
    try { if (!$item.Processo.HasExited) { $item.Processo.Kill() }; $item.Processo.Dispose() } catch { Log 'Falha ao encerrar aviso ao administrador. Confira os processos antes de reiniciar.' }
  }
  $Controle.Pendentes.Clear()
}
