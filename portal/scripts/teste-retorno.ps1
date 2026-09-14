# Executa o bloco real de troca com servidor simulado e pastas descartaveis.
$ErrorActionPreference = 'Stop'
$tokens=$null; $erros=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'atualizar-portal.ps1'),[ref]$tokens,[ref]$erros)
if ($erros) { throw $erros }
$bloco=$ast.FindAll({param($n) $n -is [Management.Automation.Language.TryStatementAst] -and $n.Extent.Text.Contains('Move-Item -LiteralPath $atual -Destination $anterior')},$true) | Sort-Object { $_.Extent.Text.Length } | Select-Object -First 1
if (-not $bloco) { throw 'Bloco real de troca nao encontrado' }
$trabalho=Join-Path ([IO.Path]::GetTempPath()) ('portal-retorno-'+[Guid]::NewGuid().ToString('N'))
$projeto=$trabalho
$atual=Join-Path $trabalho 'dist'; $anterior=Join-Path $trabalho 'anterior'; $candidato=Join-Path $trabalho 'fonte'; $pausa=Join-Path $trabalho '.portal-pausado'
New-Item -ItemType Directory -Path $atual,(Join-Path $candidato 'dist') -Force | Out-Null
New-Item -ItemType File -Path (Join-Path $atual 'antigo.txt') -Value 'anterior' | Out-Null
New-Item -ItemType File -Path (Join-Path $candidato 'dist\novo.txt') -Value 'candidato' | Out-Null
$pausadoAntes=$false; $trocou=$false; $script:inicios=0
function Parar {}
function Iniciar { $script:inicios++; if($script:inicios -eq 1){throw 'falha simulada na pagina candidata'} }
$falhou=$false
try { . ([scriptblock]::Create($bloco.Extent.Text)) } catch { if($_ -notmatch 'falha simulada'){throw}; $falhou=$true }
if(-not $falhou -or $script:inicios -ne 2 -or -not (Test-Path (Join-Path $atual 'antigo.txt')) -or -not (Test-Path (Join-Path $trabalho 'reprovado\novo.txt'))){throw 'Retorno nao preservou o build anterior'}
Write-Host 'OK: falha da candidata restaura o build anterior e tenta inicia-lo.'
# Conteudo minimo retido na pasta temporaria para inspecao; nenhum banco e usado.
