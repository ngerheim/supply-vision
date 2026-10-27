# Exclusivo de testes/CI. A operacao conserva Executar-NativoOperacao sem retry.
. (Join-Path $PSScriptRoot '../operacao-logica.ps1')

function Executar-TentativaTesteCI([string]$Executavel,[string[]]$Argumentos) {
 $relogio=[Diagnostics.Stopwatch]::StartNew()
 $resultado=Executar-NativoOperacao $Executavel $Argumentos
 $relogio.Stop()
 $resultado.duracaoSegundos=$relogio.Elapsed.TotalSeconds
 return $resultado
}

function Aguardar-RepeticaoTesteCI([int]$Segundos) {
 Start-Sleep -Seconds $Segundos
}

function Invocar-ProcessoTesteCI([string]$Executavel,[string[]]$Argumentos=@(),[string]$Teste,[string]$Slot='sem-slot') {
 for($tentativa=1;$tentativa-le4;$tentativa++){
  $resultado=Executar-TentativaTesteCI $Executavel $Argumentos
  # saida contem stdout E stderr, inclusive linhas vazias. Qualquer escrita
  # impede a repeticao; um erro do PowerShell tambem chega ali com codigo 1.
  if($resultado.codigo-eq-1073741502-and$resultado.saida.Count-eq0-and$resultado.duracaoSegundos-lt5-and$tentativa-lt4){
   Write-Host ("REPETICAO 0xC0000142: teste={0}; slot={1}; duracao={2:F3}s" -f $Teste,$Slot,$resultado.duracaoSegundos)
   Aguardar-RepeticaoTesteCI ([int][Math]::Pow(2,$tentativa))
   continue
  }
  $resultado.saida|ForEach-Object {Write-Host $_}
  if($resultado.codigo-ne0){
   $motivo=if($resultado.saida.Count){($resultado.saida|Select-Object -Last 12)-join ' | '}else{'filho encerrou sem diagnostico em stdout/stderr'}
   $repeticao=if($tentativa-gt1){"; houve repeticao 0xC0000142 ($tentativa tentativas)"}else{''}
   throw "$Executavel encerrou com codigo=$($resultado.codigo); teste=$Teste; slot=$Slot; $motivo$repeticao"
  }
  return
 }
}
