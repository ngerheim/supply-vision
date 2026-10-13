# Exercita a conferencia real do atualizador com Git simulado, sem parar servicos.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
$source = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'atualizar-servidor.ps1') -Raw
$start = $source.IndexOf("Etapa 'Conferindo o repositorio'")
$end = $source.IndexOf('$mudou = git diff')
if ($start -lt 0 -or $end -le $start) { throw 'Bloco de conferencia nao encontrado.' }
$conferencia = [scriptblock]::Create($source.Substring($start, $end - $start))
function Validar-PythonAlertas([string]$Executavel) {}
function Etapa([string]$t) {}
function Ok([string]$t) {}
function git {
  $global:LASTEXITCODE = 0
  switch ($args[0]) {
    'status' { if ($script:caso -eq 'status-falha') { $global:LASTEXITCODE = 128 }; if ($script:caso -eq 'sujo') { ' M arquivo' } }
    'branch' { if ($script:caso -eq 'branch') { 'codex/trabalho' } else { 'main' } }
    'rev-parse' {
      if (($args[-1] -eq 'HEAD' -and $script:caso -eq 'head-falha') -or ($args[-1] -eq 'origin/main' -and $script:caso -eq 'remoto-falha')) { $global:LASTEXITCODE = 128 }
      else { if ($args[-1] -eq 'HEAD') { '1111111111111111111111111111111111111111' } else { '2222222222222222222222222222222222222222' } }
    }
    'log' { 'Versao sintetica' }
    'fetch' { if ($script:caso -eq 'fetch-falha') { $global:LASTEXITCODE = 128 } }
    'merge-base' { if ($script:caso -eq 'divergente') { $global:LASTEXITCODE = 1 } }
    default { throw "Comando nao permitido neste teste: $args" }
  }
}
foreach ($caso in @('status-falha','sujo','branch','head-falha','fetch-falha','remoto-falha','divergente','valido')) {
  $erro = $null
  try { & $conferencia } catch { $erro = $_ }
  if ($caso -eq 'valido' -and $erro) { throw $erro }
  if ($caso -ne 'valido' -and -not $erro) { throw "Cenario inseguro foi aceito: $caso" }
  Write-Host "[OK] $caso"
}
Write-Host 'Atualizacao segura: 8 cenarios aprovados.' -ForegroundColor Green

# A reexecução mantém a intenção do reparo, mesmo quando o diff é vazio.
$argumentos=Argumentos-ReexecucaoAtualizador 'atualizador.ps1' ('1'*40) $true
if ($argumentos -notcontains '-Reaplicar' -or $argumentos -notcontains '-JaAtualizado') { throw 'Reexecucao perdeu o modo de reparo.' }
$normal=Argumentos-ReexecucaoAtualizador 'atualizador.ps1' ('1'*40) $false
if ($normal -contains '-Reaplicar') { throw 'Atualizacao normal virou reparo.' }
# Executa o bloco real que decide quais dependências reinstalar no filho.
$inicioDependencias=$source.IndexOf('$mudou = git diff')
$fimDependencias=$source.IndexOf('if ($Simular)')
$decidir=[scriptblock]::Create($source.Substring($inicioDependencias,$fimDependencias-$inicioDependencias))
function git { $global:LASTEXITCODE=0; if($args[0] -ne 'diff'){throw "Comando inesperado: $args"} }
$Reaplicar=$argumentos -contains '-Reaplicar'
. $decidir
if (!$mexeuNode -or !$mexeuPython) { throw 'Reparo sem diff dispensou dependencias.' }
Write-Host '[OK] Reexecucao do reparo reinstala Node e Python.'

