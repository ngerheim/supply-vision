$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
function Igual($Esperado,$Atual,[string]$Caso){if($Esperado-ne$Atual){throw "${Caso}: esperado '$Esperado', obtido '$Atual'"}}
$cfg=@{ALERTAS_HORARIOS='08:00,11:00,14:00,17:00';BACKUP_HORARIOS='12:30,17:45';LIMPEZA_HORARIO='05:30'}
Validar-Horarios $cfg
try{Validar-Horarios @{ALERTAS_HORARIOS='08:0012:00';BACKUP_HORARIOS='12:30';LIMPEZA_HORARIO='05:30'};throw 'Horario colado foi aceito'}catch{if($_.Exception.Message-eq'Horario colado foi aceito'){throw}}
$estado=@{};$slot=Obter-SlotDevido 'alertas' $cfg.ALERTAS_HORARIOS $estado ([datetime]'2026-09-11 11:50');Igual '11:00' $slot.hora 'retorno antes das 14h'
$estado=@{};$slot=Obter-SlotDevido 'alertas' $cfg.ALERTAS_HORARIOS $estado ([datetime]'2026-09-11 18:30');Igual '17:00' $slot.hora 'retorno apos quatro slots';Igual 3 (($estado.Keys|Where-Object{$_-like'alertas-*'}).Count) 'slots antigos marcados';$estado[$slot.chave]='ok';Igual $null (Obter-SlotDevido 'alertas' $cfg.ALERTAS_HORARIOS $estado ([datetime]'2026-09-11 18:31')) 'reinicio sem duplicidade'
$estado=@{'alertas-2026-09-11-08:00'='ok';'alertas-2026-09-11-11:00'='ok';'alertas-2026-09-11-14:00'='ok';'alertas-2026-09-11-17:00'='em-andamento'};Igual $null (Obter-SlotDevido 'alertas' $cfg.ALERTAS_HORARIOS $estado ([datetime]'2026-09-11 23:59')) 'execucao longa';$slot=Obter-SlotDevido 'alertas' $cfg.ALERTAS_HORARIOS $estado ([datetime]'2026-09-12 08:01');Igual '08:00' $slot.hora 'novo dia'
# --- Agenda por dia da semana -------------------------------------------
# Set 2026: 14=segunda, 17=quinta, 18=sexta, 19=sabado, 20=domingo.
$sem=@{ALERTAS_HORARIOS='08:00,11:00,14:00,17:00';ALERTAS_HORARIOS_SEX='08:00,11:00,14:00';ALERTAS_HORARIOS_SAB='';ALERTAS_HORARIOS_DOM='';BACKUP_HORARIOS='12:30,17:45';LIMPEZA_HORARIO='05:30'}
Validar-Horarios $sem
Igual '08:00,11:00,14:00,17:00' (Obter-HorariosDoDia $sem 'ALERTAS_HORARIOS' ([datetime]'2026-09-14 09:00')) 'segunda usa o padrao'
Igual '08:00,11:00,14:00,17:00' (Obter-HorariosDoDia $sem 'ALERTAS_HORARIOS' ([datetime]'2026-09-17 09:00')) 'quinta usa o padrao'
Igual '08:00,11:00,14:00' (Obter-HorariosDoDia $sem 'ALERTAS_HORARIOS' ([datetime]'2026-09-18 09:00')) 'sexta tem agenda propria'
Igual '' (Obter-HorariosDoDia $sem 'ALERTAS_HORARIOS' ([datetime]'2026-09-19 09:00')) 'sabado sem agenda'
Igual '' (Obter-HorariosDoDia $sem 'ALERTAS_HORARIOS' ([datetime]'2026-09-20 09:00')) 'domingo sem agenda'
Igual '12:30,17:45' (Obter-HorariosDoDia $sem 'BACKUP_HORARIOS' ([datetime]'2026-09-19 09:00')) 'backup segue no sabado'

