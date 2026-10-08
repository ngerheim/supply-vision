$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'avisos-admin.ps1')
$script:logs=@();$script:chamadas=@()
function Log([string]$Texto) { $script:logs+=$Texto }
# Simula processos sem tocar SMTP nem qualquer pasta privada.
function Start-Process {
 param($FilePath,$ArgumentList,$WorkingDirectory,$WindowStyle,[switch]$PassThru)
 $script:chamadas+=@{Argumentos=$ArgumentList;Email=$env:ADMIN_ALERTA_EMAIL}
 $p=New-Object PSObject -Property @{HasExited=$false;ExitCode=0;Matou=$false;Descartou=$false}
 $p|Add-Member ScriptMethod Refresh {}
 $p|Add-Member ScriptMethod Kill {$this.Matou=$true;$this.HasExited=$true}
 $p|Add-Member ScriptMethod Dispose {$this.Descartou=$true}
 return $p
}
$eventos=@('portal-parou','portal-reiniciado','backup-falhou','alertas-falharam','alertas-revisao','disco-baixo','supervisor-iniciado')
foreach($config in @(@{},@{ADMIN_ALERTA_EMAIL=''},@{ADMIN_ALERTA_EMAIL=' , '})){
 $controle=Novo-ControleAvisosAdmin $config $false 'node.exe' 'portal'
 foreach($evento in $eventos){Avisar-Administrador $controle $evento}
 Atualizar-AvisosAdmin $controle
}
if($script:chamadas.Count-ne0){throw 'Recurso desligado iniciou processo.'}
$controle=Novo-ControleAvisosAdmin @{ADMIN_ALERTA_EMAIL='um@example.com,dois@example.com'} $false 'node.exe' 'portal'
foreach($evento in $eventos){
 Avisar-Administrador $controle $evento
 Avisar-Administrador $controle $evento
 $ultima=$script:chamadas[-1]
 if(($ultima.Argumentos-join '|')-ne"scripts\aviso-admin.mjs|$evento"){throw "Despacho incorreto: $evento"}
 if($ultima.Email-ne'um@example.com,dois@example.com'){throw 'Destinatarios nao foram propagados.'}
}
if($script:chamadas.Count-ne7-or$controle.Pendentes.Count-ne7){throw 'Despacho por tipo duplicado ou faltando.'}
$controle.Pendentes['backup-falhou'].Processo.HasExited=$true
$controle.Pendentes['backup-falhou'].Processo.ExitCode=1
Atualizar-AvisosAdmin $controle
if($controle.Pendentes.ContainsKey('backup-falhou')){throw 'Falha deixou processo preso.'}
if(!(($script:logs-join "`n").Contains('Falha no aviso ao administrador'))){throw 'Falha nao foi registrada.'}
# Relogio avancado alem do limite, sem esperar um minuto.
$p=$controle.Pendentes['portal-parou'].Processo
$controle.Pendentes['portal-parou'].Cronometro=New-Object PSObject -Property @{Elapsed=[timespan]::FromSeconds(61)}
Atualizar-AvisosAdmin $controle
if(!$p.Matou){throw 'Processo travado nao foi encerrado no prazo.'}
Atualizar-AvisosAdmin $controle
if($controle.Pendentes.ContainsKey('portal-parou')){throw 'Processo encerrado nao foi recolhido.'}
if(!(($script:logs-join "`n").Contains('excedeu 60 s'))){throw 'Timeout nao foi registrado.'}
Encerrar-AvisosAdmin $controle
if($controle.Pendentes.Count){throw 'Parada deixou avisos ativos.'}
$ensaio=Novo-ControleAvisosAdmin @{ADMIN_ALERTA_EMAIL='admin@example.com'} $true 'node.exe' 'portal'
$antes=$script:chamadas.Count
foreach($evento in $eventos){
 Avisar-Administrador $ensaio $evento
 if($script:logs[-1]-ne"ensaio: aviso ao administrador suprimido — $(Nome-EventoAdmin $evento)"){throw "Supressao nao foi registrada: $evento"}
}
if($script:chamadas.Count-ne$antes){throw 'Ensaio iniciou transporte.'}
function Start-Process { throw 'falha simulada que nao pode escapar' }
$controle=Novo-ControleAvisosAdmin @{ADMIN_ALERTA_EMAIL='admin@example.com'} $false 'node.exe' 'portal'
Avisar-Administrador $controle 'supervisor-iniciado'
if($controle.Pendentes.Count-ne0){throw 'Falha de partida criou processo ficticio.'}
if(!$script:logs[-1].StartsWith('Falha ao iniciar aviso ao administrador')){throw 'Falha de partida nao foi registrada.'}
Write-Host 'Avisos ao administrador: desligado, eventos, ensaio, falha e timeout aprovados.'
