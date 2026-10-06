function Obter-PastaPrivada([string]$Raiz) {
  if ($env:SUPPLY_VISION_PRIVADO) {
    $env:SUPPLY_VISION_PRIVADO = [IO.Path]::GetFullPath($env:SUPPLY_VISION_PRIVADO)
    return $env:SUPPLY_VISION_PRIVADO
  }
  return Join-Path $Raiz 'privado'
}

function Obter-SlotDoDia([string]$Tipo, [hashtable]$Config, [string]$Prefixo, [hashtable]$Estado, [datetime]$Agora) {
  return Obter-SlotDevido $Tipo (Obter-HorariosDoDia $Config $Prefixo $Agora) $Estado $Agora
}

function Argumentos-ReexecucaoAtualizador([string]$Script, [string]$Anterior, [bool]$Reaplicar) {
  $argumentos = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Script, '-JaAtualizado', '-VersaoAnterior', $Anterior)
  if ($Reaplicar) { $argumentos += '-Reaplicar' }
  return $argumentos
}

function Ler-ConfigOperacao([string]$Caminho) {
  $config = @{}
  if (!(Test-Path -LiteralPath $Caminho)) { throw "Configuracao operacional ausente: $Caminho" }
  foreach ($linha in Get-Content -LiteralPath $Caminho) {
    $texto = $linha.Trim()
    if (!$texto -or $texto.StartsWith('#')) { continue }
    if (!$texto.Contains('=')) { throw "Linha invalida em operacao.env: $texto" }
    $chave, $valor = $texto.Split('=', 2)
    $config[$chave.Trim()] = $valor.Trim()
  }
  return $config
}

function Obter-ProcessoRegistrado([string]$CaminhoPid) {
  if (!(Test-Path -LiteralPath $CaminhoPid)) { return $null }
  try {
    $registro = Get-Content -LiteralPath $CaminhoPid -Raw | ConvertFrom-Json
    $processo = Get-Process -Id ([int]$registro.pid) -ErrorAction Stop
    $inicioRegistrado = [datetime]::Parse([string]$registro.inicio).ToUniversalTime()
    # O Windows reutiliza numeros de PID. Conferir tambem o instante de inicio
    # impede que um processo alheio seja confundido com o antigo supervisor.
    if ([math]::Abs(($processo.StartTime.ToUniversalTime() - $inicioRegistrado).TotalSeconds) -gt 2) { return $null }
    return $processo
  } catch { return $null }
}

$script:DiasSemana = @('DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB')

function Obter-HorariosDoDia([hashtable]$Config, [string]$Prefixo, [datetime]$Dia) {
  # Uma chave por dia (ALERTAS_HORARIOS_SEX) tem prioridade sobre a chave
  # geral (ALERTAS_HORARIOS). Valor vazio significa "nao executa neste dia".
  $chave = $Prefixo + '_' + $script:DiasSemana[[int]$Dia.DayOfWeek]
  if ($Config.ContainsKey($chave)) { return $Config[$chave] }
  return $Config[$Prefixo]
}

function Validar-Horarios([hashtable]$Config) {
  $regras = @{ ALERTAS_HORARIOS = $true; BACKUP_HORARIOS = $true; LIMPEZA_HORARIO = $false }
  foreach ($chave in $regras.Keys) {
    if (!$Config.ContainsKey($chave) -or !$Config[$chave]) { throw "Configuracao obrigatoria ausente: $chave" }
    $valores = if ($regras[$chave]) { $Config[$chave].Split(',') } else { @($Config[$chave]) }
    foreach ($valor in $valores) {
      $hora = [datetime]::MinValue
      if (![datetime]::TryParseExact($valor.Trim(), 'HH:mm', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None, [ref]$hora)) {
        throw "Horario invalido em ${chave}: '$valor'. Use HH:MM."
      }
    }
  }
  # Chaves por dia: opcionais, podem ser vazias (dia sem execucao), mas se
  # tiverem conteudo precisam ser horarios validos.
  foreach ($chave in @($Config.Keys)) {
    if ($chave -notmatch '^(ALERTAS_HORARIOS|BACKUP_HORARIOS)_(DOM|SEG|TER|QUA|QUI|SEX|SAB)$') { continue }
    if (!$Config[$chave]) { continue }
    foreach ($valor in $Config[$chave].Split(',')) {
      $hora = [datetime]::MinValue
      if (![datetime]::TryParseExact($valor.Trim(), 'HH:mm', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None, [ref]$hora)) {
        throw "Horario invalido em ${chave}: '$valor'. Use HH:MM."
      }
    }
  }
}

