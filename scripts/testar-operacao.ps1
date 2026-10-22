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

# Backup 13:30 restaura estado sem o envio das 14h; corte 15h impede repeti-lo.
$pastaCorte=Join-Path ([IO.Path]::GetTempPath()) ('sv-corte-'+[guid]::NewGuid().ToString('N'))
try {
 New-Item -ItemType Directory -Path $pastaCorte|Out-Null
 $arquivoCorte=Join-Path $pastaCorte 'restauracao.json'
 $estado=@{}
 Igual 0 @(Pular-AlertasRestaurados $pastaCorte '14:00,17:00' $estado ([datetime]'2026-10-05 15:00')).Count 'sem restauracao nao muda estado'
 Igual '14:00' (Obter-SlotDevido 'alertas' '14:00,17:00' $estado ([datetime]'2026-10-05 15:00')).hora 'reinicio normal recupera slot devido'
 '{"corte":"2026-10-05T18:00:00.000Z"}'|Set-Content -LiteralPath $arquivoCorte -Encoding UTF8
 $estado=@{'alertas-2026-10-05-08:00'='enviado'}
 $pulados=@(Pular-AlertasRestaurados $pastaCorte '08:00,14:00,15:00,17:00' $estado ([datetime]'2026-10-05 15:00'))
 Igual 2 $pulados.Count 'slots anterior e igual ao corte pulados'
 Igual 'enviado' $estado['alertas-2026-10-05-08:00'] 'preserva slot registrado'
 Igual 'pulado-por-restauracao' $estado['alertas-2026-10-05-14:00'] '14h nao reenvia'
 Gravar-EstadoOperacao (Join-Path $pastaCorte 'estado.json') $estado
 $estado=Ler-EstadoOperacao (Join-Path $pastaCorte 'estado.json')
 Igual 0 @(Pular-AlertasRestaurados $pastaCorte '08:00,14:00,15:00,17:00' $estado ([datetime]'2026-10-05 15:00')).Count 'reinicio conserva pulos sem novo aviso'
 Igual $null (Obter-SlotDevido 'alertas' '14:00,15:00,17:00' $estado ([datetime]'2026-10-05 15:00')) 'nenhum envio automatico antes do corte'
 Igual '17:00' (Obter-SlotDevido 'alertas' '14:00,17:00' $estado ([datetime]'2026-10-05 17:00')).hora '17h segue normal'
 $estado=@{}
 Igual 0 @(Pular-AlertasRestaurados $pastaCorte '00:00,14:00,17:00' $estado ([datetime]'2026-10-06 00:00')).Count 'corte expira a meia-noite'
 Igual '14:00' (Obter-SlotDevido 'alertas' '14:00,17:00' $estado ([datetime]'2026-10-06 15:00')).hora 'corte antigo nao afeta dia seguinte'
 # Executa o proprio bloco de agenda do supervisor com processos/avisos ficticios.
 # A configuracao restaurada perdeu o slot 14h ja enviado; o corte e externo ao estado.
 & {
  $ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'supervisor.ps1'),[ref]$null,[ref]$null)
  $bloco=$ast.Find({param($n) $n-is[Management.Automation.Language.IfStatementAst]-and$n.Clauses[0].Item1.Extent.Text-eq'!$manutencao-and!$alerta'},$true)
  if(!$bloco){throw 'Bloco de agenda de Alertas nao encontrado.'}
  $agenda=[scriptblock]::Create($bloco.Extent.Text)
  $Operacao=$pastaCorte;$config=@{ALERTAS_HORARIOS='14:00,17:00'};$estado=@{}
  $manutencao=$false;$alerta=$null;$ensaio=$true;$avisosAdmin=@{};$Python='python-ficticio';$Alertas='fixture'
  $agoraTeste=[datetime]'2026-10-05 15:00';$avisos=New-Object 'Collections.Generic.List[string]';$logs=New-Object 'Collections.Generic.List[string]';$execucoes=New-Object 'Collections.Generic.List[string]'
  function Get-Date { return $agoraTeste }
  function Log([string]$Texto){$logs.Add($Texto)}
  function Avisar-Administrador($Controle,[string]$Evento){$avisos.Add($Evento)}
  function Salvar-Estado { Gravar-EstadoOperacao (Join-Path $Operacao 'estado.json') $estado }
  function Pode-Tentar { return $true }
  function Start-Process { param($FilePath,$ArgumentList,$WorkingDirectory,$WindowStyle,[switch]$PassThru);$execucoes.Add(($ArgumentList-join '|'));return @{Id=1;Handle=0} }
  . $agenda
  Igual 0 $execucoes.Count 'supervisor nao executa 14h depois de restaurar configuracao'
  Igual 'alertas-restauracao' ($avisos-join ',') 'supervisor avisa administrador pelo mecanismo existente'
  Igual $true (($logs-join ',').Contains('Alertas pulados por restauracao: alertas-2026-10-05-14:00.')) 'supervisor registra pulo no log'
  $estado=Ler-EstadoOperacao (Join-Path $Operacao 'estado.json')
  . $agenda
  Igual 1 $avisos.Count 'reinicio nao repete aviso do slot ja registrado'
  $agoraTeste=[datetime]'2026-10-05 17:00'
  . $agenda
  Igual 1 $execucoes.Count 'supervisor executa slot posterior'
  Igual 'processo\pipeline.py|--slot|17:00|--sem-envio' $execucoes[0] 'execucao normal do slot 17h'
  foreach($conteudo in @('{quebrado','{}','{"corte":"invalida"}','{"corte":null}')){
   [IO.File]::WriteAllText($arquivoCorte,$conteudo)
   [IO.File]::SetLastWriteTimeUtc($arquivoCorte,([datetime]'2026-10-05 18:00:00'))
   $agoraTeste=[datetime]'2026-10-05 15:00';$estado=@{};$alerta=$null
   $avisos.Clear();$logs.Clear();$execucoes.Clear()
   foreach($volta in 1..3){
    . $agenda
    # Simula inclusive reinicio: o aviso diario precisa sobreviver em estado.json.
    $estado=Ler-EstadoOperacao (Join-Path $Operacao 'estado.json')
   }
   Igual 'pulado-por-restauracao' $estado['alertas-2026-10-05-14:00'] "modificacao protege slot 14h: $conteudo"
   Igual $false $estado.ContainsKey('alertas-2026-10-05-17:00') "modificacao nao bloqueia slot 17h: $conteudo"
   Igual 0 $execucoes.Count "arquivo invalido nao reenvia: $conteudo"
   Igual 'alertas-restauracao' ($avisos-join ',') "arquivo invalido avisa uma vez: $conteudo"
   Igual 1 @($logs|Where-Object {$_-like 'AVISO:*data de modificacao como corte*'}).Count "aviso no log: $conteudo"
   Igual 0 @(Pular-AlertasRestaurados $Operacao '00:00' @{} ([datetime]'2026-10-06 00:00') {param($m)}).Count "modificacao expira a meia-noite: $conteudo"
   $agoraTeste=[datetime]'2026-10-06 15:00'
   . $agenda
   Igual 1 $execucoes.Count "modificacao expira no dia seguinte: $conteudo"
   Igual 2 $avisos.Count "aviso de arquivo ainda invalido renova uma vez no novo dia: $conteudo"
   $alerta=$null
   . $agenda
   Igual 2 $avisos.Count "novo dia tambem nao repete aviso: $conteudo"
  }
  & {
   function Get-Content { [CmdletBinding()]param($LiteralPath,[switch]$Raw,$Encoding);throw [UnauthorizedAccessException]::new('leitura ficticia negada') }
   $estado=@{};$mensagens=New-Object 'Collections.Generic.List[string]'
   $resultado=@(Pular-AlertasRestaurados $Operacao '14:00,17:00' $estado ([datetime]'2026-10-05 15:00') {param($m) $mensagens.Add($m)})
   Igual 'alertas-2026-10-05-14:00' ($resultado-join ',') 'leitura negada usa modificacao'
   Igual 1 $mensagens.Count 'leitura negada registra aviso'
   function Get-Item { [CmdletBinding()]param($LiteralPath,[switch]$Force);throw [UnauthorizedAccessException]::new('metadados ficticios negados') }
   Igual 0 @(Pular-AlertasRestaurados $Operacao '14:00,17:00' @{} ([datetime]'2026-10-05 15:00') {param($m) $mensagens.Add($m)}).Count 'sem modificacao segue sem corte'
   Igual $true $mensagens[1].Contains('modificacao indisponivel, seguindo sem corte') 'sem modificacao registra aviso'
   Igual 0 @(Pular-AlertasRestaurados $Operacao '14:00' @{} ([datetime]'2026-10-05 15:00') {throw 'log ficticio indisponivel'}).Count 'falha no log nao lanca excecao'
  }
 }
 Write-Host '[OK] Corte da restauracao: 14h pulado, 17h normal, reinicio e expiracao.'
} finally { Remove-Item -LiteralPath $pastaCorte -Recurse -Force }

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

