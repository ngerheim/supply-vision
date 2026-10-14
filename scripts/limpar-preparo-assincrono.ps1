# Worker independente: nao herda stdout da central nem o job do PREPARAR.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Instalacao,[Parameter(Mandatory=$true)][string]$Preparo,[Parameter(Mandatory=$true)][string]$Operacao)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'atualizacao-preparo.ps1')
$arquivo=Join-Path $Operacao 'limpeza-preparo.lock'
$h=$null;$inicio=[datetime]::UtcNow;$resultado='concluida'
try{
 $h=[IO.File]::Open($arquivo,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::Read)
 $bytes=[Text.Encoding]::UTF8.GetBytes((@{pid=$PID;inicio=(Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o')}|ConvertTo-Json))
 $h.SetLength(0);$h.Write($bytes,0,$bytes.Length);$h.Flush()
 Set-Location $Instalacao
 Limpar-PastaPreparo $Instalacao $Preparo
}catch{$resultado='pendente';$mensagem=$_.Exception.Message}
finally{
 $tempo=([math]::Round(([datetime]::UtcNow-$inicio).TotalSeconds,2)).ToString('0.##',[Globalization.CultureInfo]::InvariantCulture)
 try{
  $texto="[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Limpeza de preparo em segundo plano: $resultado em $tempo s; $mensagem"
  Add-Content -LiteralPath (Join-Path $Operacao 'atualizacao-tempos.log') -Value $texto -Encoding UTF8
  @{resultado=$resultado;duracao=$tempo;fim=[datetime]::UtcNow.ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $Operacao 'limpeza-preparo.json') -Encoding UTF8
 }catch{}
 if($h){$h.Dispose();Remove-Item -LiteralPath $arquivo -Force -ErrorAction SilentlyContinue}
}
