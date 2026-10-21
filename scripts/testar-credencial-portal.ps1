param([switch]$ExigirBuild)
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

  Set-Content -LiteralPath $arq -Value @('PORTAL_URL=http://x.test:3000', 'PORTAL_API_TOKEN=aaa')
  Chaves-Repetidas $arq
  if ($erros.Count) { throw "Arquivo correto foi reprovado: $($erros -join '; ')" }
  Write-Host '[OK] arquivo sem repeticao passa'

  Set-Content -LiteralPath $arq -Value @('PORTAL_API_TOKEN=aaa', 'PORTAL_URL=http://x.test:3000', 'PORTAL_API_TOKEN=bbb')
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

# A rota importa a configuracao do servidor, que resolve o token na partida.
$configuracao = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../portal/scripts/configuracao-servidor.mjs') -Raw
$iniciar = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../portal/scripts/iniciar-portal.mjs') -Raw
$rota = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../portal/app/api/[...path]/route.ts') -Raw
$leitor = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../portal/scripts/configuracao.mjs') -Raw
function Testar-CadeiaCredencial([string]$Servidor,[string]$Leitor,[string]$Inicio) {
  return ($Servidor -match "'PORTAL_API_TOKEN'" -and
    $Servidor -match "import\s*\{\s*lerConfigEfetiva\s*\}\s*from\s*'\./configuracao\.mjs'" -and
    $Servidor -match 'config\s*=\s*lerConfigEfetiva\(\)' -and
    $Servidor -match 'export const env\s*=\s*configuracaoServidor\(\)' -and
    $Leitor -match 'function lerConfigEfetiva\(config\s*=\s*lerConfigBruta\(\),\s*ambiente\s*=\s*process\.env\)\s*\{\s*return\s*\{\s*\.\.\.config,\s*\.\.\.ambiente\s*\}' -and
    $Inicio -match 'configuracaoServidor\(config\)')
}
if (!(Testar-CadeiaCredencial $configuracao $leitor $iniciar)) {
  throw 'O servidor nao resolve a credencial em tempo de execucao.'
}
# A guarda tambem deve reprovar a retirada do ambiente ou de qualquer chamada.
foreach($caso in @(
  @($configuracao.Replace('config = lerConfigEfetiva()', 'config = {}'), $leitor, $iniciar),
  @($configuracao, $leitor.Replace('process.env', '{}'), $iniciar),
  @($configuracao, $leitor.Replace('...config, ...ambiente', '...config'), $iniciar),
  @($configuracao, $leitor, $iniciar.Replace('configuracaoServidor(config)', 'configuracaoServidor({})'))
)) {
  if(Testar-CadeiaCredencial $caso[0] $caso[1] $caso[2]) { throw 'A guarda aceitou uma cadeia sem credencial de tempo de execucao.' }
}
Write-Host '[OK] guarda recusa cadeia sem leitor efetivo, ambiente, mesclagem ou chamada da partida'
if ($rota -notmatch 'configuracao-servidor.mjs' -or $rota -notmatch 'PORTAL_API_TOKEN' -or $rota -match '__PORTAL_API_TOKEN__') {
  throw 'A rota interna deixou de usar a configuracao do servidor.'
}
Write-Host '[OK] credencial resolvida e lida em tempo de execucao'
$dist=Join-Path $PSScriptRoot '../portal/dist'
if (Test-Path -LiteralPath $dist) {
  # O build do CI recebe esta sentinela; nenhuma parte de dist pode conte-la.
  $sentinela='token-ficticio-build-proibido-170'
  $arquivos=@(Get-ChildItem -LiteralPath $dist -Recurse -File)
  if(!$arquivos.Count){throw 'Build vazio; nao foi possivel conferir a credencial.'}
  foreach($arquivo in $arquivos){
    if([Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($arquivo.FullName)).Contains($sentinela)){throw 'Credencial de build encontrada em dist.'}
  }
  Write-Host "[OK] sentinela ausente dos $($arquivos.Count) arquivos de dist"
}elseif($ExigirBuild){throw 'Build obrigatorio ausente para conferir a credencial.'}
else{Write-Host 'PULADO: varredura dist exige build; o job Portal a executa depois de compilar com a sentinela.'}

. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
$temp=Join-Path ([IO.Path]::GetTempPath()) ('sv-token-'+[guid]::NewGuid().ToString('N'))
try {
 New-Item -ItemType Directory $temp|Out-Null
 $arquivo=Join-Path $temp 'portal.env'
 foreach($valor in @('',('Ab'*32),'invalido',('a'*63),('g'*64))){
  $texto="OUTRA=ação preservada`n";if($valor){$texto+="PORTAL_API_TOKEN=$valor`n"}
  [IO.File]::WriteAllText($arquivo,$texto)
  $alterada=Garantir-CredencialPortal $arquivo
  $cfg=Ler-ConfigOperacao $arquivo
  if($cfg.PORTAL_API_TOKEN-notmatch'^[0-9a-fA-F]{64}$'-or$cfg.OUTRA-ne'ação preservada'){throw 'Credencial ou configuracao incorreta.'}
  if($valor-eq('Ab'*32)){
   if($alterada-or[IO.File]::ReadAllText($arquivo)-cne$texto){throw 'Credencial valida foi regenerada ou arquivo alterado.'}
  }elseif(!$alterada){throw 'Credencial ausente/invalida nao foi reparada.'}
 }
 Write-Host '[OK] credencial compartilhada: ausente, valida preservada e invalidas reparadas'
}finally{Remove-Item -LiteralPath $temp -Recurse -Force}