$portaAmbienteAntes=$env:PORTAL_PORTA
try {
 $env:PORTAL_PORTA='42346'
 Igual 42346 (Obter-PortaPortalLocal @{PORTAL_PORTA='42345'}) 'ambiente sobrepoe arquivo como a partida Node'
 $env:PORTAL_PORTA='0';$recusada=$false
 try{Obter-PortaPortalLocal @{PORTAL_PORTA='42345'}}catch{$recusada=$true}
 Igual $true $recusada 'porta invalida no ambiente nao usa arquivo silenciosamente'
}finally{$env:PORTAL_PORTA=$portaAmbienteAntes}

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

# Configuracao ausente deve acumular falhas, sem escapar por indice em null.
& {
 $fixture=Join-Path ([IO.Path]::GetTempPath()) ('sv-validacao-'+[guid]::NewGuid().ToString('N'))
 $privadoAntes=$env:SUPPLY_VISION_PRIVADO;$falhasValidacao=New-Object 'Collections.Generic.List[string]'
 function Write-Error {param($Message,$ErrorAction);$falhasValidacao.Add([string]$Message)}
 try{
  $env:SUPPLY_VISION_PRIVADO=Join-Path $fixture 'dados-ficticios'
  $erroValidacao=''
  try{& (Join-Path $PSScriptRoot 'validar-operacao.ps1') -Raiz $fixture}catch{$erroValidacao=$_.Exception.Message}
  if($erroValidacao-notlike'Validacao operacional reprovada em * item(ns).'-or$falhasValidacao.Count-lt9){throw "Configuracao ausente: mensagem=$erroValidacao; diagnosticos=$($falhasValidacao.Count)."}
 }finally{
  $env:SUPPLY_VISION_PRIVADO=$privadoAntes
  if(Test-Path -LiteralPath $fixture){Remove-Item -LiteralPath $fixture -Recurse -Force}
 }
}
Write-Host 'OK: configuracao ausente preserva a lista de falhas.'
