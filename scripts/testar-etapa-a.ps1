$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
$pasta=Join-Path ([IO.Path]::GetTempPath()) ('sv-etapa-a-'+[guid]::NewGuid().ToString('N'))
$antes=$env:SUPPLY_VISION_PRIVADO
try{
 New-Item -ItemType Directory -Path (Join-Path $pasta 'operacao') -Force|Out-Null
 $env:SUPPLY_VISION_PRIVADO=$pasta
 $global:habilitada=$false;$global:iniciada=$false;$global:portas=$true;$global:encerrado=$false
 function Get-NetTCPConnection {if($global:portas){@{LocalPort=3000}}}
 function Testar-SupervisorEncerrado {return $global:encerrado}
 function Enable-ScheduledTask {$global:habilitada=$true}
 function Start-ScheduledTask {$global:iniciada=$true}
 if(Parar-Operacao $pasta 0){throw 'Prazo esgotado nao pode aprovar parada'}
 Recuperar-OperacaoAntesDaTroca $pasta $true $true
 if(!$global:habilitada-or!$global:iniciada){throw 'Falha na parada deve reabilitar e retomar tarefa'}
 if(Test-Path (Join-Path $pasta 'operacao/parar.sinal')){throw 'Recuperacao deve cancelar sinal pendente'}
 $global:encerrado=$true
 if(Parar-Operacao $pasta 0){throw 'Supervisor encerrado com portas ocupadas nao libera'}
 $global:portas=$false
 if(!(Parar-Operacao $pasta 0)){throw 'Supervisor e portas livres devem liberar'}
 foreach($codigo in @(2147943726L,2147943785L,2147943730L)){
  if((Obter-FalhaLogonTarefa $codigo)-notmatch 'configurar-inicializacao.ps1 -Modo computador -ContaPersonalizada'){throw 'Falta orientacao de logon'}
 }
 if(Obter-FalhaLogonTarefa 0){throw 'Resultado zero nao e falha'}
 if((Obter-EventoVigilancia $true $false)-ne'tarefa-falhou'){throw 'Falha de tarefa tem prioridade'}
 if((Obter-EventoVigilancia $false $false)-ne'vigilancia-health'){throw 'Health deve avisar'}
 if(Obter-EventoVigilancia $false $true){throw 'Saudavel nao deve avisar'}
 # Executa o catch real do atualizador no caso que antes escapava da retomada.
 $ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'atualizar-servidor.ps1'),[ref]$null,[ref]$null)
 $catch=$ast.Find({param($n) $n-is[System.Management.Automation.Language.CatchClauseAst]-and$n.Body.Extent.Text.Contains('$falha = $_')},$true)
 $texto=$catch.Body.Extent.Text.Trim();$texto=$texto.Substring(1,$texto.Length-2).Replace('exit 1','$global:catchExecutado=$true')
 $CodigoTrocado=$false;$Recuperando=$false;$OperacaoParada=$false;$OperacaoEstavaAtiva=$true;$script:TarefaSemLogin=$true;$Raiz=$pasta
 $global:habilitada=$false;$global:iniciada=$false
 function Write-Error {}
 try{throw 'parada nao terminou no prazo'}catch{. ([scriptblock]::Create($texto))}
 if(!$global:habilitada-or!$global:iniciada-or!$global:catchExecutado){throw 'Catch real nao recuperou parada incompleta'}
 Write-Host 'PASSOU: 12 verificacoes de parada, recuperacao, logon e vigilancia.'
}finally{$env:SUPPLY_VISION_PRIVADO=$antes;Remove-Item -LiteralPath $pasta -Recurse -Force}
