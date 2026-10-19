$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
function Igual($Esperado,$Atual,[string]$Caso){if($Esperado-ne$Atual){throw "${Caso}: esperado '$Esperado', obtido '$Atual'"}}
$cfg=@{ALERTAS_HORARIOS='08:00,11:00,14:00,17:00';BACKUP_HORARIOS='12:30,17:45';LIMPEZA_HORARIO='05:30'}
Validar-Horarios $cfg

# PID sozinho nao identifica um processo no Windows: ele pode ser reutilizado.
# O instante gravado pelo supervisor precisa pertencer ao processo encontrado.
$pidTeste=Join-Path ([IO.Path]::GetTempPath()) ('sv-pid-'+[guid]::NewGuid().ToString('N')+'.json')
try{
  $atual=Get-Process -Id $PID
  @{pid=$PID;inicio=$atual.StartTime.ToUniversalTime().ToString('o')}|ConvertTo-Json -Compress|Set-Content -LiteralPath $pidTeste
  Igual $PID (Obter-ProcessoRegistrado $pidTeste).Id 'registro identifica o processo correto'
  @{pid=$PID;inicio=$atual.StartTime.ToUniversalTime().AddMinutes(-10).ToString('o')}|ConvertTo-Json -Compress|Set-Content -LiteralPath $pidTeste
  Igual $null (Obter-ProcessoRegistrado $pidTeste) 'PID reutilizado nao vira operacao ativa'
  Set-Content -LiteralPath $pidTeste -Value '{invalido'
  Igual $null (Obter-ProcessoRegistrado $pidTeste) 'registro corrompido nao vira operacao ativa'
}finally{Remove-Item -LiteralPath $pidTeste -Force -ErrorAction SilentlyContinue}
try{Validar-Horarios @{ALERTAS_HORARIOS='08:0012:00';BACKUP_HORARIOS='12:30';LIMPEZA_HORARIO='05:30'};throw 'Horario colado foi aceito'}catch{if($_.Exception.Message-eq'Horario colado foi aceito'){throw}}
foreach($momento in @('2026-09-11 11:50','2026-09-11 18:30','2026-10-05 14:10')) {
  $estado=@{};$agora=[datetime]$momento
  $slot=Obter-SlotDevido 'alertas' $cfg.ALERTAS_HORARIOS $estado $agora
  Igual '08:00' $slot.hora "manha recuperada em $momento"
  Igual '08:00' (Obter-SlotDevido 'alertas' $cfg.ALERTAS_HORARIOS $estado $agora).hora 'falha permite repetir manha'
  $estado[$slot.chave]='ok'
  $ultimo=if($agora.Hour -ge 17){'17:00'}elseif($agora.Hour -ge 14){'14:00'}else{'11:00'}
  $slot=Obter-SlotDevido 'alertas' $cfg.ALERTAS_HORARIOS $estado $agora
  Igual $ultimo $slot.hora 'ultimo slot depois da manha'
  $estado[$slot.chave]='ok'
  Igual $null (Obter-SlotDevido 'alertas' $cfg.ALERTAS_HORARIOS $estado $agora) 'reinicio sem duplicidade'
}
$estado=@{};Igual '09:15' (Obter-SlotDevido 'alertas' '09:15,13:45' $estado ([datetime]'2026-10-05 14:10')).hora 'agenda personalizada preserva manha'
$estado=@{};Igual '17:45' (Obter-SlotDevido 'backup' $cfg.BACKUP_HORARIOS $estado ([datetime]'2026-10-05 18:30')).hora 'backup recupera somente ultimo'
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
$estado=@{'alertas-2026-09-18-08:00'='ok'};$slot=Obter-SlotDevido 'alertas' (Obter-HorariosDoDia $sem 'ALERTAS_HORARIOS' ([datetime]'2026-09-18 14:30')) $estado ([datetime]'2026-09-18 14:30')
Igual '14:00' $slot.hora 'sexta encerra as 14:00';$estado[$slot.chave]='ok'
Igual $null (Obter-SlotDevido 'alertas' (Obter-HorariosDoDia $sem 'ALERTAS_HORARIOS' ([datetime]'2026-09-18 17:05')) $estado ([datetime]'2026-09-18 17:05')) 'sexta nao dispara as 17:00'

