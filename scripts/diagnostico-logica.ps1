function Obter-SegredosHomologacao([string]$Privado){
 $segredos=@()
foreach($arquivo in @(Get-ChildItem -LiteralPath $privado -Filter '*.env' -Recurse -File -ErrorAction SilentlyContinue)){
 foreach($l in Get-Content $arquivo.FullName -Encoding UTF8){
  if($l-match '^\s*([^#=]+)=(.+)$'){
   $chave=$Matches[1];$valor=$Matches[2]
   if($chave-match '(?i)TOKEN|PASS|SENHA|SECRET|SMTP|EMAIL|KEY'){$segredos+=$valor.Trim()}
  }
 }
}
 return ,$segredos
}
function Mascarar-Homologacao([string]$Texto,[string[]]$Segredos=@()){
 foreach($s in $segredos){if($s){$Texto=$Texto.Replace($s,'[mascarado]')}}
 $Texto=[regex]::Replace($Texto,'[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}','[email mascarado]')
 $Texto=[regex]::Replace($Texto,'(?i)(authorization|bearer|token|password|senha|secret|api[_-]?key)\s*[:= ]\s*\S+','$1=[mascarado]')
 # Nao reproduz URLs com credenciais nem linhas com consultas ou registros de banco.
 if($Texto-match '(?i)://[^/\s]+@|\b(SELECT|INSERT|UPDATE|DELETE)\b|[{}]|\b(chamado|usuario|preco|payload)\s*[:=]'){return '[conteudo omitido]'}
 return $Texto
}

function Localizar-LogsOperacao([string]$Privado,[string]$Tipo) {
 $nomes=switch($Tipo){
  'supervisor' {@('supervisor.log')}
  'portal' {@('portal-saida.log','portal-erro.log')}
  'atualizacao' {@('atualizacao-processo-saida.log','atualizacao-erro.log','atualizacao-tempos.log','limpeza-preparo.log')}
  'emails' {@('emails-saida.log','emails-erro.log','portal-email.log')}
  'relatorios' {@('relatorios-saida.log','relatorios-erro.log')}
 }
 foreach($pasta in @('operacao','portal/logs')){
  foreach($nome in $nomes){$arquivo=Join-Path (Join-Path $Privado $pasta) $nome;if(Test-Path -LiteralPath $arquivo -PathType Leaf){Get-Item -LiteralPath $arquivo}}
 }
}
function Analisar-SaudeSupervisor([string[]]$Linhas,[datetime]$Desde) {
 $inicio=$null;$reinicios=0;$falhas=@()
 foreach($linha in $Linhas){
  if($linha-notmatch'^\[?(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]?\s+(.*)$'){continue}
  $hora=[datetime]::ParseExact($Matches[1],'yyyy-MM-dd HH:mm:ss',[Globalization.CultureInfo]::InvariantCulture)
  $texto=$Matches[2]
  # Tambem le o inicio anterior ao recorte para classificar a primeira falha.
  if($texto-like'*Supervisor iniciado*'){$inicio=$hora;if($hora-ge$Desde){$reinicios++}}
  if($hora-lt$Desde-or$texto-notmatch'Health falhou: motivo=([^; ]+)'){continue}
  $falhas+=@{hora=$hora;motivo=$Matches[1];partida=($null-ne$inicio-and($hora-$inicio).TotalSeconds-ge0-and($hora-$inicio).TotalSeconds-le30);texto=$texto}
 }
 return @{reinicios=$reinicios;falhas=$falhas}
}

function Filtrar-LogsAtualizacao([string[]]$Linhas) {
 $diagnostico=$false
 foreach($linha in $Linhas){
  # Cores nao podem esconder o inicio/fim do bloco de aviso.
  $limpa=$linha-replace'\x1B\[[0-?]*[ -/]*[@-~]',''
  if($limpa-match'^\s*Updating files:\s*\d+%'){continue}
  if($limpa-match'\[(PLUGIN_TIMINGS|INEFFECTIVE_DYNAMIC_IMPORT)\]'){$diagnostico=$true;continue}
  if($diagnostico){
   # Preserva erros reais mesmo indentados, sem depender de uma linha vazia.
   if($limpa-match'(?i)^\s*(?:\[[^]]+\]\s*)?(?:error|erro|fatal|exception|TypeError|SyntaxError|ReferenceError|failed|failure)\b|\bnpm\s+ERR!|\b(?:build|compilation) failed\b'){$diagnostico=$false}
   elseif(!$limpa.Trim()){$diagnostico=$false;continue}
   elseif($limpa-match'^\s+|^[\u2500-\u257F]|^[-*]\s+.*\d+(?:\.\d+)?\s*(?:ms|s|%)|^(Your build|The following plugins|Consider |Note:|See |is dynamically imported)'){continue}
   else{$diagnostico=$false}
  }
  $linha
 }
}
