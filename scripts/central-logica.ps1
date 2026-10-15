. (Join-Path $PSScriptRoot 'administracao-logica.ps1')
# Workers e cache exclusivos da interface WinForms.
function Novo-ControleCentral {
 return @{trabalhos=@{};proximoEstado=[datetime]::MinValue;proximaTarefa=[datetime]::MinValue;proximoRegistro=[datetime]::MinValue;geracao=0;interfaceMs=0}
}
function Iniciar-TrabalhoCentral($Controle,[string]$Chave,[scriptblock]$Codigo,[object[]]$Argumentos=@()){
 if($Controle.trabalhos.ContainsKey($Chave)){return $false}
 $ps=[powershell]::Create();[void]$ps.AddScript($Codigo.ToString())
 foreach($argumento in $Argumentos){[void]$ps.AddArgument($argumento)}
 try{$async=$ps.BeginInvoke()}catch{$ps.Dispose();throw}
 $Controle.trabalhos[$Chave]=@{ps=$ps;async=$async;tempo=[Diagnostics.Stopwatch]::StartNew();geracao=$Controle.geracao;cancelando=$false}
 return $true
}
function Receber-TrabalhoCentral($Controle,[string]$Chave){
 $trabalho=$Controle.trabalhos[$Chave]
 if(!$trabalho-or!$trabalho.async.IsCompleted){return $null}
 try{$valores=$trabalho.ps.EndInvoke($trabalho.async);$valor=@($valores)[-1];return @{ok=$true;valor=$valor;geracao=$trabalho.geracao}}
 catch{return @{ok=$false;mensagem='Consulta ou comando nao concluido.';geracao=$trabalho.geracao}}
 finally{$trabalho.ps.Dispose();$Controle.trabalhos.Remove($Chave)}
}
function Cancelar-ConsultaCentral($Controle,[string]$Chave,[int]$LimiteMs=30000){
 $trabalho=$Controle.trabalhos[$Chave]
 if($trabalho-and!$trabalho.cancelando-and!$trabalho.async.IsCompleted-and$trabalho.tempo.ElapsedMilliseconds-ge$LimiteMs){
  $trabalho.cancelando=$true;[void]$trabalho.ps.BeginStop($null,$null);return $true
 }
 return $false
}
function Invalidar-ConsultasCentral($Controle,[switch]$Tarefa){
 $Controle.geracao++;$Controle.proximoEstado=[datetime]::MinValue
 if($Tarefa){$Controle.proximaTarefa=[datetime]::MinValue}
}
function Codigo-ConsultaCentral {
 return {
  param($Raiz,$Privado,$Startup,$Tipo,$InterfaceMs,$Registrar)
  $ErrorActionPreference='Stop'
  foreach($nome in @('operacao-logica','inicializacao-logica','central-logica')){. (Join-Path $Raiz "scripts/$nome.ps1")}
  if($Tipo-eq'tarefa'){Consultar-TarefaCentral $Raiz $Privado $Startup}
  else{Consultar-EstadoCentral $Privado $InterfaceMs $Registrar $Raiz}
 }
}
function Iniciar-ConsultasCentral($Controle,[string]$Raiz,[string]$Privado,[string]$Startup,[datetime]$Agora=[datetime]::UtcNow){
 $codigo=Codigo-ConsultaCentral
 if($Agora-ge$Controle.proximaTarefa-and!( $Controle.trabalhos.ContainsKey('tarefa'))){
  if(Iniciar-TrabalhoCentral $Controle 'tarefa' $codigo @($Raiz,$Privado,$Startup,'tarefa',0,$false)){$Controle.proximaTarefa=$Agora.AddSeconds(60)}
 }
 if($Agora-ge$Controle.proximoEstado-and!($Controle.trabalhos.ContainsKey('estado'))){
  $registrar=$Agora-ge$Controle.proximoRegistro
  if(Iniciar-TrabalhoCentral $Controle 'estado' $codigo @($Raiz,$Privado,$Startup,'estado',$Controle.interfaceMs,$registrar)){
   $Controle.proximoEstado=$Agora.AddSeconds(5);if($registrar){$Controle.proximoRegistro=$Agora.AddSeconds(60)}
  }
 }
}
function Codigo-AcaoCentral {
 return {
  param($Raiz,$Privado,$Startup,$Tipo,$Dados)
  $ErrorActionPreference='Stop'
  foreach($nome in @('operacao-logica','inicializacao-logica','migracao-logica','central-logica')){. (Join-Path $Raiz "scripts/$nome.ps1")}
  try{Executar-AcaoCentral $Raiz $Privado $Startup $Tipo $Dados}
  catch{return @{ok=$false;erro=$true;mensagem=$_.Exception.Message}}
 }
}

# Leitura pequena em worker proprio: nao disputa o worker do Agendador.
function Iniciar-ConsultaAndamentoCentral($Controle,[string]$Raiz,[string]$Privado) {
 [void](Iniciar-TrabalhoCentral $Controle 'andamento' {
  param($Raiz,$Privado)
  . (Join-Path $Raiz 'scripts/central-logica.ps1')
  Consultar-AndamentoCentral $Privado
 } @($Raiz,$Privado))
}
