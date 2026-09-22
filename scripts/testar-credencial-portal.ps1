# Confere as duas guardas da credencial interna do Portal, usando as funcoes
# reais do validar-operacao.ps1 num diretorio de mentira.
$ErrorActionPreference = 'Stop'
$fonte = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'validar-operacao.ps1') -Raw
$inicio = $fonte.IndexOf('function Chaves-Repetidas')
$fim = $fonte.IndexOf('Chaves-Repetidas $portalEnv')
if ($inicio -lt 0 -or $fim -le $inicio) { throw 'Funcao de chaves repetidas nao encontrada no validador.' }

$erros = [Collections.Generic.List[string]]::new()
function Falha([string]$m) { $erros.Add($m) }
. ([scriptblock]::Create($fonte.Substring($inicio, $fim - $inicio)))

$temp = Join-Path ([IO.Path]::GetTempPath()) ('sv-credencial-' + [guid]::NewGuid().ToString('N'))
try {
  New-Item -ItemType Directory -Force $temp | Out-Null
  $arq = Join-Path $temp 'portal.env'

  Set-Content -LiteralPath $arq -Value @('PORTAL_URL=http://x:3000', 'PORTAL_API_TOKEN=aaa')
  Chaves-Repetidas $arq
  if ($erros.Count) { throw "Arquivo correto foi reprovado: $($erros -join '; ')" }
  Write-Host '[OK] arquivo sem repeticao passa'

  Set-Content -LiteralPath $arq -Value @('PORTAL_API_TOKEN=aaa', 'PORTAL_URL=http://x:3000', 'PORTAL_API_TOKEN=bbb')
  Chaves-Repetidas $arq
  if (($erros -join ' ') -notlike '*PORTAL_API_TOKEN*') { throw 'Chave repetida com valores diferentes nao foi denunciada.' }
  if ($erros.Count -ne 1) { throw "Esperava um erro, vieram $($erros.Count)." }
  Write-Host '[OK] chave repetida com valores diferentes e denunciada'

  $erros.Clear()
  Set-Content -LiteralPath $arq -Value @('PORTAL_API_TOKEN=aaa', 'PORTAL_API_TOKEN=aaa')
  Chaves-Repetidas $arq
  if ($erros.Count) { throw 'Linha repetida com o MESMO valor nao deveria reprovar.' }
  Write-Host '[OK] repeticao com valor identico nao reprova'
} finally {
  Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}

# A conferencia entre o token do arquivo e o token compilado e o que apanha
# "trocou a credencial e nao recompilou"; se sair do validador, o sintoma volta
# a ser um 401 no meio do pipeline.
if ($fonte -notmatch 'nao esta no Portal compilado') {
  throw 'O validador nao confere mais o token contra o Portal compilado.'
}
Write-Host '[OK] validador confere o token contra o bundle'
Write-Host 'Credencial do Portal: 4 conferencias aprovadas.' -ForegroundColor Green