# Codigo 3 do backup (inclusive prazo da rede): o bloco real preserva a copia
# local e o reinicio real reabilita/dispara a tarefa, sem Agendador neste teste.
$pastaBackupTeste=Join-Path ([IO.Path]::GetTempPath()) ('sv-backup-prazo-'+[guid]::NewGuid().ToString('N'))
try {
 New-Item -ItemType Directory -Path $pastaBackupTeste|Out-Null
 $BackupAntesAtualizacaoOrigem=Join-Path $pastaBackupTeste 'local.sqlite'
 $BackupAntesAtualizacao=Join-Path $pastaBackupTeste 'pre-atualizacao.sqlite'
 Set-Content -LiteralPath $BackupAntesAtualizacaoOrigem 'snapshot local ficticio validado'
 $ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'atualizar-servidor.ps1'),[ref]$null,[ref]$null)
 $bloco=$ast.Find({param($n) $n-is[Management.Automation.Language.IfStatementAst]-and$n.Extent.Text.Contains("Etapa 'Backup do banco antes de trocar a versao'")},$true)
 $reinicio=$ast.Find({param($n) $n-is[Management.Automation.Language.FunctionDefinitionAst]-and$n.Name-eq'Iniciar-OperacaoAtualizada'},$true)
 function nodeBackupTeste {$global:LASTEXITCODE=3}
 function Testar-SupervisorEncerrado {return $false}
 function Parar-OperacaoAtualizacao {}
 function Aviso {param($Texto);$script:avisoBackup=$Texto}
 function Enable-ScheduledTask {$script:habilitouBackup=$true}
 function Start-ScheduledTask {$script:retomouBackup=$true}
 $Node='nodeBackupTeste';$Portal=$pastaBackupTeste;$Raiz=$pastaBackupTeste;$JaAtualizado=$false
 $script:TarefaSemLogin=$true;$script:habilitouBackup=$false;$script:retomouBackup=$false
 . ([scriptblock]::Create($bloco.Extent.Text))
 if(!(Test-Path $BackupAntesAtualizacao)-or(Get-Content $BackupAntesAtualizacao -Raw)-ne(Get-Content $BackupAntesAtualizacaoOrigem -Raw)){throw 'Codigo 3 perdeu a copia local'}
 if($script:avisoBackup-notmatch 'rede falhou ou excedeu o prazo'){throw 'Prazo de rede nao explica continuidade'}
 . ([scriptblock]::Create($reinicio.Extent.Text))
 Iniciar-OperacaoAtualizada
 if(!$script:habilitouBackup-or!$script:retomouBackup){throw 'Retomada nao reabilitou/disparou tarefa'}
 Write-Host '[OK] Prazo da rede: copia local preservada; codigo 3 continua e tarefa e retomada.'
} finally {Remove-Item -LiteralPath $pastaBackupTeste -Recurse -Force}

# Executa o bloco real de reexecucao com processo nativo sintetico.
$inicioFilho=$source.IndexOf('  $preferenciaFilho=$ErrorActionPreference')
$fimFilho=$source.IndexOf('  if ($rcFilho -ne 0)', $inicioFilho)
$blocoFilho=[scriptblock]::Create($source.Substring($inicioFilho,$fimFilho-$inicioFilho))
$script:hostTeste=(Get-Process -Id $PID).Path
function powershell.exe { & $script:hostTeste @args; $global:LASTEXITCODE=$LASTEXITCODE }
foreach($codigoFilho in @(0,7)){
 $argumentosReexecucao=@('-NoProfile','-Command',("[Console]::Error.WriteLine('npm warn install-scripts fixture'); Write-Host '=== Atualizado: 0bd5245 -> ddf9939 ==='; exit "+$codigoFilho))
 . $blocoFilho
 if($rcFilho-ne$codigoFilho-or$ErrorActionPreference-ne'Stop'){throw 'Stderr mudou codigo do filho ou preferencia do pai.'}
}
Remove-Item Function:powershell.exe

