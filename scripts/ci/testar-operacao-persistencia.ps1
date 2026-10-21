# Identifica inclusive filhos que saem com codigo nao zero sem escrever erro.
[CmdletBinding()]
param([string]$Evento='pull_request')
$ErrorActionPreference='Stop'
$slot='sem-slot (validacao da operacao)';$rodada=0;$teste='validar-operacao.ps1'
try {
 . (Join-Path $PSScriptRoot '../operacao-logica.ps1')
 $powershell=(Get-Command powershell.exe -CommandType Application -ErrorAction Stop).Source
 $scripts=Split-Path $PSScriptRoot -Parent
 function Invocar-TestePersistenciaCI([string]$Nome,[string[]]$Argumentos=@()) {
  Write-Host "INICIO: teste=$Nome; rodada=$rodada; slot=$slot"
  $resultado=Executar-NativoOperacao $powershell (@('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $scripts $Nome))+$Argumentos)
  $resultado.saida|ForEach-Object {Write-Host $_}
  if($resultado.codigo-ne0){
   $motivo=if($resultado.saida.Count){($resultado.saida|Select-Object -Last 12)-join ' | '}else{'filho encerrou sem diagnostico em stdout/stderr'}
   throw "powershell.exe encerrou com codigo=$($resultado.codigo); $motivo"
  }
  Write-Host "OK: teste=$Nome; rodada=$rodada; slot=$slot"
 }
 Invocar-TestePersistenciaCI $teste
 $rodadas=if($Evento-in@('schedule','workflow_dispatch')){2}else{1}
 foreach($rodada in 1..$rodadas){
  foreach($slot in @('00:00','08:00','11:00','14:00','17:00')){
   $teste='testar-persistencia-alertas.ps1'
   $agora='2026-10-13T'+$slot+':01Z'
   Invocar-TestePersistenciaCI $teste @('-AgoraSimulado',$agora,'-Slot',$slot)
  }
 }
} catch {
 $motivo=$_.Exception.Message -replace '\r?\n',' | '
 Write-Host "::error::Operacao/persistencia: teste=$teste; rodada=$rodada; slot=$slot; motivo=$motivo"
 throw
}