# Nenhum alerta dispara no fim de semana, a qualquer hora.
foreach($dia in @('2026-09-19','2026-09-20')){
  foreach($hora in @('07:59','08:00','11:00','14:00','17:00','23:59')){
    $estado=@{};$lista=Obter-HorariosDoDia $sem 'ALERTAS_HORARIOS' ([datetime]"$dia $hora")
    Igual $null (Obter-SlotDevido 'alertas' $lista $estado ([datetime]"$dia $hora")) "sem alerta em $dia $hora"
    Igual 0 $estado.Count "fim de semana nao marca estado ($dia $hora)"
  }
}

# Sexta as 14:30 ja cumpriu o ultimo slot; as 17:00 nada mais e devido.
$estado=@{};$slot=Obter-SlotDevido 'alertas' (Obter-HorariosDoDia $sem 'ALERTAS_HORARIOS' ([datetime]'2026-09-18 14:30')) $estado ([datetime]'2026-09-18 14:30')
Igual '14:00' $slot.hora 'sexta encerra as 14:00';$estado[$slot.chave]='ok'
Igual $null (Obter-SlotDevido 'alertas' (Obter-HorariosDoDia $sem 'ALERTAS_HORARIOS' ([datetime]'2026-09-18 17:05')) $estado ([datetime]'2026-09-18 17:05')) 'sexta nao dispara as 17:00'

# Segunda as 08:01 volta normalmente, mesmo apos o fim de semana parado.
$estado=@{}
$slot=Obter-SlotDevido 'alertas' (Obter-HorariosDoDia $sem 'ALERTAS_HORARIOS' ([datetime]'2026-09-21 08:01')) $estado ([datetime]'2026-09-21 08:01')
Igual '08:00' $slot.hora 'segunda retoma apos o fim de semana'

# Chave de dia com horario invalido precisa ser recusada.
try{Validar-Horarios @{ALERTAS_HORARIOS='08:00';ALERTAS_HORARIOS_SEX='14:0';BACKUP_HORARIOS='12:30';LIMPEZA_HORARIO='05:30'};throw 'Horario de dia invalido foi aceito'}catch{if($_.Exception.Message-eq'Horario de dia invalido foi aceito'){throw}}

# A atualizacao do servidor preserva privado/: a agenda padrao anterior e
# migrada no proximo inicio, sem mexer em configuracoes personalizadas.
$temp=Join-Path ([IO.Path]::GetTempPath()) ('sv-agenda-'+[guid]::NewGuid().ToString('N')+'.env')
try {
  @('ALERTAS_HORARIOS=08:00,12:00,17:00','ALERTAS_HORARIOS_SEX=08:00,12:00,16:00','BACKUP_HORARIOS=12:30') | Set-Content -LiteralPath $temp
  Igual $true (Atualizar-AgendaAlertasLegada $temp) 'agenda antiga foi migrada'
  $migrada=Ler-ConfigOperacao $temp
  Igual '08:00,11:00,14:00,17:00' $migrada.ALERTAS_HORARIOS 'agenda semanal migrada'
  Igual '08:00,11:00,14:00' $migrada.ALERTAS_HORARIOS_SEX 'sexta migrada'

  @('ALERTAS_HORARIOS=09:15','ALERTAS_HORARIOS_SEX=13:45') | Set-Content -LiteralPath $temp
  Igual $false (Atualizar-AgendaAlertasLegada $temp) 'agenda personalizada preservada'
  $personalizada=Ler-ConfigOperacao $temp
  Igual '09:15' $personalizada.ALERTAS_HORARIOS 'padrao personalizado intacto'
  Igual '13:45' $personalizada.ALERTAS_HORARIOS_SEX 'sexta personalizada intacta'
} finally { Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue }

Write-Host 'Logica operacional: 6 cenarios base + agenda semanal aprovados.' -ForegroundColor Green
