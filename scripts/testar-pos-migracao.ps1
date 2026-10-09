$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'migrar.ps1') -Biblioteca
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
$script:total=0
function Exigir-Pos([bool]$Ok,[string]$Nome){if(!$Ok){throw "Falhou: $Nome"};$script:total++;Write-Host "OK: $Nome"}
foreach($texto in @('definitiva',' migração definitiva ','MIGRACAO   DEFINITIVA','definitivo')){Exigir-Pos ((Normalizar-ModoMigracao $texto)-eq'definitiva') 'normaliza modo definitivo'}
foreach($texto in @('', '   ', 'qualquer coisa', 'migracao')){Exigir-Pos (!(Normalizar-ModoMigracao $texto)) 'modo ausente/invalido nao atribuido'}
Exigir-Pos ((Normalizar-ModoMigracao ' ENSAIO ')-eq'ensaio') 'normaliza ensaio'
$dir=Join-Path ([IO.Path]::GetTempPath()) ('sv-pos-migracao-'+[guid]::NewGuid().ToString('N'))
$anterior=$env:SUPPLY_VISION_PRIVADO
try{
 $repo=Join-Path $dir 'repo';New-Item -ItemType Directory -Force (Join-Path $repo 'scripts')|Out-Null
 foreach($arq in @('operacao-logica.ps1','inicializacao-logica.ps1','homologar.ps1')){Copy-Item (Join-Path $PSScriptRoot $arq) (Join-Path $repo 'scripts')}
 $fonte=Get-Content (Join-Path $PSScriptRoot 'migrar.ps1') -Raw -Encoding UTF8
 # Somente a verificacao de elevacao e simulada; retomada, pergunta e checkpoint reais.
 $fonte=$fonte.Replace('$admin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)','$admin=$true')
 $assistente=Join-Path $repo 'scripts/migrar-teste.ps1';[IO.File]::WriteAllText($assistente,$fonte,(New-Object Text.UTF8Encoding($true)))
 function Set-ExecutionPolicy {}
 $zip=Join-Path $dir 'semente-ficticia.zip';[IO.File]::WriteAllText($zip,'fixture: nao chega a restauracao')
 $checkpoint=$repo+'.migracao.json'
 @{semente=(Get-FileHash $zip -Algorithm SHA256).Hash;modo='';etapas=@{'1'='concluida';'2'='concluida';'3'='concluida'}}|ConvertTo-Json|Set-Content $checkpoint -Encoding UTF8
 $global:svPosPerguntas=0
 function Read-Host {$global:svPosPerguntas++;if($global:svPosPerguntas-eq1){return 'invalido'};throw 'Interrupcao simulada do usuario'}
 try{& $assistente -Zip $zip -RepositorioTeste $repo}catch{}
 $salvo=Get-Content $checkpoint -Raw|ConvertFrom-Json
 Exigir-Pos ($global:svPosPerguntas-eq2) 'resposta invalida repete pergunta'
 Exigir-Pos ($null-eq$salvo.PSObject.Properties['modo']) 'checkpoint nao grava modo vazio'
 Exigir-Pos ($null-eq$salvo.etapas.PSObject.Properties['4']) 'resposta invalida nao conclui etapa 4'
 # Reproduz tambem o checkpoint vazio gravado por versoes antigas.
 $salvo|Add-Member -NotePropertyName modo -NotePropertyValue ' '
 $salvo|ConvertTo-Json -Depth 5|Set-Content $checkpoint -Encoding UTF8
 $global:svPosPerguntas=0
 function Read-Host {$global:svPosPerguntas++;if($global:svPosPerguntas-eq1){return 'outra resposta invalida'};return 'migração definitiva'}
 try{& $assistente -Zip $zip -RepositorioTeste $repo -InterromperApos 4}catch{Exigir-Pos ($_.Exception.Message.Contains('Interrupcao simulada apos etapa 4')) 'retoma sem erro de ValidateSet'}
 $salvo=Get-Content $checkpoint -Raw|ConvertFrom-Json
 Exigir-Pos ($global:svPosPerguntas-eq2-and$salvo.modo-eq'definitiva'-and$salvo.etapas.'4'-eq'concluida') 'retomada aceita variacao e persiste modo canonico'
 $backup=Join-Path $dir 'backups';$agenda=@{BACKUP_HORARIOS='18:00'};$inicio=[datetime]'2026-10-09 16:00';$agora=[datetime]'2026-10-09 17:00'
 Exigir-Pos ((Obter-SituacaoBackupLocal $backup $agenda $inicio $agora).nivel-eq'aviso') 'pasta ausente antes do primeiro backup: aviso'
 New-Item -ItemType Directory $backup|Out-Null
 Exigir-Pos ((Obter-SituacaoBackupLocal $backup $agenda $inicio $agora).nivel-eq'aviso') 'pasta vazia antes do primeiro backup: aviso'
 Exigir-Pos ((Obter-SituacaoBackupLocal $backup $agenda $inicio ([datetime]'2026-10-09 18:01')).nivel-eq'erro') 'horario vencido sem arquivo: erro'
 Exigir-Pos ((Obter-SituacaoBackupLocal $backup $agenda ([datetime]'2026-10-09 19:00') ([datetime]'2026-10-09 19:10')).nivel-eq'aviso') 'horario anterior a instalacao nao e cobrado'
 Exigir-Pos ((Obter-SituacaoBackupLocal $backup $agenda $inicio ([datetime]'2026-10-10 00:01')).nivel-eq'erro') 'backup vencido no dia anterior: erro'
 Exigir-Pos ((Obter-SituacaoBackupLocal $backup @{BACKUP_HORARIOS='18:00';BACKUP_HORARIOS_SEX=''} $inicio ([datetime]'2026-10-09 19:00')).nivel-eq'aviso') 'dia sem backup respeita agenda'
 [IO.File]::WriteAllText((Join-Path $backup 'portal-atual.sqlite'),'arquivo ficticio')
 Exigir-Pos ((Obter-SituacaoBackupLocal $backup $agenda $inicio $agora).nivel-eq'ok') 'arquivo existente mantem resultado positivo'
 # Executa o relatorio real e verifica que nao duplica o item com sucesso.
 $priv=Join-Path $repo 'dados-ficticios';New-Item -ItemType Directory -Force (Join-Path $priv 'comum'),(Join-Path $priv 'operacao')|Out-Null
 $env:SUPPLY_VISION_PRIVADO=$priv
 [IO.File]::WriteAllText((Join-Path $priv 'comum/operacao.env'),"BACKUP_HORARIOS=18:00`nMODO_ENSAIO=1")
 function Get-Date {return [datetime]'2026-10-09 17:00'}
 function Invoke-RestMethod {return @{status='ok'}}
 function Obter-ModoInicializacao {return 'desligado'}
 function Get-ScheduledTask {}
 (Get-Item $priv).CreationTime=$inicio
 $rel=Join-Path $dir 'relatorio.txt'; & (Join-Path $repo 'scripts/homologar.ps1') -Destino $rel
 $linhas=@(Get-Content $rel -Encoding UTF8|Where-Object {$_-match 'Backups locais:'})
 Exigir-Pos ($linhas.Count-eq1-and$linhas[0].Contains('⚠️')-and$linhas[0].Contains('nenhum backup local ainda; o primeiro ocorre no próximo horário agendado')) 'relatorio real mostra um unico aviso de backup inicial'
 Write-Host "PASSOU: $script:total verificacoes pos-migracao."
}finally{Remove-Variable svPosPerguntas -Scope Global -ErrorAction SilentlyContinue;$env:SUPPLY_VISION_PRIVADO=$anterior;if(Test-Path $dir){Remove-Item -LiteralPath $dir -Recurse -Force}}
$global:LASTEXITCODE=0
