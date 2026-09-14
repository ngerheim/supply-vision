# Teste de fumaca do Portal Suprimentos.
# Verifica login e as rotas criticas. Existe porque, nesta semana, quatro
# defeitos passaram pelo typecheck limpo e so apareceram em execucao:
# labelFn quebrando telas, bootstrap 500 por coluna ausente, preco vazio
# virando cortesia e o vinext derrubando toda a API.
#
# Uso:  powershell -File scripts\teste-fumaca.ps1
# Saida: codigo 0 se tudo passou, 1 se algo falhou.

param(
  [string]$BaseUrl = 'http://localhost:3000',
  [string]$Email   = $env:PORTAL_TESTE_EMAIL,
  [string]$Senha   = $env:PORTAL_TESTE_SENHA
)

$ErrorActionPreference = 'SilentlyContinue'
$script:ok = 0; $script:falhou = 0

function Verifica($nome, [scriptblock]$teste) {
  try {
    $resultado = & $teste
    if ($resultado -eq $true) { $script:ok++; Write-Host "  [OK]    $nome" -ForegroundColor Green }
    else { $script:falhou++; Write-Host "  [FALHA] $nome  ->  $resultado" -ForegroundColor Red }
  } catch {
    $script:falhou++; Write-Host "  [FALHA] $nome  ->  $($_.Exception.Message)" -ForegroundColor Red
  }
}

if (-not $Email -or -not $Senha) {
  Write-Host ''
  Write-Host '  Defina as credenciais antes de rodar:' -ForegroundColor Yellow
  Write-Host '    $env:PORTAL_TESTE_EMAIL = "seu.email@example.com"'
  Write-Host '    $env:PORTAL_TESTE_SENHA = "sua senha"'
  Write-Host ''
  exit 2
}

Write-Host ''
Write-Host '  TESTE DE FUMACA - Portal Suprimentos' -ForegroundColor Cyan
Write-Host '  ------------------------------------'

Verifica 'Portal responde' {
  $r = Invoke-WebRequest $BaseUrl -UseBasicParsing -TimeoutSec 20
  if ($r.StatusCode -eq 200) { $true } else { "HTTP $($r.StatusCode)" }
}

Verifica 'Rota protegida exige sessao' {
  try { Invoke-WebRequest "$BaseUrl/api/bootstrap" -UseBasicParsing -TimeoutSec 20 | Out-Null; 'respondeu sem login' }
  catch { if ($_.Exception.Response.StatusCode.value__ -eq 401) { $true } else { "esperado 401, veio $($_.Exception.Response.StatusCode.value__)" } }
}

Verifica 'Senha errada e recusada' {
  try { Invoke-WebRequest "$BaseUrl/api/login" -Method POST -Body '{"email":"nao@existe.com","password":"errada"}' -ContentType 'application/json' -UseBasicParsing -TimeoutSec 30 | Out-Null; 'aceitou senha errada' }
  catch { if ($_.Exception.Response.StatusCode.value__ -eq 401) { $true } else { "esperado 401, veio $($_.Exception.Response.StatusCode.value__)" } }
}

$corpo = @{ email = $Email; password = $Senha } | ConvertTo-Json
$sessao = $null
Verifica 'Login com credencial valida' {
  $r = Invoke-WebRequest "$BaseUrl/api/login" -Method POST -Body $corpo -ContentType 'application/json' -SessionVariable s -UseBasicParsing -TimeoutSec 60
  $script:sessao = $s
  if ($r.StatusCode -eq 200) { $true } else { "HTTP $($r.StatusCode)" }
}

if (-not $script:sessao) {
  Write-Host ''
  Write-Host '  Login falhou; as demais verificacoes foram puladas.' -ForegroundColor Red
  Write-Host ''
  exit 1
}

# O bootstrap ja quebrou por coluna ausente no banco: vale conferir o conteudo,
# nao apenas o codigo HTTP.
Verifica 'Bootstrap devolve estrutura completa' {
  $b = (Invoke-WebRequest "$BaseUrl/api/bootstrap" -WebSession $script:sessao -UseBasicParsing -TimeoutSec 90).Content | ConvertFrom-Json
  $faltando = @()
  foreach ($campo in 'user','metrics','agreements','catalogs') { if ($null -eq $b.$campo) { $faltando += $campo } }
  foreach ($campo in 'suppliers','items','models','units','brands','locations') { if ($null -eq $b.catalogs.$campo) { $faltando += "catalogs.$campo" } }
  if ($faltando.Count -eq 0) { $true } else { "faltando: $($faltando -join ', ')" }
}

