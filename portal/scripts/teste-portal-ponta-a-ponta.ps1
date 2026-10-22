# Teste de instalacao nova: banco vazio, criacao do administrador e login real.
#
# Complementa os testes das funcoes criptograficas com as rotas e o banco
# reais, incluindo os valores gravados durante a criacao do administrador.
#
# Sobe uma instancia descartavel em outra porta, com banco vazio, e exercita o
# caminho real. Nao encosta no banco de producao.

param([switch]$UsarBuildExistente, [string]$Relatorio, [ValidateRange(1024,65534)][int]$Porta = 3199)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../scripts/operacao-logica.ps1')
$projeto = Split-Path -Parent $PSScriptRoot
$env:PORTAL_TESTE_PORTA = [string]$Porta
$baseUrl = "http://127.0.0.1:$porta"
$temp = Join-Path $env:TEMP "portal-teste-$([guid]::NewGuid().ToString('N'))"
$senhaTeste = 'senha-de-teste-do-ci-1234'
$logServidor = Join-Path $temp 'servidor.log'
$logBuild = Join-Path $temp 'build.log'
$script:ok = 0; $script:falhou = 0

function Revisao-Chamado([string]$ChamadoId) {
  $detalhe = Invoke-WebRequest "$baseUrl/api/tickets/$ChamadoId" -WebSession $script:sessao -UseBasicParsing -TimeoutSec 60
  return ($detalhe.Content | ConvertFrom-Json).ticket.revision
}

function Verifica($nome, [scriptblock]$teste) {
  try {
    $r = & $teste
    if ($r -eq $true) { $script:ok++; Write-Host "  [OK]    $nome" -ForegroundColor Green }
    else { $script:falhou++; Write-Host "  [FALHA] $nome  ->  $r" -ForegroundColor Red }
  } catch { $script:falhou++; Write-Host "  [FALHA] $nome  ->  $($_.Exception.Message)" -ForegroundColor Red }
}

# Encerra SOMENTE o que este script iniciou. A versao anterior matava quem
# estivesse escutando na porta 3199, o que derrubaria um programa alheio que
# por acaso a estivesse usando -- e pior, o teste poderia ter se conectado a
# ele e reportado resultados de outro sistema.
$script:processoServidor = $null

function Encerrar {
  $ErrorActionPreference = 'SilentlyContinue'
  if ($script:processoServidor) {
    # /T encerra toda a arvore iniciada pelo teste.
    if(!$script:processoServidor.HasExited){
      [void](Executar-NativoOperacao 'taskkill.exe' @('/PID',[string]$script:processoServidor.Id,'/T','/F'))
    }
    $script:processoServidor.Dispose()
    $script:processoServidor = $null
  }
  # Rede de seguranca restrita a esta execucao: so processos cuja linha de
  # comando cita a pasta temporaria unica deste teste.
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like "*$temp*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  Start-Sleep -Seconds 2
  Remove-Item -LiteralPath $temp -Recurse -Force
  Remove-Item -LiteralPath $logServidor -Force
  Remove-Item -LiteralPath $logBuild -Force
}

Write-Host ''
Write-Host '  TESTE DE INSTALACAO NOVA' -ForegroundColor Cyan
Write-Host '  ------------------------'

# Se a porta ja estiver em uso, abortar. Prosseguir faria o teste conversar
# com outro programa e reportar o resultado dele como se fosse do portal.
if (Get-NetTCPConnection -LocalPort $porta -State Listen -ErrorAction SilentlyContinue) {
  Write-Host "  A porta $porta ja esta em uso. Feche o programa que a ocupa" -ForegroundColor Red
  Write-Host '  ou execute com -Porta e uma porta livre.' -ForegroundColor Red
  Write-Host ''
  exit 2
}

New-Item -ItemType Directory -Force -Path $temp | Out-Null
Write-Host "  banco descartavel: $temp" -ForegroundColor DarkGray

Set-Location $projeto
$env:NODE_ENV = 'development'