function Obter-SlotDevido([string]$Tipo, [string]$Lista, [hashtable]$Estado, [datetime]$Agora) {
  # Lista vazia = dia sem execucao (ex.: sabado e domingo para alertas).
  if (!$Lista -or !$Lista.Trim()) { return $null }
  $data = $Agora.ToString('yyyy-MM-dd'); $devidos = @()
  foreach ($texto in $Lista.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }) {
    $alvo = [datetime]::ParseExact("$data $texto", 'yyyy-MM-dd HH:mm', [Globalization.CultureInfo]::InvariantCulture)
    $chave = "$Tipo-$data-$texto"
    if ($Agora -ge $alvo -and !$Estado.ContainsKey($chave)) { $devidos += @{ chave=$chave; hora=$texto; alvo=$alvo } }
  }
  if (!$devidos) { return $null }
  # A manha (<10h) cobre datas que os slots do dia corrente nao consultam.
  # Recupera essa cobertura primeiro; a proxima chamada pega o ultimo slot
  # do dia. Horarios personalizados da manha compartilham a mesma cobertura.
  if ($Tipo -eq 'alertas') {
    $manha = $devidos | Where-Object { $_.alvo.Hour -lt 10 } | Sort-Object { $_.alvo } | Select-Object -Last 1
    if ($manha) {
      foreach ($item in $devidos) {
        if ($item.alvo.Hour -lt 10 -and $item.chave -ne $manha.chave) { $Estado[$item.chave] = 'recuperado-pelo-slot-da-manha' }
      }
      return $manha
    }
  }
  $ultimo = $devidos | Sort-Object { $_.alvo } | Select-Object -Last 1
  foreach ($item in $devidos) { if ($item.chave -ne $ultimo.chave) { $Estado[$item.chave] = 'recuperado-pelo-slot-mais-recente' } }
  return $ultimo
}

function Ler-EstadoOperacao([string]$Caminho) {
  $estado = @{}
  if (!(Test-Path -LiteralPath $Caminho)) { return $estado }
  try {
    $objeto = Get-Content -LiteralPath $Caminho -Raw | ConvertFrom-Json -ErrorAction Stop
    if ($null -eq $objeto -or $objeto -isnot [System.Management.Automation.PSCustomObject]) { throw 'Esperado objeto JSON.' }
    foreach ($propriedade in $objeto.psobject.Properties) { $estado[$propriedade.Name] = $propriedade.Value }
    return $estado
  } catch { throw "Estado operacional invalido em $Caminho. Operacao bloqueada para evitar reenvios; confira estado.json e estado.json.anterior antes de recuperar. $($_.Exception.Message)" }
}

function Validar-PythonAlertas([string]$Executavel) {
  # Le a saida inteira. Select-Object -First 1 interromperia o python.exe ao
  # receber a primeira linha, e o Windows PowerShell 5.1 registra entao
  # $LASTEXITCODE = -1 mesmo com a versao lida corretamente.
  $saida = (& $Executavel --version 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $saida -notmatch 'Python (\d+\.\d+\.\d+)') { throw 'Nao foi possivel verificar o Python dos Alertas.' }
  if ([version]$Matches[1] -lt [version]'3.12.0') {
    throw 'Alertas exigem Python 3.12 ou superior. Instale-o e recrie alertas/.venv com a operacao parada antes de atualizar; preserve privado/.'
  }
}

function Gravar-EstadoOperacao([string]$Caminho, [hashtable]$Estado) {
  $temporario = $Caminho + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
  $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes(($Estado | ConvertTo-Json -Depth 10))
  try {
    $arquivo = [IO.File]::Open($temporario, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $arquivo.Write($bytes, 0, $bytes.Length); $arquivo.Flush($true) } finally { $arquivo.Dispose() }
    if (Test-Path -LiteralPath $Caminho) { [IO.File]::Replace($temporario, $Caminho, ($Caminho + '.anterior')) }
    else { [IO.File]::Move($temporario, $Caminho) }
  } finally { if (Test-Path -LiteralPath $temporario) { Remove-Item -LiteralPath $temporario -Force } }
}

function Atualizar-AgendaAlertasLegada([string]$Caminho) {
  # privado/ nao viaja pelo Git. Migra somente os valores padrao conhecidos,
  # sem sobrescrever uma agenda que o operador tenha personalizado.
  $linhas = @(Get-Content -LiteralPath $Caminho)
  $mudou = $false
  for ($i = 0; $i -lt $linhas.Count; $i++) {
    if ($linhas[$i] -eq 'ALERTAS_HORARIOS=08:00,12:00,17:00') {
      $linhas[$i] = 'ALERTAS_HORARIOS=08:00,11:00,14:00,17:00'
      $mudou = $true
    } elseif ($linhas[$i] -eq 'ALERTAS_HORARIOS_SEX=08:00,12:00,16:00') {
      $linhas[$i] = 'ALERTAS_HORARIOS_SEX=08:00,11:00,14:00'
      $mudou = $true
    }
  }
  if ($mudou) { $linhas | Set-Content -LiteralPath $Caminho -Encoding UTF8 }
  return $mudou
}
