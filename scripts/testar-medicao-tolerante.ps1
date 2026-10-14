# Medicao e opcional: nao pode impedir parada, troca, retomada ou reversao.
# Somente diretorios e tarefas ficticios; compativel com Windows PowerShell 5.1.
$ErrorActionPreference='Stop'
$fonte=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'atualizar-servidor.ps1'))
$ast=[Management.Automation.Language.Parser]::ParseInput($fonte,[ref]$null,[ref]$null)
$parar=$ast.Find({param($n) $n-is[Management.Automation.Language.FunctionDefinitionAst]-and$n.Name-eq'Parar-OperacaoAtualizacao'},$true).Extent.Text
$iniciar=$ast.Find({param($n) $n-is[Management.Automation.Language.FunctionDefinitionAst]-and$n.Name-eq'Iniciar-OperacaoAtualizada'},$true).Extent.Text
$base=Join-Path ([IO.Path]::GetTempPath()) ('sv-medicao-opcional-'+[guid]::NewGuid().ToString('N'))
try{
 # Replica o teste SYSTEM: importa apenas parada/retomada, sem bootstrap nem
 # funcoes de medicao. Modulo novo garante outro escopo script, sem heranca.
 foreach($tarefa in @($false,$true)){
  $raiz=Join-Path $base ([string]$tarefa);New-Item -ItemType Directory -Force $raiz|Out-Null
  $modulo=New-Module -ArgumentList $parar,$iniciar,$raiz,$tarefa,$PSScriptRoot -ScriptBlock {
   param($TextoParar,$TextoIniciar,$Raiz,$Tarefa,$Scripts)
   $ErrorActionPreference='Stop'
   $script:TarefaSemLogin=$Tarefa;$script:parou=$false;$script:desabilitou=$false;$script:iniciou=$false
   function Disable-ScheduledTask {$script:desabilitou=$true}
   function Enable-ScheduledTask {}
   function Start-ScheduledTask {$script:iniciou=$true}
   function Parar-Operacao {param($Raiz,$Limite);$script:parou=$true;return $true}
   . (Join-Path $Scripts 'atualizacao-preparo.ps1')
   . ([scriptblock]::Create($TextoParar))
   . ([scriptblock]::Create($TextoIniciar))
   if(Get-Command Inicializar-MedicaoAtualizacao -ErrorAction SilentlyContinue){throw 'Fixture isolada herdou medicao.'}
   $preparo=Nova-PastaPreparo $Raiz
   foreach($rel in @('portal/dist','portal/node_modules','alertas/.venv')){
    foreach($dir in @($Raiz,$preparo)){New-Item -ItemType Directory -Force (Join-Path $dir $rel)|Out-Null}
    [IO.File]::WriteAllText((Join-Path $Raiz "$rel/versao"),'anterior')
    [IO.File]::WriteAllText((Join-Path $preparo "$rel/versao"),'nova')
   }
   Parar-OperacaoAtualizacao 7
   if(!$script:parou-or!$script:ParadaSolicitada-or$script:desabilitou-ne$Tarefa){throw 'Parada sem medicao nao preservou tarefa/barreira.'}
   Trocar-ArtefatosPreparo $Raiz $preparo
   foreach($rel in @('portal/dist','portal/node_modules','alertas/.venv')){
    if((Get-Content (Join-Path $Raiz "$rel/versao"))-ne'nova'){throw 'Troca sem medicao incompleta.'}
   }
   Restaurar-ArtefatosPreparo $Raiz $preparo
   if($Tarefa){Iniciar-OperacaoAtualizada;if(!$script:iniciou){throw 'Tarefa sem medicao nao retomou.'}}
   # Falha operacional continua bloqueando a troca, apesar da telemetria opcional.
   function Parar-Operacao {return $false}
   $bloqueou=$false
   try{Parar-OperacaoAtualizacao 1}catch{$bloqueou=$_.Exception.Message-like'*troca de codigo e banco bloqueada*'}
   if(!$bloqueou){throw 'Ausencia de medicao enfraqueceu a barreira de parada.'}
  }
  Remove-Module $modulo -Force
  Write-Host "[OK] PARAR/TROCAR isolados sem medicao/helpers; tarefa=$tarefa"
 }
 # Funcoes reais de medicao, sem executar o bootstrap/atualizador inteiro.
 $inicio=$fonte.IndexOf('# Medicao sem dados');$fim=$fonte.IndexOf('$modoEnsaioEnvAnterior=',$inicio)
 . ([scriptblock]::Create($fonte.Substring($inicio,$fim-$inicio)))
 Set-StrictMode -Version 2.0
 $arquivo=Join-Path $base 'tempos.log'
 $script:MedicaoAtualizacao=$null
 Inicializar-MedicaoAtualizacao $arquivo
 $m=$script:MedicaoAtualizacao;$m.parada=[datetime]::UtcNow
 Inicializar-MedicaoAtualizacao $arquivo '{invalido'
 if(![object]::ReferenceEquals($m,$script:MedicaoAtualizacao)-or!$m.parada){throw 'Inicializacao repetida reiniciou medicao.'}
 # O filho preserva o contexto valido; contexto legado/ilegivel nao bloqueia.
 $herdada=Exportar-MedicaoAtualizacao $m
 $script:MedicaoAtualizacao=$null;Inicializar-MedicaoAtualizacao $arquivo $herdada
 if($script:MedicaoAtualizacao.id-ne$m.id-or$script:MedicaoAtualizacao.parada-ne$m.parada){throw 'Relancamento perdeu medicao valida.'}
 $script:MedicaoAtualizacao=$null;Inicializar-MedicaoAtualizacao $arquivo '{invalido'
 if(!$script:MedicaoAtualizacao){throw 'Contexto herdado invalido impediu inicializacao.'}
 foreach($estado in @($null,@{},@{relogio=$null},@{relogio='nao e um comando'},@{relogio={throw 'relogio ficticio falhou'}},@{relogio={$global:LASTEXITCODE=99;'valor invalido'}},@{inicio='invalido';etapa=@{inicio='invalido'}},[pscustomobject]@{relogio={throw 'sem setter'}})){
  $global:LASTEXITCODE=7
  $antes=[datetime]::UtcNow
  $hora=Obter-HoraMedicaoAtualizacao $estado
  if($hora-isnot[datetime]-or$hora-lt$antes.AddSeconds(-1)){throw 'Relogio padrao nao foi usado.'}
  Iniciar-EtapaMedida $estado 'troca ficticia'
  Encerrar-EtapaMedida $estado
  [void](Exportar-MedicaoAtualizacao $estado)
  Resumir-MedicaoAtualizacao $estado
  Registrar-TempoAtualizacao $estado 'sem destino de log'
  if($LASTEXITCODE-ne7){throw 'Medicao mudou codigo de saida operacional.'}
 }
 # Escrita bloqueada e campo sem setter tambem nao escapam do finally.
 $obstaculo=Join-Path $base 'arquivo';[IO.File]::WriteAllText($obstaculo,'fixture')
 $m=Nova-MedicaoAtualizacao (Join-Path $obstaculo 'saida.log') '' {throw 'clock indisponivel'}
 $global:LASTEXITCODE=7
 $avisos=@(Iniciar-EtapaMedida $m 'log bloqueado' 3>&1; Resumir-MedicaoAtualizacao $m 3>&1)
 if($avisos.Count-ne3){throw 'Falhas de escrita nao geraram os avisos previstos.'}
 $script:MedicaoAtualizacao='estado invalido';Inicializar-MedicaoAtualizacao $arquivo
 if($script:MedicaoAtualizacao-isnot[hashtable]-or$LASTEXITCODE-ne7){throw 'Medicao invalida nao foi reparada sem alterar resultado.'}
 Write-Host '[OK] Medicao opcional: idempotencia, relancamento, contexto/relogio/estado invalidos, log bloqueado e codigo preservado.'
}finally{if(Test-Path $base){Remove-Item -LiteralPath $base -Recurse -Force}}
$global:LASTEXITCODE=0