# Segunda as 08:01 volta normalmente, mesmo apos o fim de semana parado.
$estado=@{}
$slot=Obter-SlotDevido 'alertas' (Obter-HorariosDoDia $sem 'ALERTAS_HORARIOS' ([datetime]'2026-09-21 08:01')) $estado ([datetime]'2026-09-21 08:01')
Igual '08:00' $slot.hora 'segunda retoma apos o fim de semana'

# Chave de dia com horario invalido precisa ser recusada.
try{Validar-Horarios @{ALERTAS_HORARIOS='08:00';ALERTAS_HORARIOS_SEX='14:0';BACKUP_HORARIOS='12:30';LIMPEZA_HORARIO='05:30'};throw 'Horario de dia invalido foi aceito'}catch{if($_.Exception.Message-eq'Horario de dia invalido foi aceito'){throw}}

Write-Host 'Logica operacional: 6 cenarios base + agenda semanal aprovados.' -ForegroundColor Green

# Exercita a mesma resolução diária que o supervisor usa para backups.
$backupSemana=@{BACKUP_HORARIOS='18:00';BACKUP_HORARIOS_SEG='09:00';BACKUP_HORARIOS_DOM=''}
Igual '09:00' (Obter-SlotDoDia 'backup' $backupSemana 'BACKUP_HORARIOS' @{} ([datetime]'2026-10-05 10:00')).hora 'backup usa horario proprio de segunda'
Igual $null (Obter-SlotDoDia 'backup' $backupSemana 'BACKUP_HORARIOS' @{} ([datetime]'2026-10-04 23:00')) 'backup respeita domingo vazio'
Igual '18:00' (Obter-SlotDoDia 'backup' $backupSemana 'BACKUP_HORARIOS' @{} ([datetime]'2026-10-06 19:00')).hora 'backup usa padrao na terca'

$privadoAnterior=$env:SUPPLY_VISION_PRIVADO
try {
  $env:SUPPLY_VISION_PRIVADO=Join-Path $PSScriptRoot 'dados alternativos'
  Igual ([IO.Path]::GetFullPath($env:SUPPLY_VISION_PRIVADO)) (Obter-PastaPrivada 'C:\nao-usar') 'pasta privada alternativa'
  $env:SUPPLY_VISION_PRIVADO=''
  Igual (Join-Path $PSScriptRoot 'privado') (Obter-PastaPrivada $PSScriptRoot) 'pasta privada padrao'
} finally { $env:SUPPLY_VISION_PRIVADO=$privadoAnterior }
Write-Host '[OK] Agenda de backup e pasta privada alternativa.'

$raizBackup=Join-Path ([IO.Path]::GetTempPath()) ('sv-aviso-backup-'+[guid]::NewGuid().ToString('N'))
try {
  $cfgBackup=Join-Path $raizBackup 'portal\configuracao';New-Item -ItemType Directory -Path $cfgBackup -Force|Out-Null
  $arquivoBackup=Join-Path $cfgBackup 'portal.env'
  Set-Content -LiteralPath $arquivoBackup -Value 'BACKUP_NETWORK_DIR='
  Igual $true ((Obter-AvisoBackup $raizBackup) -like '*BACKUP_NETWORK_DIR ausente*') 'rede obrigatoria sem fallback diario'
  Set-Content -LiteralPath $arquivoBackup -Value "BACKUP_NETWORK_DIR=$(Join-Path $raizBackup 'rede-ausente')"
  Igual $true ((Obter-AvisoBackup $raizBackup) -like '*rede indisponivel*') 'aviso de rede fora'
  Set-Content -LiteralPath $arquivoBackup -Value "BACKUP_NETWORK_DIR=$raizBackup"
  Igual $true ((Obter-AvisoBackup $raizBackup) -like '*supv backup senha*') 'senha ausente mesmo com rede disponivel'
  New-Item -ItemType Directory -Path (Join-Path $raizBackup 'comum')|Out-Null
  # Obter-AvisoBackup consulta existencia, nao decifra DPAPI. Nenhuma senha real.
  Set-Content -LiteralPath (Join-Path $raizBackup 'comum/backup-senha.dpapi') -Value 'cifra-ficticia-nao-decifravel'
  Igual '' (Obter-AvisoBackup $raizBackup) 'rede e arquivo de senha presentes'
  Add-Content -LiteralPath $arquivoBackup -Value 'BACKUP_ANEXAR_BANCO=true'
  Igual '' (Obter-AvisoBackup $raizBackup) 'chave antiga de anexo ignorada'
} finally { Remove-Item -LiteralPath $raizBackup -Recurse -Force }