# Medicao real do atualizador com relogio fixo e pasta descartavel.
$inicioFuncoes=$source.IndexOf('# Medicao sem dados')
$fimFuncoes=$source.IndexOf('$medicaoEnvAnterior=',$inicioFuncoes)
if($inicioFuncoes-lt0-or$fimFuncoes-le$inicioFuncoes){throw 'Funcoes de medicao nao encontradas.'}
. ([scriptblock]::Create($source.Substring($inicioFuncoes,$fimFuncoes-$inicioFuncoes)))
$pastaMedicao=Join-Path ([IO.Path]::GetTempPath()) ('sv-medicao-'+[guid]::NewGuid().ToString('N'))
try{
 $script:horaMedicao=[datetime]'2026-01-01T12:00:00Z'
 $arquivoMedicao=Join-Path $pastaMedicao 'atualizacao-tempos.log'
 # A central antiga ocupa stdout; o atualizador deve medir em outro arquivo.
 [void][IO.Directory]::CreateDirectory($pastaMedicao)
 $stdoutAntigo=Join-Path $pastaMedicao 'atualizacao-saida.log'
 $bloqueio=[IO.File]::Open($stdoutAntigo,[IO.FileMode]::Create,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{
  $conflito=$false
  try{[IO.File]::AppendAllText($stdoutAntigo,'conflito')}catch{$conflito=$true}
  if(!$conflito){throw 'Fixture nao reproduziu bloqueio do stdout legado.'}
  $medicaoLegada=Nova-MedicaoAtualizacao $arquivoMedicao
  Registrar-TempoAtualizacao $medicaoLegada 'central antiga: medicao independente'
  if([IO.File]::ReadAllText($arquivoMedicao)-notmatch'central antiga: medicao independente'){throw 'Stdout bloqueado impediu medicao.'}
 }finally{$bloqueio.Dispose()}
 # Abertura compartilhada permite leitura enquanto os tempos sao acrescentados.
 $leitor=[IO.File]::Open($arquivoMedicao,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
 try{Registrar-TempoAtualizacao $medicaoLegada 'leitor compartilhado'}finally{$leitor.Dispose()}
 if([IO.File]::ReadAllText($arquivoMedicao)-notmatch'leitor compartilhado'){throw 'Leitor impediu medicao.'}
 # Bloqueio transitorio do arquivo proprio exige a nova tentativa curta.
 Add-Type -TypeDefinition @'
using System.IO;using System.Threading;
public static class SvLogTeste {
 public static void Liberar(FileStream arquivo) {
  var thread=new Thread(()=>{Thread.Sleep(50);arquivo.Dispose();});
  thread.IsBackground=true;thread.Start();
 }
}
'@
 $bloqueioTempo=[IO.File]::Open($arquivoMedicao,[IO.FileMode]::Open,[IO.FileAccess]::Write,[IO.FileShare]::None)
 [SvLogTeste]::Liberar($bloqueioTempo)
 Registrar-TempoAtualizacao $medicaoLegada 'gravado apos nova tentativa'
 if([IO.File]::ReadAllText($arquivoMedicao)-notmatch'gravado apos nova tentativa'){throw 'Medicao nao repetiu apos bloqueio transitorio.'}
 $bloqueioTempo=[IO.File]::Open($arquivoMedicao,[IO.FileMode]::Open,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{
  $global:LASTEXITCODE=0
  Registrar-TempoAtualizacao $medicaoLegada 'bloqueio permanente'
  if($LASTEXITCODE-ne0){throw 'Falha de medicao alterou codigo de sucesso.'}
 }finally{$bloqueioTempo.Dispose()}
 if(!$source.Contains("'operacao/atualizacao-tempos.log'")){throw 'Atualizador usa o arquivo ocupado pela central antiga.'}
 $m=Nova-MedicaoAtualizacao $arquivoMedicao '' {$script:horaMedicao}
 Iniciar-EtapaMedida $m 'Backup'
 $script:horaMedicao=$script:horaMedicao.AddSeconds(42)
 Encerrar-EtapaMedida $m
 $texto=[IO.File]::ReadAllText($arquivoMedicao)
 if($texto-notmatch'Backup: concluido em 42 s; inicio=\d{2}:\d{2}:\d{2}; fim=\d{2}:\d{2}:\d{2}'){throw 'Inicio/fim/duracao da etapa incorretos.'}
 # Pai/filho preservam o inicio total e o encerramento, nao reiniciam o contador.
 $m.parada=$script:horaMedicao
 $herdada=Exportar-MedicaoAtualizacao $m
 $script:horaMedicao=$script:horaMedicao.AddSeconds(50)
 $filho=Nova-MedicaoAtualizacao $arquivoMedicao $herdada {$script:horaMedicao}
 if($filho.id-ne$m.id-or$filho.inicio-ne$m.inicio-or$filho.parada-ne$m.parada){throw 'Medicao perdeu contexto na reexecucao.'}
 Iniciar-EtapaMedida $filho 'Religando'
 $script:horaMedicao=$script:horaMedicao.AddSeconds(10);$filho.health=$script:horaMedicao
 $script:horaMedicao=$script:horaMedicao.AddSeconds(5)
 Resumir-MedicaoAtualizacao $filho
 Resumir-MedicaoAtualizacao $m $true
 $texto=[IO.File]::ReadAllText($arquivoMedicao)
 if($texto-notmatch'total=107 s; operacao PARADA=60 s \(encerramento ate health ok\)'){throw 'Resumo total/parada incorreto.'}
 if(@($texto-split"`n"|Where-Object {$_-like'*Resumo atualizacao:*'}).Count-ne1){throw 'Pai duplicou resumo do filho.'}
 # Falha nunca inventa health nem encerramento bem sucedido.
 $falha=Nova-MedicaoAtualizacao $arquivoMedicao '' {$script:horaMedicao}
 Iniciar-EtapaMedida $falha 'Build';$falha.parada=$script:horaMedicao
 $script:horaMedicao=$script:horaMedicao.AddSeconds(7)
 Encerrar-EtapaMedida $falha 'falhou';Resumir-MedicaoAtualizacao $falha
 $texto=[IO.File]::ReadAllText($arquivoMedicao)
 if($texto-notmatch'Build: falhou em 7 s'-or$texto-notmatch'PARADA=pelo menos 7 s; health ok nao confirmado'){throw 'Falha sem health foi contabilizada como sucesso.'}
 $semParada=Nova-MedicaoAtualizacao $arquivoMedicao '' {$script:horaMedicao}
 Resumir-MedicaoAtualizacao $semParada
 if([IO.File]::ReadAllText($arquivoMedicao)-notmatch'PARADA=nao houve encerramento confirmado'){throw 'Simulacao/nada a fazer inventou parada.'}
 # Arquivo impedindo a criacao da pasta de log: apenas aviso, sem excecao.
 $obstaculo=Join-Path $pastaMedicao 'arquivo';[IO.File]::WriteAllText($obstaculo,'fixture')
 $impossivel=Nova-MedicaoAtualizacao (Join-Path $obstaculo 'saida.log')
 Iniciar-EtapaMedida $impossivel 'Backup' -WarningAction SilentlyContinue
 Resumir-MedicaoAtualizacao $impossivel -WarningAction SilentlyContinue
 # Falha antes de iniciar filho ainda gera resumo no pai.
 $pai=Nova-MedicaoAtualizacao $arquivoMedicao '' {$script:horaMedicao}
 Resumir-MedicaoAtualizacao $pai $true
 if([IO.File]::ReadAllText($arquivoMedicao)-notmatch("medicao="+$pai.id)){throw 'Filho sem resumo ocultou o resumo do pai.'}
 $centralFonte=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'central-logica.ps1'))
 if($centralFonte.Contains("'atualizacao-tempos.log'")){throw 'Central usa medicao como stdout.'}
 if(!$source.Contains('$script:MedicaoAtualizacao.health=')-or!$source.Contains('$script:MedicaoAtualizacao.parada=')-or!$source.Contains('$env:SV_MEDICAO_ATUALIZACAO=Exportar-MedicaoAtualizacao')){throw 'Marcos reais da atualizacao nao instrumentados.'}
 # A central continua decidindo pelo resultado real, nunca pelas linhas de tempo.
 . (Join-Path $PSScriptRoot 'central-logica.ps1')
 $opMedicao=Join-Path $pastaMedicao 'operacao';New-Item -ItemType Directory $opMedicao|Out-Null
 $saidaProcesso=Join-Path $opMedicao 'atualizacao-processo-saida.log'
 [IO.File]::WriteAllText($saidaProcesso,'Nada a fazer')
 $r=Executar-AcaoCentral $PSScriptRoot $pastaMedicao '' 'fim-atualizacao' @{codigo=0}
 if(!$r.ok-or$r.mensagem-notlike'*versao mais recente*'){throw 'Central perdeu resultado sem atualizacao.'}
 [IO.File]::WriteAllText($saidaProcesso,'suite reprovada')
 [IO.File]::WriteAllText((Join-Path $opMedicao 'atualizacao-saida.log'),'[2026-10-13 12:00:00] Resumo atualizacao: total=12 s')
 $r=Executar-AcaoCentral $PSScriptRoot $pastaMedicao '' 'fim-atualizacao' @{codigo=1}
 if($r.ok-or$r.mensagem-notlike'*suite reprovada*'){throw 'Central ocultou falha real com arquivo de tempos.'}
 # Avisos em stderr nao mudam o resultado real.
 $avisos=@('INEFFECTIVE_DYNAMIC_IMPORT: aviso de build','PLUGIN_TIMINGS: aviso de build','npm warn install-scripts aviso')
 [IO.File]::WriteAllLines((Join-Path $opMedicao 'atualizacao-erro.log'),$avisos)
 [IO.File]::WriteAllText($saidaProcesso,'=== Atualizado: 0bd5245 -> ddf9939 ===')
 $r=Executar-AcaoCentral $PSScriptRoot $pastaMedicao '' 'fim-atualizacao' @{codigo=0}
 if(!$r.ok){throw 'Avisos em stderr converteram conclusao real em falha.'}
 $r=Executar-AcaoCentral $PSScriptRoot $pastaMedicao '' 'fim-atualizacao' @{codigo=$null}
 if(!$r.ok){throw 'Marcador valido nao resgatou ExitCode indisponivel.'}
 $r=Executar-AcaoCentral $PSScriptRoot $pastaMedicao '' 'fim-atualizacao' @{codigo=1}
 if($r.ok){throw 'Marcador ocultou codigo de falha explicito.'}
 [IO.File]::WriteAllText($saidaProcesso,'suite reprovada')
 [IO.File]::WriteAllLines((Join-Path $opMedicao 'atualizacao-erro.log'),(@('ERRO REAL: build falhou')+$avisos+$avisos+$avisos))
 $r=Executar-AcaoCentral $PSScriptRoot $pastaMedicao '' 'fim-atualizacao' @{codigo=1}
 if($r.ok-or$r.mensagem-notlike'*ERRO REAL*'-or$r.mensagem-match'INEFFECTIVE_DYNAMIC_IMPORT|PLUGIN_TIMINGS|npm warn'){throw 'Central nao filtrou avisos antes de selecionar erros reais.'}
 [IO.File]::WriteAllText($saidaProcesso,'apenas etapa intermediaria')
 $r=Executar-AcaoCentral $PSScriptRoot $pastaMedicao '' 'fim-atualizacao' @{codigo=0}
 if($r.ok){throw 'Codigo zero sem conclusao foi aprovado.'}
 # Central antiga inicia stdout legado; apos checkout worker usa logica nova.
 [IO.File]::WriteAllText($saidaProcesso,'captura antiga sem conclusao')
 [IO.File]::SetLastWriteTimeUtc($saidaProcesso,[datetime]::UtcNow.AddMinutes(-1))
 $saidaLegada=Join-Path $opMedicao 'atualizacao-saida.log'
 [IO.File]::WriteAllText($saidaLegada,'=== Atualizado: 0bd5245 -> ddf9939 ===')
 $r=Executar-AcaoCentral $PSScriptRoot $pastaMedicao '' 'fim-atualizacao' @{codigo=$null}
 if(!$r.ok){throw 'Central antiga perdeu captura apos trocar codigo.'}
 $r=Executar-AcaoCentral $PSScriptRoot $pastaMedicao '' 'fim-atualizacao' @{codigo=0;saida='atualizacao-processo-saida.log'}
 if($r.ok){throw 'Central nova aceitou marcador legado de execucao anterior.'}
 # Central G0 sem metadado: tempos do pai nao substituem stdout novo.
 [IO.File]::WriteAllText($saidaProcesso,'=== Atualizado: 0bd5245 -> ddf9939 ===')
 [IO.File]::SetLastWriteTimeUtc($saidaProcesso,[datetime]::UtcNow.AddMinutes(-1))
 [IO.File]::WriteAllText($saidaLegada,'[2026-10-13 12:00:00] Resumo atualizacao: total=12 s')
 $r=Executar-AcaoCentral $PSScriptRoot $pastaMedicao '' 'fim-atualizacao' @{codigo=$null}
 if(!$r.ok){throw 'Tempos do pai G0 esconderam conclusao do filho novo.'}
 Write-Host 'Medicao: etapas, duracao, reexecucao, resumo unico, falhas e central aprovados.'
}finally{Remove-Item -LiteralPath $pastaMedicao -Recurse -Force -ErrorAction SilentlyContinue}
