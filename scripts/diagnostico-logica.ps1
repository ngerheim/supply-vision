function Obter-SegredosHomologacao([string]$Privado){
 $segredos=@()
foreach($arquivo in @(Get-ChildItem -LiteralPath $privado -Filter '*.env' -Recurse -File -ErrorAction SilentlyContinue)){
 foreach($l in Get-Content $arquivo.FullName -Encoding UTF8){
  if($l-match '^\s*([^#=]+)=(.+)$'){
   $chave=$Matches[1].Trim();$valor=$Matches[2]
   $valor=$valor.Trim()
   # Credenciais numericas continuam secretas; parametros SMTP/EMAIL nao sao credenciais.
   if($chave-match '(?i)TOKEN|PASS|SENHA|SECRET|KEY'){$segredos+=$valor}
   elseif($chave-match '(?i)SMTP|EMAIL'-and$valor-notmatch'(?i)^(\d+|true|false)$'){$segredos+=$valor}
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
  # Erros encerram o bloco de aviso mesmo quando falta a linha em branco.
  $erro=$limpa-match'(?i)^\s*(?:\[[^]]+\]\s*)?(?:error|erro|fatal|exception|TypeError|SyntaxError|ReferenceError|failed|failure)\b|\bnpm\s+ERR!|\b(?:build|compilation) failed\b'
  if($erro){$diagnostico=$false;$linha;continue}
  if($limpa-match'\[(PLUGIN_TIMINGS|INEFFECTIVE_DYNAMIC_IMPORT)\]'){$diagnostico=$true;continue}
  if($diagnostico){
   # O diagnostico inteiro vai ate a linha vazia, sem adivinhar indentacao.
   if(!$limpa.Trim()){$diagnostico=$false}
   continue
  }
  if($limpa-match'^\s*(?:\d+ callbacks? (?:are|is) listed without a time|[-*] plugin\b|and \d+ more\b|See https://rolldown\.rs/|The slowest callbacks\b|Additional callback time\b|`?output\.codeSplitting.* is a function|Learn more: https://nextjs\.org/docs/messages/middleware-to-proxy|npx @next/codemod\b)'){continue}
  $linha
 }
}

function Obter-SituacaoBackupRede([string]$Pasta,[hashtable]$Config,[datetime]$Agora,[datetime]$Inicio=[datetime]::MinValue){
 # Inicio limita a cobranca antes do primeiro pacote; o chamador usa a criacao da raiz privada.
 try{
 if($Config['MODO_ENSAIO']-eq'1'){return @{nivel='info';mensagem='MODO_ENSAIO=1: backup de rede desligado (nao valida integridade)'}}
 if(!$Pasta-or!(Test-Path -LiteralPath $Pasta -PathType Container)){return @{nivel='erro';mensagem='pasta de backup de rede ausente ou indisponivel (nao valida integridade; execute supv backup testar)'}}
 # O Node reconhece os pacotes com PADRAO_BACKUP e ordena pela data do nome.
 # backup-rede.mjs publica diretamente nesta pasta, sem subpasta historico.
 $modulo=([uri]([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../portal/scripts/retencao-backup.mjs')))).AbsoluteUri
 $r=Executar-NativoOperacao (Localizar-NodeMaquina) @('--input-type=module','-e','import(process.argv[1]).then(m=>console.log(JSON.stringify(m.listarHistorico(process.argv[2]))))',$modulo,$Pasta)
 if($r.codigo-ne0){throw 'Consulta de pacotes indisponivel.'}
 $historico=($r.stdout-join"`n")|ConvertFrom-Json
 $pacotes=@($historico)
 $ultimo=$null
 if($pacotes.Count){
  $ultimo=[datetime]::ParseExact($pacotes[0].data,'yyyy-MM-dd_HHmm',[Globalization.CultureInfo]::InvariantCulture)
  $inicio=$ultimo
 }
 # A agenda semanal se repete; oito dias cobrem inclusive a virada do dia.
 for($dias=0;$dias-lt8;$dias++){
  $dia=$agora.Date.AddDays(-$dias)
  if($dia.AddDays(1)-le$inicio){break}
  $horarios=[string](Obter-HorariosDoDia $Config 'BACKUP_HORARIOS' $dia)
  foreach($h in @($horarios.Split(',')|ForEach-Object {$_.Trim()}|Where-Object {$_})){
   $alvo=[datetime]::ParseExact(($dia.ToString('yyyy-MM-dd')+' '+$h),'yyyy-MM-dd HH:mm',[Globalization.CultureInfo]::InvariantCulture)
   if($alvo-lt$agora-and(($ultimo-and$alvo-gt$ultimo)-or(!$ultimo-and$alvo-ge$inicio))){return @{nivel='erro';mensagem='backup de rede agendado vencido sem pacote; confira supv logs supervisor (nao valida integridade; execute supv backup testar)'}}
  }
 }
 if(!$pacotes.Count){return @{nivel='aviso';mensagem='nenhum pacote de backup de rede reconhecido ainda (nao valida integridade; execute supv backup testar)'}}
 return @{nivel='ok';mensagem="$($pacotes.Count) pacotes; mais recente $($ultimo.ToString('yyyy-MM-dd HH:mm')) (nao valida integridade; execute supv backup testar)"}
 }catch{return @{nivel='erro';mensagem='consulta de pacotes de backup de rede indisponivel (nao valida integridade; execute supv backup testar)'}}
}
