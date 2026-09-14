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
  $ultimo = $devidos | Sort-Object { $_.alvo } | Select-Object -Last 1
  foreach ($item in $devidos) { if ($item.chave -ne $ultimo.chave) { $Estado[$item.chave] = 'recuperado-pelo-slot-mais-recente' } }
  return $ultimo
}