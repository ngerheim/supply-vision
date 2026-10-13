# Executa o bloco real de conclusao, com relogio/processos simulados e disco real.
param([string]$ArquivoSupervisor=(Join-Path $PSScriptRoot 'supervisor.ps1'))
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
$ast=[Management.Automation.Language.Parser]::ParseFile($ArquivoSupervisor,[ref]$null,[ref]$null)
$blocos=@($ast.FindAll({param($n) $n-is[Management.Automation.Language.IfStatementAst]-and$n.Extent.Text.Contains('$alerta-and$alerta.HasExited')-and$n.Extent.Text.Contains('Alertas concluidos')},$true))
if($blocos.Count-ne1){throw 'Bloco real de conclusao nao encontrado de forma unica.'}
$trecho=$blocos[0].Extent.Text
# Controle negativo: iniciar a saude ANTES da gravacao precisa ser detectado.
if(!$trecho.Contains('$alerta=$null;Salvar-Estado;try')){throw 'Ponto do controle negativo nao encontrado.'}
$incorreto=$trecho.Replace('$alerta=$null;Salvar-Estado;try','$alerta=$null;try')+';Salvar-Estado'
$pasta=Join-Path ([IO.Path]::GetTempPath()) ('sv-checkpoint-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $pasta|Out-Null
function Executar-Caso([string]$Codigo,[datetime]$Agora,[bool]$CortarNoLog){
 $horarios=@('00:00','08:00','11:00','14:00','17:00')
 $hora=@($horarios|Where-Object { [datetime]::ParseExact(($Agora.ToString('yyyy-MM-dd')+' '+$_),'yyyy-MM-dd HH:mm',[Globalization.CultureInfo]::InvariantCulture)-le$Agora })[-1]
 $estado=@{}
 foreach($h in $horarios){if($h-ne$hora){$estado['alertas-'+$Agora.ToString('yyyy-MM-dd')+'-'+$h]='ok'}}
 $d=Obter-SlotDevido 'alertas' ($horarios-join',') $estado $Agora
 if(!$d-or$d.hora-ne$hora){throw 'Cenario nao selecionou o slot esperado.'}
 $alertaChave=$d.chave;$alertaHora=$d.hora;$alertaRunId='ficticio';$Python='simulado';$Alertas=$pasta
 $alerta=@{HasExited=$true;ExitCode=0};$verificacaoSaude=$null
 $arquivo=Join-Path $pasta 'estado.json'
 Gravar-EstadoOperacao $arquivo $estado
 $script:saudeViuPersistencia=$null;$script:logViuPersistencia=$null;$cortou=$false
 function Get-Date {param([string]$Format);if($Format){return $Agora.ToString($Format,[Globalization.CultureInfo]::InvariantCulture)};return $Agora}
 function Log {param([string]$Texto)
  if($Texto.StartsWith('Alertas concluidos')){
   $script:logViuPersistencia=(Ler-EstadoOperacao $arquivo).ContainsKey($alertaChave)
   if($CortarNoLog){throw 'CORTE_SIMULADO_NO_LOG'}
  }
 }
 function Salvar-Estado {Gravar-EstadoOperacao $arquivo $estado}
 function Start-Process {param($FilePath,$ArgumentList,$WorkingDirectory,$WindowStyle,[switch]$PassThru)
  $script:saudeViuPersistencia=(Ler-EstadoOperacao $arquivo).ContainsKey($alertaChave)
  return @{HasExited=$false}
 }
 try{. ([scriptblock]::Create($Codigo))}catch{if($_.Exception.Message-ne'CORTE_SIMULADO_NO_LOG'){throw};$cortou=$true}
 $gravado=Ler-EstadoOperacao $arquivo
 if($CortarNoLog){
  if(!$cortou-or$gravado.ContainsKey($alertaChave)-or$script:logViuPersistencia){throw 'Nao reproduziu a interrupcao prematura do teste antigo.'}
  return
 }
 if($Codigo-eq$incorreto){if($script:saudeViuPersistencia-ne$false){throw 'Controle negativo nao detectou saude iniciada antes da persistencia.'};return}
 if($script:saudeViuPersistencia-ne$true-or!$gravado.ContainsKey($alertaChave)){throw 'Conclusao nao persistiu antes da partida da saude.'}
 if(Obter-SlotDevido 'alertas' $hora $gravado $Agora){throw 'Slot concluido seria reprocessado.'}
}
try{
 $datas=@('2026-10-12T23:59:59Z','2026-10-13T00:00:00Z','2026-10-13T00:00:01Z',
  '2026-10-13T07:59:59Z','2026-10-13T08:00:00Z','2026-10-13T08:00:01Z',
  '2026-10-13T10:59:59Z','2026-10-13T11:00:00Z','2026-10-13T11:00:01Z',
  '2026-10-13T13:59:59Z','2026-10-13T14:00:00Z','2026-10-13T14:00:01Z',
  '2026-10-13T16:59:59Z','2026-10-13T17:00:00Z','2026-10-13T17:00:01Z',
  '2026-10-13T23:59:59Z','2026-10-14T00:00:00Z')
 for($rodada=1;$rodada-le3;$rodada++){
  foreach($data in $datas){
   $agora=[datetimeoffset]::Parse($data,[Globalization.CultureInfo]::InvariantCulture).UtcDateTime
   Executar-Caso $trecho $agora $true
   Executar-Caso $trecho $agora $false
   Executar-Caso $incorreto $agora $false
  }
 }
 Write-Host 'PASSOU: 51 cenarios UTC; corte prematuro reproduzido, persistencia antes da saude e controle negativo verificados.'
}finally{Remove-Item -LiteralPath $pasta -Recurse -Force}
