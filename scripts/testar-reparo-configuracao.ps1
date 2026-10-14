param([ValidateSet('sqlite','d1')][string]$BancoLocal='sqlite')
# Confere o reparo da configuracao privada usando a funcao real do atualizador,
# num diretorio de mentira: nada do servidor e tocado.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
. (Join-Path $PSScriptRoot 'atualizacao-preparo.ps1')
$fonte = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'atualizar-servidor.ps1') -Raw
$inicio = $fonte.IndexOf('function Reparar-ConfiguracaoPrivada')
$fim = $fonte.IndexOf("$" + "ContextoArquivo =") # definicoes precedem o controle de fases
if ($inicio -lt 0 -or $fim -le $inicio) { throw 'Funcao de reparo nao encontrada no atualizador.' }
. ([scriptblock]::Create($fonte.Substring($inicio, $fim - $inicio)))

$avisos = [Collections.Generic.List[string]]::new()
function Ok([string]$t) {}
function Aviso([string]$t) { $avisos.Add($t) }

$Raiz = Join-Path ([IO.Path]::GetTempPath()) ('sv-reparo-' + [guid]::NewGuid().ToString('N'))
$privadoAnterior = $env:SUPPLY_VISION_PRIVADO
try {
  $env:SUPPLY_VISION_PRIVADO = Join-Path $Raiz 'privado'
  foreach ($d in @('portal', 'compartilhado', 'privado\portal\configuracao', 'privado\comum')) {
    New-Item -ItemType Directory -Force (Join-Path $Raiz $d) | Out-Null
  }

  $exemploPortal = Join-Path $Raiz 'portal\portal.env.example'
  $destinoPortal = Join-Path $Raiz 'privado\portal\configuracao\portal.env'
  Set-Content -LiteralPath $exemploPortal -Value @(
    '# comentario',
    'PORTAL_URL=http://localhost:3000',
    'PORTAL_API_TOKEN=',
    'BACKUP_EMAIL_TO=alguem@example.com',
    'CHAVE_NOVA=valor-padrao',
    'PORTAL_BANCO_LOCAL=sqlite'
  )
  Set-Content -LiteralPath $destinoPortal -Value @(
    'PORTAL_URL=http://servidor.test:3000',
    'BACKUP_EMAIL_TO=real@example.com',
    "PORTAL_BANCO_LOCAL=$BancoLocal"
  )
  Set-Content -LiteralPath (Join-Path $Raiz 'compartilhado\smtp.env.example') -Value @('SMTP_HOST=exemplo')
  Set-Content -LiteralPath (Join-Path $Raiz 'privado\comum\smtp.env') -Value @('SMTP_HOST=servidor-real')

  Reparar-ConfiguracaoPrivada

  $linhas = @(Get-Content -LiteralPath $destinoPortal)
  if (($linhas | Where-Object { $_ -eq 'PORTAL_URL=http://servidor.test:3000' }).Count -ne 1) { throw 'O valor ja configurado foi alterado.' }
  if (($linhas | Where-Object { $_ -like 'PORTAL_URL=*' }).Count -ne 1) { throw 'Chave existente foi duplicada.' }
  if (-not ($linhas | Where-Object { $_ -eq 'CHAVE_NOVA=valor-padrao' })) { throw 'Chave nova com valor padrao nao foi acrescentada.' }
  if (-not ($linhas | Where-Object { $_ -eq 'PORTAL_API_TOKEN=' })) { throw 'Chave nova vazia nao foi acrescentada.' }
  if (($avisos -join ' ') -notmatch 'PORTAL_API_TOKEN') { throw 'A chave vazia deveria virar aviso.' }
  if(($linhas|Where-Object {$_-eq"PORTAL_BANCO_LOCAL=$BancoLocal"}).Count-ne1){throw 'Reparo alterou a escolha do banco local.'}
  Write-Host '[OK] chaves novas acrescentadas sem mexer nas existentes'

  $antes = Get-Content -LiteralPath $destinoPortal -Raw
  $avisos.Clear()
  Reparar-ConfiguracaoPrivada
  if ((Get-Content -LiteralPath $destinoPortal -Raw) -ne $antes) { throw 'Rodar de novo alterou um arquivo ja completo.' }
  Write-Host '[OK] repetir o reparo nao mexe em nada'

  Remove-Item -LiteralPath (Join-Path $Raiz 'privado\comum\smtp.env') -Force
  $erro = $null
  try { Reparar-ConfiguracaoPrivada } catch { $erro = $_ }
  if (-not $erro) { throw 'Configuracao privada ausente deveria interromper a atualizacao.' }
  Write-Host '[OK] configuracao privada ausente e denunciada'
} finally {
  $env:SUPPLY_VISION_PRIVADO = $privadoAnterior
  if (![IO.Path]::GetFullPath($Raiz).StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()), [StringComparison]::OrdinalIgnoreCase)) { throw 'Raiz de teste fora da pasta temporaria.' }
  Remove-Item -LiteralPath $Raiz -Recurse -Force -ErrorAction SilentlyContinue
}

