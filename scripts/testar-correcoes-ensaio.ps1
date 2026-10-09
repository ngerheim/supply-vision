$ErrorActionPreference='Stop'
$raizReal=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
. (Join-Path $PSScriptRoot 'migrar.ps1') -Biblioteca
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
$pasta=Join-Path ([IO.Path]::GetTempPath()) ('sv-correcoes-'+[guid]::NewGuid().ToString('N'))
$privadoAnterior=$env:SUPPLY_VISION_PRIVADO;$tempAnterior=$env:TEMP
$script:passaram=0
function Exigir-Correcao([bool]$Ok,[string]$Nome){if(!$Ok){throw "Falhou: $Nome"};$script:passaram++;Write-Host "OK: $Nome"}
try{
 New-Item -ItemType Directory -Force $pasta|Out-Null
 $env:TEMP=$pasta
 # Runtime ausente/presente; winget apenas simulado.
 $script:runtime=$false;$script:instalacoes=0
 function Get-ItemProperty {param($Path,$ErrorAction);if($Path-like'*VC\Runtimes*'){@{Installed=[int]$script:runtime;Major=14}}}
 function Get-Command {param($Name,$ErrorAction);if($Name-eq'winget.exe'){@{Source='winget-simulado'}}else{Microsoft.PowerShell.Core\Get-Command $Name -ErrorAction $ErrorAction}}
 function winget-simulado {$script:instalacoes++;Exigir-Correcao ($args-contains'Microsoft.VCRedist.2015+.x64') 'pacote VC++ x64';$script:runtime=$true;$global:LASTEXITCODE=0}
 $falhou=$false;try{Garantir-VisualCpp -SomenteVerificar}catch{$falhou=$_.Exception.Message.Contains('Visual C++')}
 Exigir-Correcao $falhou 'verificacao sem escrita alerta runtime ausente'
 Garantir-VisualCpp;Garantir-VisualCpp
 Exigir-Correcao ($script:instalacoes-eq1) 'instala runtime somente quando ausente'
 # Workerd que existe mas encerra; a mesma fronteira executa --version no instalador.
 $portal=Join-Path $pasta 'portal';$exe=Join-Path $portal 'node_modules/@cloudflare/workerd-windows-64/bin/workerd.exe'
 New-Item -ItemType Directory -Force (Split-Path $exe)|Out-Null;Set-Content $exe 'ficticio'
 function Executar-WorkerdVersao {return @{codigo=-1073741515;saida=''}}
 $falhou=$false;try{Conferir-Workerd $portal}catch{$falhou=$_.Exception.Message.Contains('Visual C++')}
 Exigir-Correcao $falhou 'workerd encerra e mensagem explica runtime/antivirus'
 function Executar-WorkerdVersao {return @{codigo=0;saida='workerd 2026'}}
 Conferir-Workerd $portal
 # Deteccao de antivirus, sem consultar nem alterar a protecao real.
 function Get-CimInstance {param($ClassName,$Namespace,$ErrorAction);[pscustomobject]@{displayName='Bitdefender ficticio'}}
 $av=Avisar-Bitdefender 6>&1|Out-String
 Exigir-Correcao ($av.Contains('controle avancado de ameacas')) 'avisa exclusao Bitdefender'

 function Get-CimInstance {param($ClassName,$Namespace,$ErrorAction);if($ClassName-eq'Win32_Service'){[pscustomobject]@{PathName='C:\Program Files\Bitdefender\ficticio.exe'}}}
 function Get-Service {}
 $av=Avisar-Bitdefender 6>&1|Out-String
 Exigir-Correcao ($av.Contains('BITDEFENDER detectado')) 'detecta Endpoint pelo caminho do servico'
 function Get-CimInstance {}
 $av=Avisar-Bitdefender 6>&1|Out-String
 Exigir-Correcao (!$av.Contains('BITDEFENDER detectado')) 'sem antivirus nao mostra aviso indevido'

 # Tarefa de teste de rede: credencial somente na API; resultado e limpeza simulados.
 function Preparar-PastaTesteRede {}
 function New-ScheduledTaskAction {param($Execute,$Argument);return @{Arguments=$Argument}}
 function New-ScheduledTaskSettingsSet {param($ExecutionTimeLimit);return @{}}
 $script:redeOk=$false;$script:conta='';$script:senhaViu=$false;$script:removeu=0
 # O mock reproduz a assinatura da API Windows; nenhuma senha real e utilizada.
 function Register-ScheduledTask {
  [Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingUsernameAndPasswordParams','',Justification='Mock da API Register-ScheduledTask com credencial ficticia.')]
  param($TaskName,$Action,$Settings,$User,$Password,$RunLevel)
  $script:acao=$Action;$script:conta=$User;$script:senhaViu=!!$Password
 }
 function Start-ScheduledTask {param($TaskName);$arq=($script:acao.Arguments-split'"')[1];$fonte=Get-Content $arq -Raw;[void]($fonte-match "Set-Content '([^']+)' 'OK'");Set-Content $Matches[1] $(if($script:redeOk){'OK'}else{'FALHA'})}
 function Stop-ScheduledTask {}
 function Unregister-ScheduledTask {$script:removeu++}
 $redeFicticia=$pasta
 function Testar-UncMigracao {return $true} # Adaptador de caminho ficticio; regex UNC e testada em testar-migracao.ps1.
 Exigir-Correcao (!(Testar-RedeComoSystem $redeFicticia)) 'rede SYSTEM sem permissao reprova'
 $senha=New-Object Security.SecureString;foreach($c in 'Ficticio123!'.ToCharArray()){$senha.AppendChar($c)}
 $cred=[pscredential]::new('DOMINIO\ficticio',$senha);$script:redeOk=$true
 Exigir-Correcao (Testar-RedeContaMigracao $redeFicticia $cred) 'conta personalizada aprovada antes de ativar tarefa'
 Exigir-Correcao ($script:conta-eq$cred.UserName-and$script:senhaViu-and$script:removeu-eq2) 'credencial entregue somente a API e tarefas temporarias removidas'
 # Seleciona somente processos com caminhos desta instalacao; evita prefixos semelhantes.
 $root='C:\Supply Vision'
 foreach($cmd in @('node "C:\Supply Vision\portal\scripts\processar-relatorios.mjs"','node npm-cli.js --prefix "C:\Supply Vision\portal" run email:watch','"C:\Supply Vision\portal\node_modules\workerd\bin\workerd.exe"')){
  Exigir-Correcao (Processo-OrfaoDestaInstalacao @{Name='node.exe';CommandLine=$cmd} $root) 'orfao desta instalacao selecionado'
 }
 foreach($cmd in @('node "C:\Outra\portal\scripts\processar-relatorios.mjs"','node "C:\Supply Vision extra\portal\scripts\processar-relatorios.mjs"','node app.js')){
  Exigir-Correcao (!(Processo-OrfaoDestaInstalacao @{Name='node.exe';CommandLine=$cmd} $root)) 'outro Node preservado'
 }
 $script:processos=@([pscustomobject]@{Name='node.exe';CommandLine='node "C:\Supply Vision\portal\scripts\processar-relatorios.mjs"';ProcessId=123;CreationDate='inicio'},[pscustomobject]@{Name='node.exe';CommandLine='node outra.js';ProcessId=456;CreationDate='inicio'})
 function Get-CimInstance {param($ClassName,$Filter,$ErrorAction);if($Filter){$script:processos|Where-Object ProcessId -EQ 123}else{$script:processos}}
 function Get-Process {}
 function taskkill.exe {$script:terminados+=@($args[1])}
 $script:terminados=@();Encerrar-OrfaosInstalacao $root
 Exigir-Correcao (($script:terminados-join',')-eq'123') 'limpeza nao encerra outro Node'
 # JSON reais do supervisor, tanto UTF8 sem BOM quanto com BOM do PS5.1.
 $falso=Join-Path $pasta 'homologacao';$priv=Join-Path $falso 'dados-ficticios'
 New-Item -ItemType Directory -Force (Join-Path $falso 'scripts'),(Join-Path $priv 'operacao')|Out-Null
 foreach($arq in @('homologar.ps1','operacao-logica.ps1','inicializacao-logica.ps1')){Copy-Item (Join-Path $PSScriptRoot $arq) (Join-Path $falso 'scripts')}
 $env:SUPPLY_VISION_PRIVADO=$priv
 foreach($bom in @($false,$true)){
  [IO.File]::WriteAllText((Join-Path $priv 'operacao/status.json'),(@{ensaio=$true;portal=$true;emails=$true;relatorios=$true;atualizado=(Get-Date).ToString('o')}|ConvertTo-Json -Compress),(New-Object Text.UTF8Encoding($bom)))
  [IO.File]::WriteAllText((Join-Path $priv 'operacao/estado.json'),(@{'alertas-2026-10-09-08:00'='ok'}|ConvertTo-Json -Compress),(New-Object Text.UTF8Encoding($bom)))
  $rel=Join-Path $pasta ('homologacao-'+$bom+'.txt')
  & (Join-Path $falso 'scripts/homologar.ps1') -Destino $rel
  $texto=Get-Content $rel -Raw -Encoding UTF8
  Exigir-Correcao ($texto.Contains('✅ status.json')-and$texto.Contains('✅ estado.json')) "homologacao JSON reais BOM=$bom"
 }
 # Politica somente no processo e pausa/log antes de relancar erro.
 $migrar=Get-Content (Join-Path $PSScriptRoot 'migrar.ps1') -Raw -Encoding UTF8
 Exigir-Correcao ($migrar.Contains('Set-ExecutionPolicy -Scope Process')-and$migrar.Contains("Read-Host 'A janela permanece aberta")-and$migrar.Contains('migracao-erro.log')) 'politica Process e erro com pausa/log'

 # Erro de pre-voo real: mensagem/log antes da pausa; nenhuma politica persistente.
 $script:pausou=$false;$script:politica=''
 function Set-ExecutionPolicy {param($Scope,$ExecutionPolicy,[switch]$Force);$script:politica="$Scope/$ExecutionPolicy"}
 function Read-Host {param($Prompt);$script:pausou=$Prompt.Contains('janela permanece aberta');return ''}
 $codigo=$migrar.Replace('$admin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)','$admin=$true')
 $destinoFalha=Join-Path $pasta 'instalacao-falha';$falhou=$false
 try{& ([scriptblock]::Create($codigo)) -Destino $destinoFalha -Zip (Join-Path $pasta 'inexistente.zip')}catch{$falhou=$true}
 Exigir-Correcao ($falhou-and$script:pausou-and$script:politica-eq'Process/Bypass'-and(Test-Path ($destinoFalha+'.migracao-erro.log'))) 'falha real de prevoo grava log e espera usuario'
 foreach($doc in @('INSTALAR','MIGRAR','SOCORRO')){
  $manual=Get-Content (Join-Path $raizReal "docs/$doc.md") -Raw -Encoding UTF8
  Exigir-Correcao ($manual.Contains('Bitdefender')-and$manual.Contains('controle avançado de ameaças')-and$manual.Contains('unable to unlink')-and$manual-match 'reinici') "orientacao antivirus em $doc"
 }
 $inicializacao=Get-Content (Join-Path $PSScriptRoot 'inicializacao-logica.ps1') -Raw -Encoding UTF8
 $configurar=Get-Content (Join-Path $PSScriptRoot 'configurar-inicializacao.ps1') -Raw -Encoding UTF8
 Exigir-Correcao ($inicializacao.Contains('Write-Progress')-and$configurar.Contains('configurada com sucesso')) 'progresso das permissoes e confirmacao de sucesso'

 # Nenhuma chamada PowerShell direta resolve npm.ps1.
 foreach($arq in @(Get-ChildItem (Join-Path $raizReal 'scripts'),(Join-Path $raizReal 'portal/scripts') -Filter '*.ps1' -File)){
  $ast=[Management.Automation.Language.Parser]::ParseFile($arq.FullName,[ref]$null,[ref]$null)
  $ruins=@($ast.FindAll({param($n)$n-is[Management.Automation.Language.CommandAst]-and$n.GetCommandName()-eq'npm'},$true))
  # Somente o mock da suite chama sua propria funcao npm.
  if($arq.Name-ne'testar-recuperacao-atualizacao.ps1'){Exigir-Correcao (!$ruins.Count) "npm.cmd em $($arq.Name)"}
 }
 Write-Host "PASSOU: $script:passaram verificacoes de correcoes do ensaio."
}finally{$env:TEMP=$tempAnterior;$env:SUPPLY_VISION_PRIVADO=$privadoAnterior;if(Test-Path $pasta){Remove-Item -LiteralPath $pasta -Recurse -Force}}

$global:LASTEXITCODE=0
