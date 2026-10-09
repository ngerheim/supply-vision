# Funcoes de apoio exclusivas dos testes; nao alteram a operacao.
function Esperar-CondicaoTeste([scriptblock]$Condicao,[int]$Segundos=60,
 [scriptblock]$Agora={ [DateTime]::UtcNow },
 [scriptblock]$Pausa={param($Ms) Start-Sleep -Milliseconds $Ms}){
 $limite=(& $Agora).AddSeconds($Segundos)
 do{
  if(& $Condicao){return $true}
  if((& $Agora)-ge$limite){return $false}
  & $Pausa 500
 }while($true)
}
function Formatar-DiagnosticoTravaTeste($Instancias){
 $linhas=@()
 foreach($i in $Instancias){
  $usado=if(Test-Path -LiteralPath $i.manifesto){(Get-Content -LiteralPath $i.manifesto -Raw).Trim()}else{'nao registrado; instancia ainda nao chegou a entrada'}
  $linhas+="PID $($i.pid): trava passada=$($i.trava); trava registrada=$usado; existe=$(Test-Path -LiteralPath $i.trava)"
  foreach($tipo in @('saida','erro','log')){
   $conteudo=try{if(Test-Path -LiteralPath $i[$tipo]){Get-Content -LiteralPath $i[$tipo] -Raw -Encoding UTF8 -ErrorAction Stop}else{'(arquivo ainda nao criado)'}}catch{"(leitura indisponivel: $($_.Exception.Message))"}
   $linhas+="${tipo}: $($i[$tipo])`n$conteudo"
  }
 }
 return $linhas-join"`n"
}