try {

if ($UsarBuildExistente) {
  if (-not (Test-Path -LiteralPath (Join-Path $projeto 'dist/server/index.js'))) {
    throw 'A compilacao existente nao foi encontrada.'
  }
  Write-Host '  Testando a compilacao existente; o codigo-fonte nao sera recompilado.' -ForegroundColor Yellow
} else {
Write-Host '  Compilando...' -ForegroundColor DarkGray
# Windows PowerShell trata avisos em stderr como erros quando redirecionados.
# O resultado do compilador e seu codigo de saida, nao a presenca de avisos.
$preferenciaAnterior = $ErrorActionPreference
try {
  $ErrorActionPreference = 'Continue'
  $resultadoBuild = Executar-NativoOperacao 'npm.cmd' @('run','build')
  $resultadoBuild.saida | Set-Content $logBuild
  $codigoBuild = $resultadoBuild.codigo
} finally { $ErrorActionPreference = $preferenciaAnterior }
if ($codigoBuild -ne 0) {
  Write-Host '  [FALHA] a compilacao nao passou.' -ForegroundColor Red
  Get-Content $logBuild -ErrorAction SilentlyContinue | Select-Object -Last 10
  exit 1
}

}

# A fixture autoriza criar banco apenas no diretorio descartavel.
$ambienteServidor = @{
  SUPPLY_VISION_PRIVADO = $temp
  MODO_ENSAIO = '1'
  PORTAL_CRIAR_BANCO = '1'
  PORTAL_PORTA = [string]$porta
  RELATORIOS_PORTA = [string]($porta + 1)
  INITIAL_ADMIN_PASSWORD = $senhaTeste
  PORTAL_API_TOKEN = 'relatorios-token-ci'
}
$ambienteAnterior = @{}
foreach ($nome in $ambienteServidor.Keys) {
  $ambienteAnterior[$nome] = [Environment]::GetEnvironmentVariable($nome, 'Process')
}
try {
  foreach ($nome in $ambienteServidor.Keys) {
    [Environment]::SetEnvironmentVariable($nome, $ambienteServidor[$nome], 'Process')
  }
  $script:processoServidor = Start-Process powershell.exe -ArgumentList '-NoProfile', '-Command', "node scripts/iniciar-portal.mjs local *> '$logServidor'" -WorkingDirectory $projeto -NoNewWindow -PassThru
  [void]$script:processoServidor.Handle
} finally {
  foreach ($nome in $ambienteAnterior.Keys) {
    [Environment]::SetEnvironmentVariable($nome, $ambienteAnterior[$nome], 'Process')
  }
}

$subiu = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 2
  try { if ((Invoke-WebRequest $baseUrl -UseBasicParsing -TimeoutSec 4).StatusCode -eq 200) { $subiu = $true; break } } catch { }
}
if (-not $subiu) {
  Write-Host '  [FALHA] a instancia de teste nao subiu.' -ForegroundColor Red
  Get-Content $logServidor -ErrorAction SilentlyContinue | Select-Object -Last 12
  Encerrar
  exit 1
}
Write-Host "  instancia no ar na porta $porta" -ForegroundColor DarkGray
Verifica 'Pagina completa entrega CSS e JavaScript validos' {
  & node (Join-Path $PSScriptRoot 'saude-completa.mjs') $baseUrl | Out-Host
  if ($LASTEXITCODE -eq 0) { $true } else { 'pagina incompleta' }
}
Write-Host ''

# Email reservado somente na base descartavel; hash/iteracoes reais preservados.
$bancoFixture=Localizar-BancoPortal (Split-Path $projeto) $temp -Obrigatorio
$prepararAdmin=@'
const fs=require('node:fs'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
const raiz=fs.realpathSync.native(process.argv[2]),arquivo=fs.realpathSync.native(process.argv[3]);
const relativa=path.relative(raiz,arquivo);
if(!raiz.includes('portal-teste-')||!relativa||relativa.startsWith('..')||path.isAbsolute(relativa))throw new Error('Banco fora da fixture');
const db=new DatabaseSync(arquivo);
try{db.exec('PRAGMA busy_timeout=5000');if(db.prepare('SELECT COUNT(*) n FROM users').get().n!==1)throw new Error('Exige base nova');db.prepare("UPDATE users SET email=? WHERE role='admin'").run('admin@portal.test')}finally{db.close()}
'@
$scriptAdmin=Join-Path $temp 'preparar-admin.cjs'
[IO.File]::WriteAllText($scriptAdmin,$prepararAdmin,(New-Object Text.UTF8Encoding($false)))
& node $scriptAdmin $temp $bancoFixture
if($LASTEXITCODE){throw 'Nao foi possivel preparar email reservado na base descartavel.'}
$emailSemente = 'admin@portal.test'

Verifica 'Primeiro login do administrador funciona' {
  $corpo = @{ email = $emailSemente; password = $senhaTeste } | ConvertTo-Json
  $r = Invoke-WebRequest "$baseUrl/api/login" -Method POST -Body $corpo -ContentType 'application/json' `
    -SessionVariable s -UseBasicParsing -TimeoutSec 60
  $script:sessao = $s
  $script:respostaLogin = $r
  if ($r.StatusCode -eq 200) { $true } else { "HTTP $($r.StatusCode)" }
}

Verifica 'Senha errada e recusada na instalacao nova' {
  try {
    Invoke-WebRequest "$baseUrl/api/login" -Method POST -Body '{"email":"admin@portal.test","password":"errada"}' `
      -ContentType 'application/json' -UseBasicParsing -TimeoutSec 60 | Out-Null
    'aceitou senha errada'
  } catch { if ($_.Exception.Response.StatusCode.value__ -eq 401) { $true } else { "veio $($_.Exception.Response.StatusCode.value__)" } }
}