foreach ($rota in '/api/search','/api/tickets','/api/audit','/api/users','/api/imports') {
  Verifica "GET $rota" {
    $r = Invoke-WebRequest "$BaseUrl$rota" -WebSession $script:sessao -UseBasicParsing -TimeoutSec 90
    if ($r.StatusCode -eq 200) { $true } else { "HTTP $($r.StatusCode)" }
  }.GetNewClosure()
}

Verifica 'Busca devolve total e paginacao' {
  $x = (Invoke-WebRequest "$BaseUrl/api/search" -WebSession $script:sessao -UseBasicParsing -TimeoutSec 90).Content | ConvertFrom-Json
  if ($null -ne $x.total -and $null -ne $x.rows) { $true } else { 'resposta sem total ou rows' }
}

Verifica 'Historico pagina de 50 em 50' {
  $x = (Invoke-WebRequest "$BaseUrl/api/audit?page=1" -WebSession $script:sessao -UseBasicParsing -TimeoutSec 90).Content | ConvertFrom-Json
  if ($x.pageSize -eq 50 -and $null -ne $x.pageCount) { $true } else { "pageSize=$($x.pageSize)" }
}

# SOMENTE LEITURA. A versao anterior criava um chamado a cada execucao e
# deixou 8 registros de teste na base real. A validacao de escrita rejeitada
# confirma que a rota existe e valida a entrada, sem gravar nada.
Verifica 'Rota de escrita valida a entrada sem gravar' {
  try {
    Invoke-WebRequest "$BaseUrl/api/tickets" -Method POST -Body '{"supplierName":""}' -ContentType 'application/json' -WebSession $script:sessao -UseBasicParsing -TimeoutSec 60 | Out-Null
    'aceitou chamado sem fornecedor'
  } catch {
    if ($_.Exception.Response.StatusCode.value__ -eq 400) { $true } else { "esperado 400, veio $($_.Exception.Response.StatusCode.value__)" }
  }
}

# Arquivos do projeto nao podem ser servidos: ja vazaram os e-mails dos usuarios.
foreach ($caminho in '/DOCUMENTACAO.md','/DOCUMENTACAO.md::$DATA','/package.json','/vite.config.ts') {
  Verifica "Bloqueado: $caminho" {
    try { $r = Invoke-WebRequest "$BaseUrl$caminho" -UseBasicParsing -TimeoutSec 20; "VAZANDO ($($r.Content.Length) bytes)" }
    catch {
      $codigo = $_.Exception.Response.StatusCode.value__
      # 403 no servidor de desenvolvimento (bloqueado por server.fs.deny) e
      # 404 na versao compilada, que simplesmente nao serve a arvore do
      # projeto. O 404 e mais seguro: o arquivo nem existe para o servidor.
      # O que reprova e o arquivo VIR (200), ou nao haver resposta.
      if ($codigo -eq 403 -or $codigo -eq 404) { $true }
      else { "esperado 403 ou 404, veio $(if ($codigo) { $codigo } else { 'falha de conexao' })" }
    }
  }.GetNewClosure()
}

Verifica 'Cabecalhos de seguranca presentes' {
  $h = (Invoke-WebRequest $BaseUrl -UseBasicParsing -TimeoutSec 30).Headers
  $faltando = @()
  foreach ($n in 'Content-Security-Policy','X-Frame-Options','X-Content-Type-Options','Referrer-Policy') { if (-not $h[$n]) { $faltando += $n } }
  if ($faltando.Count -eq 0) { $true } else { "faltando: $($faltando -join ', ')" }
}

# Encerra a sessao aberta por este teste; sem isso cada execucao deixa uma
# sessao pendurada no banco ate expirar.
if ($script:sessao) {
  try { Invoke-WebRequest "$BaseUrl/api/logout" -Method POST -WebSession $script:sessao -UseBasicParsing -TimeoutSec 30 | Out-Null } catch { }
}

Write-Host '  ------------------------------------'
if ($script:falhou -eq 0) { Write-Host "  $($script:ok) verificacoes, todas passaram." -ForegroundColor Green; Write-Host ''; exit 0 }
Write-Host "  $($script:ok) passaram, $($script:falhou) FALHARAM." -ForegroundColor Red
Write-Host ''
exit 1