# Mesmas fixtures do Node e Python; somente diretorio descartavel.
$casos=Get-Content (Join-Path $PSScriptRoot '../testes/fixtures/configuracao-env.json') -Raw -Encoding UTF8|ConvertFrom-Json
$arquivo=Join-Path ([IO.Path]::GetTempPath()) ('sv-env-'+[guid]::NewGuid().ToString('N')+'.env')
try {
 foreach($caso in $casos){
  if($caso.ausente){Remove-Item -LiteralPath $arquivo -Force -ErrorAction SilentlyContinue}
  else{[IO.File]::WriteAllText($arquivo,$caso.texto,(New-Object Text.UTF8Encoding($false)))}
  $falhou=$false;$valores=$null
  try{$valores=Ler-ConfigOperacao $arquivo}catch{$falhou=$true}
  Igual ([bool]$caso.erro) $falhou $caso.nome
  if(!$falhou){
   Igual @($caso.valores.PSObject.Properties).Count $valores.Count 'quantidade de chaves'
   foreach($chave in $caso.valores.PSObject.Properties){Igual $chave.Value $valores[$chave.Name] $chave.Name}
  }
 }
 Write-Host 'Contrato env compartilhado: aprovado.'
}finally{Remove-Item -LiteralPath $arquivo -Force -ErrorAction SilentlyContinue}

Igual 3000 (Obter-PortaPortalLocal @{PORTAL_URL='https://portal.empresa.test'}) 'URL publica nao define porta local'
Igual 42345 (Obter-PortaPortalLocal @{PORTAL_PORTA='42345'}) 'porta de fixture configurada'
$portaRecusada=$false;try{Obter-PortaPortalLocal @{PORTAL_PORTA='0'}}catch{$portaRecusada=$true};Igual $true $portaRecusada 'porta invalida recusada'

# Exercita o leitor real do supervisor sem iniciar a operacao.
$errosSupervisor=$null
$astSupervisor=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'supervisor.ps1'),[ref]$null,[ref]$errosSupervisor)
if($errosSupervisor){throw 'Erro de sintaxe no supervisor.'}
$funcaoDetalhe=$astSupervisor.Find({param($n) $n-is[Management.Automation.Language.FunctionDefinitionAst]-and$n.Name-eq'Obter-DetalheFalha'},$true)
. ([scriptblock]::Create($funcaoDetalhe.Extent.Text))
$Operacao=Join-Path ([IO.Path]::GetTempPath()) ('sv-detalhe-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $Operacao|Out-Null
try{
 foreach($nome in @('backup','limpeza','expurgo')){
  Igual '' (Obter-DetalheFalha $nome) 'logs ausentes nao interrompem supervisor'
  Set-Content (Join-Path $Operacao "$nome-saida.log") @('primeira','motivo na saida','','  ')
  Igual ': motivo na saida' (Obter-DetalheFalha $nome) 'fallback para stdout'
  Set-Content (Join-Path $Operacao "$nome-erro.log") @('','  ')
  Igual ': motivo na saida' (Obter-DetalheFalha $nome) 'stderr vazio usa stdout'
  Set-Content (Join-Path $Operacao "$nome-erro.log") @('anterior','motivo no erro','',' ')
  Igual ': motivo no erro' (Obter-DetalheFalha $nome) 'ultima linha nao vazia de stderr prevalece'
  Set-Content (Join-Path $Operacao "$nome-erro.log") ('x'*400)
  Igual (': '+('x'*300)) (Obter-DetalheFalha $nome) 'detalhe limitado a 300 caracteres'
 }
}finally{Remove-Item $Operacao -Recurse -Force}
Write-Host 'OK: detalhes de falha do supervisor.'
