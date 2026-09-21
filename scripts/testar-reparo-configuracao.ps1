# Confere o reparo da configuracao privada usando a funcao real do atualizador,
# num diretorio de mentira: nada do servidor e tocado.
$ErrorActionPreference = 'Stop'
$fonte = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'atualizar-servidor.ps1') -Raw
$inicio = $fonte.IndexOf('function Reparar-ConfiguracaoPrivada')
$fim = $fonte.IndexOf("Etapa 'Conferindo o repositorio'")
if ($inicio -lt 0 -or $fim -le $inicio) { throw 'Funcao de reparo nao encontrada no atualizador.' }
. ([scriptblock]::Create($fonte.Substring($inicio, $fim - $inicio)))

$avisos = [Collections.Generic.List[string]]::new()
function Ok([string]$t) {}
function Aviso([string]$t) { $avisos.Add($t) }

$Raiz = Join-Path ([IO.Path]::GetTempPath()) ('sv-reparo-' + [guid]::NewGuid().ToString('N'))
try {
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
    'CHAVE_NOVA=valor-padrao'
  )
  Set-Content -LiteralPath $destinoPortal -Value @(
    'PORTAL_URL=http://servidor:3000',
    'BACKUP_EMAIL_TO=real@example.com'
  )
  Set-Content -LiteralPath (Join-Path $Raiz 'compartilhado\smtp.env.example') -Value @('SMTP_HOST=exemplo')
  Set-Content -LiteralPath (Join-Path $Raiz 'privado\comum\smtp.env') -Value @('SMTP_HOST=servidor-real')

  Reparar-ConfiguracaoPrivada

  $linhas = @(Get-Content -LiteralPath $destinoPortal)
  if (($linhas | Where-Object { $_ -eq 'PORTAL_URL=http://servidor:3000' }).Count -ne 1) { throw 'O valor ja configurado foi alterado.' }
  if (($linhas | Where-Object { $_ -like 'PORTAL_URL=*' }).Count -ne 1) { throw 'Chave existente foi duplicada.' }
  if (-not ($linhas | Where-Object { $_ -eq 'CHAVE_NOVA=valor-padrao' })) { throw 'Chave nova com valor padrao nao foi acrescentada.' }
  if (-not ($linhas | Where-Object { $_ -eq 'PORTAL_API_TOKEN=' })) { throw 'Chave nova vazia nao foi acrescentada.' }
  if (($avisos -join ' ') -notmatch 'PORTAL_API_TOKEN') { throw 'A chave vazia deveria virar aviso.' }
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
  Remove-Item -LiteralPath $Raiz -Recurse -Force -ErrorAction SilentlyContinue
}

# A reexecucao e o que faz uma correcao no proprio atualizador valer ja na
# atualizacao que a traz; se ela sumir, o teste avisa.
if ($fonte -notmatch '(?m)^\s*&\s*powershell\.exe.*atualizar-servidor\.ps1.*-JaAtualizado') {
  throw 'O atualizador nao se relanca com o codigo novo.'
}
if ($fonte -notmatch '(?m)^\s*Reparar-ConfiguracaoPrivada\s*$') { throw 'O reparo da configuracao nao e chamado na atualizacao.' }
Write-Host '[OK] atualizador segue com o codigo novo depois do merge'
Write-Host 'Reparo de configuracao: 4 conferencias aprovadas.' -ForegroundColor Green