Verifica 'Cookie com HttpOnly, SameSite=Strict e Path=/' {
  $sc = $script:respostaLogin.Headers['Set-Cookie']
  $faltando = @()
  if ($sc -notmatch 'HttpOnly') { $faltando += 'HttpOnly' }
  if ($sc -notmatch 'SameSite=strict') { $faltando += 'SameSite=Strict' }
  if ($sc -notmatch 'Path=/') { $faltando += 'Path=/' }
  if ($faltando.Count -eq 0) { $true } else { "faltando: $($faltando -join ', ')" }
}

Verifica 'Sessao autenticada acessa o bootstrap' {
  $b = (Invoke-WebRequest "$baseUrl/api/bootstrap" -WebSession $script:sessao -UseBasicParsing -TimeoutSec 60).Content | ConvertFrom-Json
  if ($b.user.role -eq 'admin') { $true } else { "perfil inesperado: $($b.user.role)" }
}

$admin=((Invoke-WebRequest "$baseUrl/api/users" -WebSession $script:sessao -UseBasicParsing -TimeoutSec 60).Content|ConvertFrom-Json).users|Where-Object {$_.email -eq 'admin@portal.test'}|Select-Object -First 1
Invoke-WebRequest "$baseUrl/api/users/$($admin.id)" -Method PUT -WebSession $script:sessao -ContentType 'application/json' -UseBasicParsing -TimeoutSec 60 -Body (@{dailyReportEnabled=$true;dailyReportTime='16:20';expectedRevision=$admin.revision}|ConvertTo-Json -Compress) | Out-Null
Verifica 'Administrador configura destinatario e horario do relatorio diario' {
  $lista=(Invoke-WebRequest "$baseUrl/api/users" -WebSession $script:sessao -UseBasicParsing -TimeoutSec 60).Content|ConvertFrom-Json
  $config=$lista.users|Where-Object {$_.id -eq $admin.id}|Select-Object -First 1
  if($config.dailyReportEnabled -eq 1 -and $config.dailyReportTime -eq '16:20'){$true}else{'preferencia nao foi persistida'}
}
Verifica 'Horario invalido do relatorio diario e recusado' {
  try{Invoke-WebRequest "$baseUrl/api/users/$($admin.id)" -Method PUT -WebSession $script:sessao -ContentType 'application/json' -UseBasicParsing -TimeoutSec 60 -Body '{"dailyReportTime":"25:90"}'|Out-Null;'aceitou horario invalido'}catch{if($_.Exception.Response.StatusCode.value__ -eq 400){$true}else{"veio $($_.Exception.Response.StatusCode.value__)"}}
}

# --- Fila de notificacoes dos chamados ---
$usuarioEmail = 'responsavel-email@teste.test'
$novoEmail = 'novo-responsavel-email@teste.test'
$u1 = (Invoke-WebRequest "$baseUrl/api/users" -Method POST -WebSession $script:sessao -ContentType 'application/json' -UseBasicParsing -TimeoutSec 60 `
  -Body (@{name='Responsavel Email';email=$usuarioEmail;password='senha-email-teste-123';role='editor'}|ConvertTo-Json)).Content|ConvertFrom-Json
$u2 = (Invoke-WebRequest "$baseUrl/api/users" -Method POST -WebSession $script:sessao -ContentType 'application/json' -UseBasicParsing -TimeoutSec 60 `
  -Body (@{name='Novo Responsavel Email';email=$novoEmail;password='senha-email-teste-456';role='editor'}|ConvertTo-Json)).Content|ConvertFrom-Json
