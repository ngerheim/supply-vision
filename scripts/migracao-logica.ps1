# Orquestracao da origem: reutiliza semente e inicializacao existentes.
function Parar-ParaMigracao([string]$Privado) {
 $op=Join-Path $Privado 'operacao'
 if(Testar-SupervisorEncerrado $Privado){return}
 New-Item -ItemType File -Force (Join-Path $op 'parar.sinal')|Out-Null
 $limite=(Get-Date).AddSeconds(90)
 while(!(Testar-SupervisorEncerrado $Privado)){
  if((Get-Date)-ge$limite){throw 'A operacao nao parou. Abra a central como administrador e pare antes de tentar novamente.'}
  Start-Sleep 1
 }
}
function Preparar-Migracao([string]$Raiz,[string]$Privado,[string]$Startup,[string]$Destino,[ValidateSet('ensaio','definitiva')][string]$Modo) {
 if(!(Testar-Elevacao)){throw 'Preparar migracao exige abrir a central como administrador.'}
 if(Test-Path (Join-Path $Privado 'operacao\migrada.sinal')){throw 'Esta instalacao foi migrada para outro servidor'}
 New-Item -ItemType Directory -Force $Destino|Out-Null
 $t=Obter-TarefaSupplyVision $Raiz
 if($t){Disable-ScheduledTask -TaskName 'Supply Vision'|Out-Null}
 $pronta=$false
 try{
  Parar-ParaMigracao $Privado
  & (Join-Path $Raiz 'scripts\preparar-semente.ps1') -Destino $Destino
  Copy-Item (Join-Path $Raiz 'MIGRAR.bat'),(Join-Path $Raiz 'scripts\migrar.ps1') -Destination $Destino -Force
  if($Modo-eq'definitiva'){
   # Primeiro bloqueia qualquer inicio; so depois remove a inicializacao.
   New-Item -ItemType Directory -Force (Join-Path $Privado 'operacao')|Out-Null
   Set-Content (Join-Path $Privado 'operacao\migrada.sinal') (Get-Date).ToString('o') -Encoding UTF8
   Definir-ModoInicializacao $Raiz $Privado $Startup 'desligado'
  }
  $pronta=$true
 }finally{
  if($Modo-eq'ensaio'-or!$pronta){
   if(!(Test-Path (Join-Path $Privado 'operacao\migrada.sinal'))){
    if($t){Enable-ScheduledTask -TaskName 'Supply Vision'|Out-Null}
    Iniciar-OperacaoConfigurada $Raiz
   }
  }
 }
 Write-Host 'Leve esta pasta ao servidor e abra MIGRAR.bat. A semente tem dados e credenciais: proteja o pen drive.'
 if($Modo-eq'definitiva'){Write-Host 'Notebook bloqueado. Para voltar atras, siga docs/MIGRAR.md; nunca mantenha duas producoes.'}
 else{Write-Host 'Notebook voltou a producao. No servidor, escolha Ensaio.'}
}
