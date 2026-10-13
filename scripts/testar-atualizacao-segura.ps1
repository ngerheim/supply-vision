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

# Medicao real do atualizador com relogio fixo e pasta descartavel.
$inicioFuncoes=$source.IndexOf('# Medicao sem dados')
$fimFuncoes=$source.IndexOf('$medicaoEnvAnterior=',$inicioFuncoes)
if($inicioFuncoes-lt0-or$fimFuncoes-le$inicioFuncoes){throw 'Funcoes de medicao nao encontradas.'}
. ([scriptblock]::Create($source.Substring($inicioFuncoes,$fimFuncoes-$inicioFuncoes)))
$pastaMedicao=Join-Path ([IO.Path]::GetTempPath()) ('sv-medicao-'+[guid]::NewGuid().ToString('N'))
try{
 $script:horaMedicao=[datetime]'2026-01-01T12:00:00Z'
 $arquivoMedicao=Join-Path $pastaMedicao 'atualizacao-saida.log'
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
 if($centralFonte.Contains("'atualizacao-saida.log'")){throw 'Central disputa arquivo de medicao com o atualizador.'}
 if(!$source.Contains('$script:MedicaoAtualizacao.health=')-or!$source.Contains('$script:MedicaoAtualizacao.parada=')-or!$source.Contains('$env:SV_MEDICAO_ATUALIZACAO=Exportar-MedicaoAtualizacao')){throw 'Marcos reais da atualizacao nao instrumentados.'}
 # A central continua decidindo pelo resultado real, nunca pelas linhas de tempo.
 . (Join-Path $PSScriptRoot 'central-logica.ps1')
 $opMedicao=Join-Path $pastaMedicao 'operacao';New-Item -ItemType Directory $opMedicao|Out-Null
 $saidaProcesso=Join-Path $opMedicao 'atualizacao-processo-saida.log'
 [IO.File]::WriteAllText($saidaProcesso,'Nada a fazer')
 $r=Executar-AcaoCentral $PSScriptRoot $pastaMedicao '' 'fim-atualizacao' @{codigo=0}
 if(!$r.ok-or$r.mensagem-notlike'*versao mais recente*'){throw 'Central perdeu resultado sem atualizacao.'}
 [IO.File]::WriteAllText($saidaProcesso,'suite reprovada')
 [IO.File]::WriteAllText((Join-Path $opMedicao 'atualizacao-saida.log'),'=== Atualizado: exemplo ===')
 $r=Executar-AcaoCentral $PSScriptRoot $pastaMedicao '' 'fim-atualizacao' @{codigo=1}
 if($r.ok-or$r.mensagem-notlike'*suite reprovada*'){throw 'Central ocultou falha real com arquivo de tempos.'}
 Write-Host 'Medicao: etapas, duracao, reexecucao, resumo unico, falhas e central aprovados.'
}finally{Remove-Item -LiteralPath $pastaMedicao -Recurse -Force -ErrorAction SilentlyContinue}
