# Infraestrutura comum do ponta a ponta e da demonstracao; PowerShell 5.1.
. (Join-Path $PSScriptRoot '../../scripts/operacao-logica.ps1')

function Compilar-PortalEnsaio([string]$Projeto,[string]$Log,[switch]$UsarBuildExistente) {
  if ($UsarBuildExistente) {
    if (!(Test-Path -LiteralPath (Join-Path $Projeto 'dist/server/index.js'))) { throw 'A compilacao existente nao foi encontrada.' }
    return
  }
  Push-Location $Projeto
  try {
    $resultado = Executar-NativoOperacao 'npm.cmd' @('run','build')
    $resultado.saida | Set-Content -LiteralPath $Log
    if ($resultado.codigo) { throw "A compilacao falhou. Consulte $Log" }
  } finally { Pop-Location }
}

function Iniciar-PortalEnsaio([string]$Projeto,[hashtable]$Ambiente,[string]$Log,[string]$Entrada='scripts/iniciar-portal.mjs') {
  if ($Ambiente.MODO_ENSAIO -ne '1') { throw 'A partida exige MODO_ENSAIO=1.' }
  $anterior = @{}
  try {
    foreach ($nome in $Ambiente.Keys) {
      $anterior[$nome] = [Environment]::GetEnvironmentVariable($nome, 'Process')
      [Environment]::SetEnvironmentVariable($nome, $Ambiente[$nome], 'Process')
    }
    $node = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    $entradaAbsoluta = Join-Path $Projeto $Entrada
    $processo = Start-Process $node -ArgumentList @('--experimental-strip-types',('"'+$entradaAbsoluta+'"'),'local') -WorkingDirectory $Projeto -WindowStyle Hidden -RedirectStandardOutput $Log -RedirectStandardError ($Log+'.erro') -PassThru
    [void]$processo.Handle
    return [pscustomobject]@{ Processo=$processo; Inicio=$processo.StartTime.ToUniversalTime(); Entrada=$entradaAbsoluta }
  } finally {
    foreach ($nome in $anterior.Keys) { [Environment]::SetEnvironmentVariable($nome, $anterior[$nome], 'Process') }
  }
}

function Encerrar-PortalEnsaio($Registro) {
  if (!$Registro) { return }
  try {
    $p = Get-Process -Id $Registro.Processo.Id -ErrorAction SilentlyContinue
    if (!$p -or $p.StartTime.ToUniversalTime() -ne $Registro.Inicio) { return }
    $cim = Get-CimInstance Win32_Process -Filter ("ProcessId="+$p.Id)
    if (!$cim -or !$cim.CommandLine.Contains($Registro.Entrada)) { return }
    [void](Executar-NativoOperacao 'taskkill.exe' @('/PID',[string]$p.Id,'/T','/F'))
    [void]$Registro.Processo.WaitForExit(10000)
  } finally { $Registro.Processo.Dispose() }
}