$chamadoEmail = (Invoke-WebRequest "$baseUrl/api/tickets" -Method POST -WebSession $script:sessao -ContentType 'application/json' -UseBasicParsing -TimeoutSec 60 `
  -Body (@{supplierName='FORNECEDOR TESTE EMAIL';assignedTo=$u1.id;priority='alta';scope='Teste da fila'}|ConvertTo-Json)).Content|ConvertFrom-Json

# Central usa a mesma atribuicao, com sessoes reais de dois usuarios.
Verifica 'Central conta, lista, marca e isola notificacoes entre usuarios' {
  Invoke-WebRequest "$baseUrl/api/login" -Method POST -Body (@{email=$usuarioEmail;password='senha-email-teste-123'}|ConvertTo-Json) -ContentType 'application/json' -SessionVariable centralSessao -UseBasicParsing -TimeoutSec 60 | Out-Null
  $contagem=(Invoke-WebRequest "$baseUrl/api/central/nao-lidas" -WebSession $centralSessao -Headers @{'x-portal-poll'='1'} -UseBasicParsing -TimeoutSec 60).Content|ConvertFrom-Json
  $lista=(Invoke-WebRequest "$baseUrl/api/central" -WebSession $centralSessao -UseBasicParsing -TimeoutSec 60).Content|ConvertFrom-Json
  if($contagem.naoLidas -ne 1 -or @($lista.notificacoes).Count -ne 1){return 'contagem ou lista inesperada'}
  $n=$lista.notificacoes[0]
  if($n.link -ne "/?chamado=$($chamadoEmail.id)"){return 'link inesperado'}
  $proprias=(Invoke-WebRequest "$baseUrl/api/central" -WebSession $script:sessao -UseBasicParsing -TimeoutSec 60).Content|ConvertFrom-Json
  if(@($proprias.notificacoes).Count -ne 0){return 'autor recebeu notificacao propria'}
  foreach($metodo in @('GET','POST')) {
    $caminho="central/$($n.id)"
    if($metodo -eq 'POST'){$caminho+='/lida'}
    try { Invoke-WebRequest "$baseUrl/api/$caminho" -Method $metodo -WebSession $script:sessao -UseBasicParsing -TimeoutSec 60 | Out-Null; return 'outro usuario acessou notificacao' }
    catch { if($_.Exception.Response.StatusCode.value__ -ne 404){return 'isolamento nao retornou 404'} }
  }
  Invoke-WebRequest "$baseUrl/api/central/$($n.id)/lida" -Method POST -WebSession $centralSessao -UseBasicParsing -TimeoutSec 60 | Out-Null
  Invoke-WebRequest "$baseUrl/api/central/lidas" -Method POST -WebSession $centralSessao -UseBasicParsing -TimeoutSec 60 | Out-Null
  $depois=(Invoke-WebRequest "$baseUrl/api/central/nao-lidas" -WebSession $centralSessao -UseBasicParsing -TimeoutSec 60).Content|ConvertFrom-Json
  if($depois.naoLidas -eq 0){$true}else{'marcacao nao atualizou contagem'}
}

Verifica 'Primeiro chamado usa o codigo SUP-0001' {
  if ($chamadoEmail.code -eq 'SUP-0001') { $true } else { "codigo inesperado: $($chamadoEmail.code)" }
}

Verifica 'Criacao atribuida coloca um e-mail de atribuicao na fila' {
  $f=(Invoke-WebRequest "$baseUrl/api/email-notifications" -WebSession $script:sessao -UseBasicParsing -TimeoutSec 60).Content|ConvertFrom-Json
  $n=@($f.notifications|Where-Object {$_.ticketCode -eq $chamadoEmail.code})
  if($n.Count -eq 1 -and $n[0].type -eq 'atribuicao' -and $n[0].recipientEmail -eq $usuarioEmail){$true}else{"fila inesperada: $($n.Count)"}
}

Invoke-WebRequest "$baseUrl/api/tickets/$($chamadoEmail.id)" -Method PUT -WebSession $script:sessao -ContentType 'application/json' -UseBasicParsing -TimeoutSec 60 -Body (@{assignedTo=$u2.id;expectedRevision=(Revisao-Chamado $chamadoEmail.id)}|ConvertTo-Json)|Out-Null
Verifica 'Reatribuicao isolada avisa somente o novo responsavel' {
  $f=(Invoke-WebRequest "$baseUrl/api/email-notifications" -WebSession $script:sessao -UseBasicParsing -TimeoutSec 60).Content|ConvertFrom-Json
  $n=@($f.notifications|Where-Object {$_.ticketCode -eq $chamadoEmail.code -and $_.type -eq 'atribuicao'})
  if($n.Count -eq 2 -and @($n|Where-Object {$_.recipientEmail -eq $novoEmail}).Count -eq 1){$true}else{"atribuicoes: $($n.Count)"}
}

Invoke-WebRequest "$baseUrl/api/tickets/$($chamadoEmail.id)/events" -Method POST -WebSession $script:sessao -ContentType 'application/json' -UseBasicParsing -TimeoutSec 60 -Body '{"message":"Andamento de integracao"}'|Out-Null
Verifica 'Novo andamento avisa solicitante e responsavel' {
  $f=(Invoke-WebRequest "$baseUrl/api/email-notifications" -WebSession $script:sessao -UseBasicParsing -TimeoutSec 60).Content|ConvertFrom-Json
  $n=@($f.notifications|Where-Object {$_.ticketCode -eq $chamadoEmail.code -and $_.type -eq 'atualizacao'})
  if($n.Count -eq 2){$true}else{"atualizacoes: $($n.Count)"}
}

# A tela define a mensagem como opcional, inclusive na conclusao.
Verifica 'Conclusao aceita mensagem opcional' {
  try { Invoke-WebRequest "$baseUrl/api/tickets/$($chamadoEmail.id)" -Method PUT -WebSession $script:sessao -ContentType 'application/json' -UseBasicParsing -TimeoutSec 60 -Body (@{status='fechado';expectedRevision=(Revisao-Chamado $chamadoEmail.id)}|ConvertTo-Json)|Out-Null; $c=200 }
  catch { $c=[int]$_.Exception.Response.StatusCode.value__ }
  if($c -eq 200){$true}else{"esperado 200, veio $c"}
}
Invoke-WebRequest "$baseUrl/api/tickets/$($chamadoEmail.id)" -Method PUT -WebSession $script:sessao -ContentType 'application/json' -UseBasicParsing -TimeoutSec 60 -Body (@{status='fechado';statusMessage='Negociacao concluida';expectedRevision=(Revisao-Chamado $chamadoEmail.id)}|ConvertTo-Json)|Out-Null
Verifica 'Conclusao avisa solicitante e responsavel' {
  $f=(Invoke-WebRequest "$baseUrl/api/email-notifications" -WebSession $script:sessao -UseBasicParsing -TimeoutSec 60).Content|ConvertFrom-Json
  if(@($f.notifications|Where-Object {$_.ticketCode -eq $chamadoEmail.code -and $_.type -eq 'conclusao'}).Count -eq 2){$true}else{'conclusao nao gerou duas mensagens'}
}
Invoke-WebRequest "$baseUrl/api/tickets/$($chamadoEmail.id)" -Method PUT -WebSession $script:sessao -ContentType 'application/json' -UseBasicParsing -TimeoutSec 60 -Body (@{status='cancelado';statusMessage='Cancelado para teste';expectedRevision=(Revisao-Chamado $chamadoEmail.id)}|ConvertTo-Json)|Out-Null
Verifica 'Cancelamento avisa solicitante e responsavel' {
  $f=(Invoke-WebRequest "$baseUrl/api/email-notifications" -WebSession $script:sessao -UseBasicParsing -TimeoutSec 60).Content|ConvertFrom-Json
  if(@($f.notifications|Where-Object {$_.ticketCode -eq $chamadoEmail.code -and $_.type -eq 'cancelamento'}).Count -eq 2){$true}else{'cancelamento nao gerou duas mensagens'}
}

# Daqui em diante, confere o que foi realmente GRAVADO no banco novo.
$arquivoBanco = Localizar-BancoPortal (Split-Path $projeto) $temp -Obrigatorio

Verifica 'Banco descartavel foi criado' {
  if ($arquivoBanco) { $true } else { 'nenhum .sqlite encontrado na pasta temporaria' }
}

if ($arquivoBanco) {
  Verifica 'Sessao valida autentica e a mesma sessao vencida recebe 401' {
    & node (Join-Path $PSScriptRoot 'teste-sessao-vencida.mjs') $temp $arquivoBanco | Out-Host
    if ($LASTEXITCODE -eq 0) { $true } else { 'teste HTTP de expiracao falhou' }
  }
  $consulta = @'
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const u = db.prepare("SELECT * FROM users WHERE email='admin@portal.test'").get() || {};
const s = db.prepare('SELECT token FROM sessions LIMIT 1').get() || {};
console.log(JSON.stringify({
  iteracoes: u.password_iterations,
  temSalt: !!u.password_salt,
  hash: u.password_hash || '',
  perfil: u.role,
  colunas: db.prepare('PRAGMA table_info(users)').all().map(c => c.name),
  token: s.token || '',
  sessoes: db.prepare('SELECT COUNT(*) n FROM sessions').get().n,
}));
db.close();
'@
  $arqTmp = Join-Path $temp ('consulta-'+[guid]::NewGuid().ToString('N')+'.cjs')
  Set-Content -LiteralPath $arqTmp -Value $consulta -Encoding UTF8
  $dados = & node $arqTmp $arquivoBanco | ConvertFrom-Json
  Remove-Item $arqTmp -Force

  # Este e o teste que faltava: o bug do password_iterations gravava 120000
  # enquanto o hash era calculado com 600000, travando o primeiro login.
  Verifica 'Admin inicial gravado com 600.000 iteracoes' {
    if ($dados.iteracoes -eq 600000) { $true } else { "gravou $($dados.iteracoes)" }
  }

  Verifica 'Admin inicial tem salt e hash no formato correto' {
    if (-not $dados.temSalt) { return 'sem salt' }
    if ($dados.hash -notmatch '^[0-9a-f]{64}$') { return 'hash fora do formato' }
    $true
  }

  Verifica 'Admin inicial tem perfil de administrador' {
    if ($dados.perfil -eq 'admin') { $true } else { "perfil: $($dados.perfil)" }
  }

  Verifica 'Nenhuma coluna de senha em texto claro' {
    $suspeitas = $dados.colunas | Where-Object { $_ -in @('password', 'senha', 'plaintext') }
    if (-not $suspeitas) { $true } else { "colunas suspeitas: $($suspeitas -join ', ')" }
  }

  Verifica 'Senha de teste nao aparece no banco' {
    # O servidor mantem o arquivo aberto: le uma copia em vez do original.
    $copia = Join-Path $env:TEMP "leitura-$(Get-Random).sqlite"
    Copy-Item -LiteralPath $arquivoBanco -Destination $copia -Force -ErrorAction Stop
    try {
      $texto = [System.Text.Encoding]::ASCII.GetString([System.IO.File]::ReadAllBytes($copia))
      if ($texto.Contains($senhaTeste)) { 'a senha esta legivel dentro do arquivo!' } else { $true }
    } finally { Remove-Item -LiteralPath $copia -Force -ErrorAction SilentlyContinue }
  }

  Verifica 'Sessao guardada como hash, nao como o cookie' {
    if ($dados.sessoes -lt 1) { return 'nenhuma sessao gravada' }
    if ($dados.token -notmatch '^[0-9a-f]{64}$') { return 'token fora do formato de hash' }
    $cookie = ([regex]::Match($script:respostaLogin.Headers['Set-Cookie'], 'acordos_session=([^;]+)')).Groups[1].Value
    if ($cookie -and $dados.token -eq $cookie) { 'o banco guardou o proprio cookie' } else { $true }
  }

  Verifica 'Token copiado do banco nao autentica' {
    $falsa = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $falsa.Cookies.Add((New-Object System.Net.Cookie('acordos_session', $dados.token, '/', '127.0.0.1')))
    try {
      Invoke-WebRequest "$baseUrl/api/bootstrap" -WebSession $falsa -UseBasicParsing -TimeoutSec 30 | Out-Null
      'o hash do banco funcionou como cookie'
    } catch { if ($_.Exception.Response.StatusCode.value__ -eq 401) { $true } else { "veio $($_.Exception.Response.StatusCode.value__)" } }
  }
}

Verifica 'Logout encerra a sessao' {
  Invoke-WebRequest "$baseUrl/api/logout" -Method POST -WebSession $script:sessao -UseBasicParsing -TimeoutSec 30 | Out-Null
  try {
    Invoke-WebRequest "$baseUrl/api/bootstrap" -WebSession $script:sessao -UseBasicParsing -TimeoutSec 30 | Out-Null
    'a sessao continuou valendo apos o logout'
  } catch { if ($_.Exception.Response.StatusCode.value__ -eq 401) { $true } else { "veio $($_.Exception.Response.StatusCode.value__)" } }
}

# --- Limites de entrada, exercitados pelas rotas reais ---
# Reabre a sessao, encerrada no teste acima.
$corpoLogin = @{ email = $emailSemente; password = $senhaTeste } | ConvertTo-Json
Invoke-WebRequest "$baseUrl/api/login" -Method POST -Body $corpoLogin -ContentType 'application/json' `
  -SessionVariable s2 -UseBasicParsing -TimeoutSec 60 | Out-Null
$script:sessao = $s2

function CodigoDe([scriptblock]$chamada) {
  # O código HTTP fica em lugares diferentes conforme a versão do PowerShell:
  # o Windows PowerShell 5 usa Exception.Response.StatusCode.value__, o
  # PowerShell 7 às vezes traz StatusCode direto na exceção. Sem cobrir os dois
  # o helper devolvia vazio, e o teste imprimia "veio " sem dizer nada — que é
  # justamente o tipo de falha silenciosa que estes testes existem para evitar.
  try { return (& $chamada).StatusCode }
  catch {
    $e = $_.Exception
    if ($e.Response) {
      $s = $e.Response.StatusCode
      if ($null -ne $s.value__) { return [int]$s.value__ }
      if ($s -is [int]) { return [int]$s }
      if ($s) { return [int][System.Net.HttpStatusCode]$s }
    }
    if ($null -ne $_.TargetObject.StatusCode) { return [int]$_.TargetObject.StatusCode }
    # Sem código nenhum: devolve um diagnóstico legível em vez de vazio.
    return "SEM RESPOSTA HTTP [$($e.GetType().Name)] $($e.Message)"
  }
}

Verifica 'API entrega o build compilado' {
  $script:buildPortal = [string](Invoke-WebRequest "$baseUrl/api/health" -UseBasicParsing -TimeoutSec 30).Headers['x-portal-build']
  $script:buildPortal -match '^\d+\.\d+\.\d+\+[a-f0-9]{7,40}$'
}
Verifica 'Build errado recebe 409 e nao cria o item; sessao continua valida' {
  $antes = (Invoke-WebRequest "$baseUrl/api/bootstrap" -WebSession $script:sessao -UseBasicParsing -TimeoutSec 30).Content | ConvertFrom-Json
  $c = CodigoDe { Invoke-WebRequest "$baseUrl/api/catalogs/items" -Method POST -Body '{"name":"Item de build recusado"}' -ContentType 'application/json' -Headers @{'x-portal-build'='build-errado'} -WebSession $script:sessao -UseBasicParsing -TimeoutSec 30 }
  $depois = (Invoke-WebRequest "$baseUrl/api/bootstrap" -WebSession $script:sessao -Headers @{'x-portal-build'='build-errado'} -UseBasicParsing -TimeoutSec 30).Content | ConvertFrom-Json
  $c -eq 409 -and ($antes.catalogs.items | ConvertTo-Json -Depth 10 -Compress) -eq ($depois.catalogs.items | ConvertTo-Json -Depth 10 -Compress) -and $depois.user.id -eq $antes.user.id
}
Verifica 'Escrita com build igual funciona' {
  $c = CodigoDe { Invoke-WebRequest "$baseUrl/api/catalogs/items" -Method POST -Body '{"name":"Item de build atual"}' -ContentType 'application/json' -Headers @{'x-portal-build'=$script:buildPortal} -WebSession $script:sessao -UseBasicParsing -TimeoutSec 30 }
  $c -eq 201
}

Verifica 'Corpo JSON acima de 64 KB devolve 413' {
  $corpo = '{"name":"' + ('A' * 200000) + '"}'
  $c = CodigoDe { Invoke-WebRequest "$baseUrl/api/catalogs/models" -Method POST -Body $corpo -ContentType 'application/json' -WebSession $script:sessao -UseBasicParsing -TimeoutSec 60 }
  if ($c -eq 413) { $true } else { "esperado 413, veio $c" }
}

Verifica 'JSON invalido devolve 400, nao 500' {
  $c = CodigoDe { Invoke-WebRequest "$baseUrl/api/catalogs/models" -Method POST -Body '{quebrado' -ContentType 'application/json' -WebSession $script:sessao -UseBasicParsing -TimeoutSec 30 }
  if ($c -eq 400) { $true } else { "esperado 400, veio $c" }
}

Verifica 'Campo acima do limite devolve 400' {
  $corpo = '{"name":"' + ('N' * 500) + '"}'
  $c = CodigoDe { Invoke-WebRequest "$baseUrl/api/catalogs/models" -Method POST -Body $corpo -ContentType 'application/json' -WebSession $script:sessao -UseBasicParsing -TimeoutSec 30 }
  if ($c -eq 400) { $true } else { "esperado 400, veio $c" }
}

Verifica 'Campo no limite com acentos e aceito' {
  # 120 cedilhas: 120 caracteres, 240 bytes. Contar bytes recusaria.
  $corpo = '{"name":"' + ('ç' * 120) + '"}'
  $c = CodigoDe { Invoke-WebRequest "$baseUrl/api/catalogs/models" -Method POST -Body $corpo -ContentType 'application/json' -WebSession $script:sessao -UseBasicParsing -TimeoutSec 30 }
  if ($c -eq 201) { $true } else { "esperado 201, veio $c" }
}

Verifica 'Rota antiga de carga inicial permanece bloqueada' {
  $c = CodigoDe { Invoke-WebRequest "$baseUrl/api/imports/legacy" -Method POST -Body '{"nao":"e multipart"}' -ContentType 'application/json' -WebSession $script:sessao -UseBasicParsing -TimeoutSec 30 }
  if ($c -eq 404) { $true } else { "esperado 404, veio $c" }
}

Verifica 'Login com corpo muito acima do limite e recusado' {
  # NOME CORRIGIDO. A versao anterior se chamava "sem Content-Length correto",
  # mas o Invoke-WebRequest sempre calcula o cabecalho certo -- o teste nunca
  # exercitou esse caminho. O caso real (chunked, sem Content-Length) esta em
  # scripts/teste-http-fluxo.mjs, que escreve no socket em pedacos.
  $corpo = '{"email":"a@example.com","password":"' + ('P' * 50000) + '"}'
  $c = CodigoDe { Invoke-WebRequest "$baseUrl/api/login" -Method POST -Body $corpo -ContentType 'application/json' -UseBasicParsing -TimeoutSec 30 }
  # 401 generico e proposital no login: nao revela o motivo da recusa.
  if ($c -eq 401 -or $c -eq 413) { $true } else { "esperado 401 ou 413, veio $c" }
}

# O cliente de baixo nivel so recebe autorizacao para apontar para esta
# instancia descartavel. Ele recusa a porta 3000 e a ausencia desta marca.
$cookieFluxo = $script:sessao.Cookies.GetCookies($baseUrl)['acordos_session'].Value
$env:PORTAL_TESTE_COOKIE = "acordos_session=$cookieFluxo"
$env:PORTAL_TESTE_PORTA = [string]$porta
$env:PORTAL_TESTE_DESCARTAVEL = 'SIM'
Verifica 'Fornecedor obrigatorio e mensagem de situacao preservada' {
  & node (Join-Path $PSScriptRoot 'teste-cadastro-chamado.mjs') | Out-Host
  $LASTEXITCODE -eq 0
}
Verifica 'Exclusoes respeitam a trava de uma operacao concorrente' {
  & node (Join-Path $PSScriptRoot 'teste-exclusao-concorrente.mjs') $temp $arquivoBanco | Out-Host
  $codigoTeste=$LASTEXITCODE
  if($codigoTeste -ne 0){Start-Sleep -Seconds 2; Get-Content $logServidor | Select-String -Pattern 'erro nao tratado' -Context 0,15 | Out-Host}
  $codigoTeste -eq 0
}
Verifica 'Health repetido em ociosidade continua consultando o banco' {
  & node (Join-Path $PSScriptRoot 'teste-health-repetido.mjs') | Out-Host
  $LASTEXITCODE -eq 0
}
Verifica 'Health e opcoes funcionam durante escrita SQLite externa' {
  & node (Join-Path $PSScriptRoot 'teste-sqlite-local-concorrente.mjs') $temp $arquivoBanco | Out-Host
  $LASTEXITCODE -eq 0
}
Verifica 'Falhas de banco retornam 500 sem expor detalhes nem gravar parcialmente' {
  & node (Join-Path $PSScriptRoot 'teste-erros-banco.mjs') $temp $arquivoBanco | Out-Host
  $LASTEXITCODE -eq 0
}
Verifica 'Relatorios e perfis respeitam fila, idempotencia e acesso' {
  & node (Join-Path $PSScriptRoot 'teste-relatorios-perfis.mjs') $temp $arquivoBanco | Out-Host
  $codigoTeste=$LASTEXITCODE
  if($codigoTeste-ne0){Start-Sleep -Seconds 2;Get-Content $logServidor | Select-String -Pattern 'download indisponivel' -Context 0,15 | Out-Host}
  $codigoTeste -eq 0
}
Verifica 'Cadastro de fornecedor usa consulta ficticia e respeita fluxo e posse do viewer' {
  & node (Join-Path $PSScriptRoot 'teste-solicitacoes.mjs') $temp $arquivoBanco | Out-Host
  $LASTEXITCODE -eq 0
}
& node (Join-Path $PSScriptRoot 'teste-http-fluxo.mjs')
$codigoFluxo = $LASTEXITCODE
Remove-Item Env:PORTAL_TESTE_COOKIE, Env:PORTAL_TESTE_PORTA, Env:PORTAL_TESTE_DESCARTAVEL -ErrorAction SilentlyContinue
if ($codigoFluxo -eq 0) {
  $script:ok++
  Write-Host '  [OK]    Testes HTTP em fluxo rodaram somente na instalacao descartavel' -ForegroundColor Green
} else {
  $script:falhou++
  Write-Host "  [FALHA] Testes HTTP em fluxo  ->  codigo $codigoFluxo" -ForegroundColor Red
  Write-Host '  Ultimas linhas do servidor descartavel:' -ForegroundColor DarkGray
  Get-Content $logServidor -ErrorAction SilentlyContinue | Select-Object -Last 30
}

Write-Host ''
Write-Host '  ------------------------'
if ($script:falhou -eq 0) {
  if ($Relatorio) { @{ sucesso=$true; verificacoes=$script:ok } | ConvertTo-Json | Set-Content -LiteralPath $Relatorio -Encoding UTF8 }
  Write-Host "  $($script:ok) verificacoes, todas passaram." -ForegroundColor Green
  Write-Host ''
  exit 0
}
Write-Host "  $($script:ok) passaram, $($script:falhou) FALHARAM." -ForegroundColor Red
Write-Host ''
exit 1

}
catch {
  Write-Host "[FALHA] Teste interrompido: $($_.Exception.Message)" -ForegroundColor Red
  Get-Content $logServidor -ErrorAction SilentlyContinue | Select-Object -Last 35 | Out-Host
  exit 1
}
finally {
  # Roda mesmo se o script for interrompido no meio (Ctrl+C ou erro).
  Encerrar
}
