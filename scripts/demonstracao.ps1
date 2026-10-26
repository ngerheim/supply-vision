# Portal local com dados publicos ficticios. Nao inicia servicos operacionais.
[CmdletBinding()]
param([ValidateRange(1024,65534)][int]$Porta=3100,[switch]$Recriar,[string]$Pasta)
$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$projeto = Join-Path $raiz 'portal'
. (Join-Path $projeto 'scripts/portal-ensaio.ps1')
if (!$Pasta) { $Pasta = Join-Path $env:LOCALAPPDATA 'supply-vision-demo' }
$Pasta = [IO.Path]::GetFullPath($Pasta)
$registro = $null; $mutex = $null; $adquirido = $false
$mutexFisico = $null; $fisicoAdquirido = $false
function Chave-PastaDemo([string]$Diretorio) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Diretorio.ToLowerInvariant()))).Replace('-','') } finally { $sha.Dispose() }
}
try {
  $argumentos = @((Join-Path $projeto 'demonstracao/pasta.mjs'),$Pasta)
  if ($Recriar) { $argumentos += '--recriar' }
  $validacao = Executar-NativoOperacao 'node' ($argumentos + '--validar')
  if ($validacao.codigo) { throw ($validacao.saida -join "`n") }
  $Pasta = (($validacao.stdout -join "`n") | ConvertFrom-Json).pasta
  # Um unico launcher por pasta, inclusive durante build/semeadura/recriacao.
  $chave = Chave-PastaDemo $Pasta
  $mutex = New-Object Threading.Mutex($false,('Local\SupplyVisionDemo-'+$chave))
  try { $adquirido = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $adquirido = $true }
  if (!$adquirido) { throw 'Esta pasta de demonstracao ja esta em uso.' }
  # Valida antes do build, criacao da sentinela ou remocao de qualquer arquivo.
  $argumentos[1] = $Pasta
  $preparo = Executar-NativoOperacao 'node' $argumentos
  if ($preparo.codigo) { throw ($preparo.saida -join "`n") }
  $dados = ($preparo.stdout -join "`n") | ConvertFrom-Json
  $Pasta = $dados.pasta
  # LocalAppData virtualizado pode ganhar outro caminho fisico ao ser criado.
  # Conservar ambas as identidades ate o fim evita duas partidas por aliases.
  $chaveFisica = Chave-PastaDemo $Pasta
  if ($chaveFisica -ne $chave) {
    $mutexFisico = New-Object Threading.Mutex($false,('Local\SupplyVisionDemo-'+$chaveFisica))
    try { $fisicoAdquirido = $mutexFisico.WaitOne(0) } catch [Threading.AbandonedMutexException] { $fisicoAdquirido = $true }
    if (!$fisicoAdquirido) { throw 'Esta pasta fisica de demonstracao ja esta em uso.' }
  }
  $portaLivre = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Parse('127.0.0.1'),$Porta)
  try { $portaLivre.Start() } finally { $portaLivre.Stop() }
  $ambiente = @{
    SUPPLY_VISION_PRIVADO=$Pasta; MODO_ENSAIO='1'; PORTAL_CRIAR_BANCO=$(if($dados.criar){'1'}else{'0'})
    PORTAL_PORTA=[string]$Porta; RELATORIOS_PORTA=[string]($Porta+1); NODE_ENV='production'
    INITIAL_ADMIN_PASSWORD=''; PORTAL_API_TOKEN=''; TRUSTED_PROXY=''; PBI_RELATORIO_URL=''; PBI_PAGINA=''
  }
  # Build real quando ausente ou anterior a algum fonte/dependencia versionada.
  $build = Join-Path $projeto 'dist/portal-build.json'
  $reusar = (Test-Path -LiteralPath $build) -and (Test-Path -LiteralPath (Join-Path $projeto 'dist/server/index.js'))
  if ($reusar) {
    $dataBuild = (Get-Item -LiteralPath $build).LastWriteTimeUtc
    $fontes = @(Get-ChildItem (Join-Path $projeto 'app'),(Join-Path $projeto 'components'),(Join-Path $projeto 'lib'),(Join-Path $projeto 'scripts'),(Join-Path $projeto 'public') -Recurse -File)
    $fontes += @(Get-ChildItem -LiteralPath $projeto -File)
    $reusar = !@($fontes | Where-Object LastWriteTimeUtc -GT $dataBuild).Count
  }
  # Build tambem recebe a raiz isolada e a porta escolhida, sem config real.
  $anterior = @{}
  try {
    foreach ($nome in $ambiente.Keys) { $anterior[$nome]=[Environment]::GetEnvironmentVariable($nome,'Process'); [Environment]::SetEnvironmentVariable($nome,$ambiente[$nome],'Process') }
    Compilar-PortalEnsaio $projeto (Join-Path $Pasta 'build.log') -UsarBuildExistente:$reusar
  } finally { foreach ($nome in $anterior.Keys) { [Environment]::SetEnvironmentVariable($nome,$anterior[$nome],'Process') } }
  $pronto = Join-Path $Pasta 'pronto.json'
  if (Test-Path -LiteralPath $pronto) { Remove-Item -LiteralPath $pronto -Force }
  $registro = Iniciar-PortalEnsaio $projeto $ambiente (Join-Path $Pasta 'servidor.log') 'demonstracao/servidor.mjs'
  $prazo = [Diagnostics.Stopwatch]::StartNew()
  while (!(Test-Path -LiteralPath $pronto)) {
    if ($registro.Processo.HasExited) { throw "Portal encerrou. Consulte $(Join-Path $Pasta 'servidor.log.erro')" }
    if ($prazo.Elapsed.TotalSeconds -gt 180) { throw 'Tempo limite da partida/semeadura excedido.' }
    Start-Sleep -Milliseconds 250
  }
  $identidade = Get-Content -LiteralPath $pronto -Raw | ConvertFrom-Json
  if ($identidade.pid -ne $registro.Processo.Id) { throw 'Identidade da partida nao confere.' }
  Write-Host "Demonstracao: http://127.0.0.1:$Porta"
  Write-Host "Dados: $Pasta"
  Write-Host "Credenciais de demonstracao: $(Join-Path $Pasta 'credenciais.json')"
  Write-Host 'MODO_ENSAIO=1. Para encerrar: Ctrl+C nesta janela.'
  while (!$registro.Processo.HasExited) { Start-Sleep -Milliseconds 250 }
  if ($registro.Processo.ExitCode) { throw "Portal encerrou com codigo $($registro.Processo.ExitCode)." }
} finally {
  try { Encerrar-PortalEnsaio $registro } finally {
    if ($fisicoAdquirido) { $mutexFisico.ReleaseMutex() }
    if ($mutexFisico) { $mutexFisico.Dispose() }
    if ($adquirido) { $mutex.ReleaseMutex() }
    if ($mutex) { $mutex.Dispose() }
  }
}
