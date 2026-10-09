$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'migrar.ps1') -Biblioteca
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
. (Join-Path $PSScriptRoot 'inicializacao-logica.ps1')
. (Join-Path $PSScriptRoot 'migracao-logica.ps1')
function Exigir([bool]$Ok,[string]$Nome){if(!$Ok){throw "Falhou: $Nome"}}
foreach($c in @('\\servidor\pasta','\\servidor-arquivos\pasta\backups')){Exigir (Testar-UncMigracao $c) 'UNC valido'}
foreach($c in @('Z:\dados','\\servidor','C:\dados','\\servidor\pa:sta')){Exigir (!(Testar-UncMigracao $c)) 'UNC invalido'}
Exigir ((Sugerir-PortalUrl 'portal.empresa.local')-eq'http://portal.empresa.local:3000') 'DNS'
Exigir (Pular-EtapaMigracao 5 @{'5'='concluida'}) 'retomada'
Exigir (!(Pular-EtapaMigracao 6 @{'5'='concluida'})) 'nao pular pendente'
Exigir ((Decidir-CloneMigracao $false $false $false $false)-eq'clonar') 'clone novo'
Exigir ((Decidir-CloneMigracao $true $true $true $false)-eq'usar') 'clone concluido'
Exigir ((Decidir-CloneMigracao $true $false $true $false)-eq'arquivar') 'preservar clone interrompido'
Exigir ((Decidir-CloneMigracao $true $false $false $false)-eq'recusar') 'recusar pasta desconhecida'
Exigir ((Decidir-CloneMigracao $true $false $true $true)-eq'recusar') 'nao arquivar instalacao com dados'
Exigir (Permitir-DescarteEnsaio @{MODO_ENSAIO='1'}) 'descarte ensaio'
foreach($cfg in @(@{},@{MODO_ENSAIO='0'})){Exigir (!(Permitir-DescarteEnsaio $cfg)) 'recusa producao'}
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'homologar.ps1'),[ref]$null,[ref]$null)
$f=$ast.Find({param($n) $n-is[System.Management.Automation.Language.FunctionDefinitionAst]-and$n.Name-eq'Mascarar-Homologacao'},$true)
. ([scriptblock]::Create($f.Extent.Text))
$segredos=@('ficticio-segredo')
$mascarado=Mascarar-Homologacao 'smtp=ficticio-segredo pessoa@example.com Bearer abc123'
Exigir ($mascarado-notmatch'ficticio-segredo|pessoa@example.com|abc123') 'mascarar segredos e emails'
Exigir ((Mascarar-Homologacao 'SELECT * FROM users')-eq'[conteudo omitido]') 'omitir banco'
$pasta=Join-Path ([IO.Path]::GetTempPath()) ('sv-migracao-pura-'+[guid]::NewGuid().ToString('N'))
try{
 New-Item -ItemType Directory -Force (Join-Path $pasta 'operacao'),(Join-Path $pasta 'comum')|Out-Null
 $envfile=Join-Path $pasta 'comum/operacao.env';[IO.File]::WriteAllText($envfile,"# preservar`nMODO_ENSAIO=0`nSEGREDO=fictício-ação",(New-Object Text.UTF8Encoding($false)))
 Atualizar-EnvMigracao $envfile 'MODO_ENSAIO' '1'
 Exigir ((Ler-ConfigOperacao $envfile)['MODO_ENSAIO']-eq'1') 'env'
 Exigir ([IO.File]::ReadAllText($envfile).Contains('SEGREDO=fictício-ação')) 'preservar configuracao'
 Set-Content (Join-Path $pasta 'operacao/migrada.sinal') 'ficticio'
 $bloqueou=$false;try{Exigir-InstalacaoNaoMigrada $pasta}catch{$bloqueou=$_.Exception.Message-like'*migrada*'}
 Exigir $bloqueou 'marcador'
 $privadoAnterior=$env:SUPPLY_VISION_PRIVADO
 try{
  $env:SUPPLY_VISION_PRIVADO=$pasta;$bloqueou=$false
  try{Iniciar-OperacaoConfigurada (Split-Path $PSScriptRoot)}catch{$bloqueou=$_.Exception.Message-like'*migrada*'}
  Exigir $bloqueou 'central recusa inicio configurado antes de consultar tarefa'
 }finally{$env:SUPPLY_VISION_PRIVADO=$privadoAnterior}
 $raiz=Split-Path $PSScriptRoot
 Exigir ((Get-Content (Join-Path $raiz 'INICIAR.bat') -Raw)-match'Exigir-InstalacaoNaoMigrada') 'BAT usa guarda'
 Exigir ((Get-Content (Join-Path $PSScriptRoot 'central.ps1') -Raw)-match'Iniciar-OperacaoConfigurada') 'central usa guarda'
 Exigir ((Get-Content (Join-Path $PSScriptRoot 'inicializacao-logica.ps1') -Raw)-match'Exigir-InstalacaoNaoMigrada') 'inicio configurado usa guarda'
 # Origem com componentes simulados: orquestrador real, sem tocar tarefa ou dados reais.
 $raizFalsa=Join-Path $pasta 'origem';New-Item -ItemType Directory -Force (Join-Path $raizFalsa 'scripts')|Out-Null
 Set-Content (Join-Path $raizFalsa 'scripts/preparar-semente.ps1') 'param($Destino);Set-Content (Join-Path $Destino "semente.zip") "ficticio"'
 Set-Content (Join-Path $raizFalsa 'scripts/migrar.ps1') '# ficticio';Set-Content (Join-Path $raizFalsa 'MIGRAR.bat') 'rem ficticio'
 function Testar-Elevacao{return $true};function Obter-TarefaSupplyVision{return $null}
 function Iniciar-OperacaoConfigurada{$script:inicios++}
 function Definir-ModoInicializacao{$script:desligou=$true}
 $dados=Join-Path $pasta 'dados';$saida=Join-Path $pasta 'saida';$script:inicios=0;$script:desligou=$false
 Preparar-Migracao $raizFalsa $dados '' $saida ensaio
 Exigir ($script:inicios-eq1) 'ensaio retoma origem'
 Exigir (Test-Path (Join-Path $saida 'MIGRAR.bat')) 'leva BAT'
 Exigir (Test-Path (Join-Path $saida 'migrar.ps1')) 'leva script'
 Preparar-Migracao $raizFalsa $dados '' $saida definitiva
 Exigir ($script:inicios-eq1-and$script:desligou) 'definitiva nao retoma'
 Exigir (Test-Path (Join-Path $dados 'operacao/migrada.sinal')) 'definitiva bloqueia'
 $dadosEnsaio=Join-Path $pasta 'ensaio';New-Item -ItemType Directory -Force (Join-Path $dadosEnsaio 'comum')|Out-Null
 Set-Content (Join-Path $dadosEnsaio 'comum/operacao.env') 'MODO_ENSAIO=0'
 $recusou=$false;try{Descartar-InstalacaoEnsaio $raizFalsa $dadosEnsaio}catch{$recusou=$true};Exigir $recusou 'recusa descarte producao'
 Copy-Item (Join-Path $PSScriptRoot 'migracao-logica.ps1') (Join-Path $raizFalsa 'scripts/migracao-logica.ps1')
 Set-Content (Join-Path $dadosEnsaio 'comum/operacao.env') 'MODO_ENSAIO=1'
 $movida=Descartar-InstalacaoEnsaio $raizFalsa $dadosEnsaio
 Exigir (!(Test-Path $dadosEnsaio)-and(Test-Path (Join-Path $movida 'comum/operacao.env'))) 'descarte move sem apagar'
}finally{Remove-Item -LiteralPath $pasta -Recurse -Force}
Write-Host 'PASSOU: funcoes puras, origem ensaio/definitiva, marcador e descarte.'