# A reexecucao e o que faz uma correcao no proprio atualizador valer ja na
# atualizacao que a traz; se ela sumir, o teste avisa.
$ast=[Management.Automation.Language.Parser]::ParseInput($fonte,[ref]$null,[ref]$null)
$chamada=$ast.Find({param($n) $n-is[Management.Automation.Language.CommandAst]-and$n.GetCommandName()-eq'Executar-PowerShellOculto'-and$n.Extent.Text.Contains('$argumentosReexecucao')},$true)
if (!$chamada -or $fonte -notmatch 'Argumentos-ReexecucaoAtualizador.*atualizar-servidor\.ps1') {
  throw 'O atualizador nao se relanca com o codigo novo.'
}
# Executa o try/finally real, lendo o script novo do disco, com os argumentos
# reais. Uma chamada presente mas sem reexecucao funcional tambem deve falhar.
$blocoFilho=$chamada.Parent
while($blocoFilho-and$blocoFilho-isnot[Management.Automation.Language.TryStatementAst]){$blocoFilho=$blocoFilho.Parent}
if(!$blocoFilho){throw 'Reexecucao sem protecao/restauracao da preferencia de erro.'}
$tempFilho=Join-Path ([IO.Path]::GetTempPath()) ('sv-reexecucao-'+[guid]::NewGuid().ToString('N'))
try{
 New-Item -ItemType Directory $tempFilho|Out-Null
 $scriptNovo=Join-Path $tempFilho 'atualizar-servidor.ps1'
 [IO.File]::WriteAllText($scriptNovo,"throw 'codigo antigo nao pode executar'")
 $novo=@'
param([switch]$JaAtualizado,[string]$VersaoAnterior,[switch]$Reaplicar,[int]$Codigo)
if(!$JaAtualizado-or!$Reaplicar-or$VersaoAnterior-ne('1'*40)){exit 9}
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'novo.executado'),[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'portal.env')))
[Console]::Error.WriteLine('npm warn install-scripts fixture')
exit $Codigo
'@
 [IO.File]::WriteAllText($scriptNovo,$novo)
 [IO.File]::WriteAllText((Join-Path $tempFilho 'portal.env'),"PORTAL_BANCO_LOCAL=$BancoLocal")
 # Usa o lancador real, com o executavel do host apenas como ponto de injecao.
 # Assim PS 5.1 e PS 7 exercitam CreateNoWindow, captura e codigo de saida.
 $script:hostReexecucao=(Get-Process -Id $PID).Path
 $script:lancadorReexecucao=(Get-Command Executar-PowerShellOculto).ScriptBlock
 function Executar-PowerShellOculto($Argumentos){ & $script:lancadorReexecucao $Argumentos $script:hostReexecucao }
 foreach($codigoFilho in @(0,7)){
  Remove-Item (Join-Path $tempFilho 'novo.executado') -Force -ErrorAction SilentlyContinue
  $argumentosReexecucao=@(Argumentos-ReexecucaoAtualizador $scriptNovo ('1'*40) $true)+@('-Codigo',$codigoFilho)
  $preferenciaFilho=$ErrorActionPreference;$ErrorActionPreference='Continue'
  $saidaFilho=@(. ([scriptblock]::Create($blocoFilho.Extent.Text)))
  if($rcFilho-ne$codigoFilho-or$ErrorActionPreference-ne'Stop'-or!(Test-Path (Join-Path $tempFilho 'novo.executado'))-or[IO.File]::ReadAllText((Join-Path $tempFilho 'novo.executado'))-ne"PORTAL_BANCO_LOCAL=$BancoLocal"){throw 'Reexecucao nao leu o codigo novo ou perdeu argumentos/codigo.'}
  if(($saidaFilho-join' ')-notlike'*npm warn install-scripts fixture*'){throw 'Reexecucao perdeu stderr do filho.'}
 }
}finally{Remove-Item Function:Executar-PowerShellOculto -ErrorAction SilentlyContinue;Remove-Item $tempFilho -Recurse -Force -ErrorAction SilentlyContinue}
if ($fonte -notmatch '(?m)^\s*Reparar-ConfiguracaoPrivada\s*$') { throw 'O reparo da configuracao nao e chamado na atualizacao.' }
Write-Host '[OK] atualizador segue com o codigo novo depois do merge'
Write-Host 'Reparo de configuracao: 4 conferencias aprovadas.' -ForegroundColor Green

$global:LASTEXITCODE=0
