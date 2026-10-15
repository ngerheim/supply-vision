# Worker independente: nao herda stdout do cliente nem o job do PREPARAR.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Instalacao,[Parameter(Mandatory=$true)][string]$Preparo,[Parameter(Mandatory=$true)][string]$Operacao)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'atualizacao-preparo.ps1')
$arquivo=Join-Path $Operacao 'limpeza-preparo.lock'
$h=$null;$inicio=[datetime]::UtcNow;$resultado='concluida';$reservaResultado='nao aplicavel (contexto nao concluido)'
try{
 $h=[IO.File]::Open($arquivo,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::Read)
 $bytes=[Text.Encoding]::UTF8.GetBytes((@{pid=$PID;inicio=(Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o')}|ConvertTo-Json))
 $h.SetLength(0);$h.Write($bytes,0,$bytes.Length);$h.Flush()
 Set-Location $Instalacao
 # So o compromisso concluido libera os anteriores; falha/reversao nao.
 try{
  $contexto=Get-Content -LiteralPath (Join-Path $Operacao 'atualizacao.json') -Raw|ConvertFrom-Json
  if($contexto.fase-eq'concluido'-and$contexto.preparo-eq$Preparo){
   $guardada=Guardar-ReservaDependencias $Instalacao $Preparo
   $reservaResultado=if($guardada){'guardada por renomeacao'}else{'nao guardada - volume diferente ou ancestral com link'}
  }
 }catch{$reservaResultado='nao guardada - motivo: '+$_.Exception.Message}
 Limpar-PastaPreparo $Instalacao $Preparo
}catch{$resultado='pendente';$mensagem=$_.Exception.Message}
finally{
 $tempo=([math]::Round(([datetime]::UtcNow-$inicio).TotalSeconds,2)).ToString('0.##',[Globalization.CultureInfo]::InvariantCulture)
 try{
  $texto="[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Limpeza de preparo em segundo plano: $resultado em $tempo s; $mensagem"
  Add-Content -LiteralPath (Join-Path $Operacao 'atualizacao-tempos.log') -Value ('Reserva de dependencias: '+$reservaResultado) -Encoding UTF8
  Add-Content -LiteralPath (Join-Path $Operacao 'atualizacao-tempos.log') -Value $texto -Encoding UTF8
  @{resultado=$resultado;duracao=$tempo;fim=[datetime]::UtcNow.ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $Operacao 'limpeza-preparo.json') -Encoding UTF8
 }catch{}
 if($h){$h.Dispose();Remove-Item -LiteralPath $arquivo -Force -ErrorAction SilentlyContinue}
}
