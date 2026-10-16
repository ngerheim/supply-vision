# AST ignora comentarios e strings de fixtures; nenhuma resolucao pelo PATH.
[CmdletBinding()]
param([string]$Raiz=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path)
$ErrorActionPreference='Stop'
. (Join-Path $Raiz 'scripts/operacao-logica.ps1')
function Encontrar-CapturasNativas([string]$Codigo,[string]$Arquivo) {
 $erros=$null;$ast=[Management.Automation.Language.Parser]::ParseInput($Codigo,[ref]$null,[ref]$erros)
 if($erros.Count){throw "Sintaxe invalida: $Arquivo"}
 foreach($comando in $ast.FindAll({param($n) $n-is[Management.Automation.Language.CommandAst]},$true)){
  foreach($r in $comando.Redirections){
   $mescla=$r-is[Management.Automation.Language.MergingRedirectionAst]-and$r.FromStream-eq'Error'-and$r.ToStream-eq'Output'
   $descarta=$r-is[Management.Automation.Language.FileRedirectionAst]-and$r.FromStream-eq'All'-and$r.Location-is[Management.Automation.Language.VariableExpressionAst]-and$r.Location.VariablePath.UserPath-eq'null'
   if(!$mescla-and!$descarta){continue}
   $auxiliar=$false
   for($pai=$comando.Parent;$pai;$pai=$pai.Parent){
    if($Arquivo-eq'scripts/operacao-logica.ps1'-and$pai-is[Management.Automation.Language.FunctionDefinitionAst]-and$pai.Name-eq'Executar-NativoOperacao'){$auxiliar=$true;break}
   }
   if(!$auxiliar){"${Arquivo}:$($comando.Extent.StartLineNumber): captura de stderr fora de Executar-NativoOperacao"}
  }
 }
}
# Todo objeto Process retornado e guardado precisa do handle enquanto esta vivo.
# PS5.1/.NET Framework pode perder ExitCode apos Refresh/HasExited sem ele.
# Exige captura imediata tambem onde hoje so se consulta HasExited; evita ter
# de inferir aliases, colecoes e consumidores em outros arquivos.
function Encontrar-ProcessosSemHandle([string]$Codigo,[string]$Arquivo) {
 $erros=$null;$ast=[Management.Automation.Language.Parser]::ParseInput($Codigo,[ref]$null,[ref]$erros)
 if($erros.Count){throw "Sintaxe invalida: $Arquivo"}
 foreach($comando in $ast.FindAll({param($n) $n-is[Management.Automation.Language.CommandAst]-and($n.GetCommandName()-split'\\')[-1]-eq'Start-Process'},$true)){
  $atribuicao=$comando.Parent.Parent
  if($atribuicao-isnot[Management.Automation.Language.AssignmentStatementAst]){continue}
  $retorna=@($comando.CommandElements|Where-Object {($_-is[Management.Automation.Language.CommandParameterAst]-and$_.ParameterName-eq'PassThru')-or($_-is[Management.Automation.Language.VariableExpressionAst]-and$_.Splatted)})
  if(!$retorna.Count){continue}
  $bloco=$atribuicao.Parent;$seguinte=$null
  for($i=0;$i-lt$bloco.Statements.Count-1;$i++){
   if($bloco.Statements[$i]-eq$atribuicao){$seguinte=$bloco.Statements[$i+1];break}
  }
  $captura='^\[void\]\s*'+[regex]::Escape($atribuicao.Left.Extent.Text)+'\.Handle$'
  if(!$seguinte-or$seguinte.Extent.Text-notmatch$captura){"${Arquivo}:$($comando.Extent.StartLineNumber): Start-Process -PassThru exige [void]$($atribuicao.Left.Extent.Text).Handle imediatamente apos iniciar"}
 }
}
foreach($codigo in @('$p=Start-Process node -PassThru; $p.WaitForExit(); $p.ExitCode','$p=Start-Process node -PassThru; $p.Refresh(); [void]$p.Handle','$p=Microsoft.PowerShell.Management\Start-Process @argumentos')){
 if(!@(Encontrar-ProcessosSemHandle $codigo 'fixture.ps1').Count){throw 'Guarda aceitou processo sem handle imediato.'}
}
foreach($codigo in @('$p=Start-Process node -PassThru; [void]$p.Handle; $p.WaitForExit()','$ps[$nome]=Start-Process node -PassThru; [void]$ps[$nome].Handle','$p=Microsoft.PowerShell.Management\Start-Process @argumentos;[void]$p.Handle',"Write-Output 'Start-Process node -PassThru'",'(Start-Process node -PassThru).Id')){
 if(@(Encontrar-ProcessosSemHandle $codigo 'fixture.ps1').Count){throw 'Guarda recusou captura valida, string ou consumo apenas do PID.'}
}
# Os formatos ficam restritos ao auxiliar inclusive com executavel dinamico:
# classificar pelo nome ou PATH deixaria passar & $exe e membros de objetos.
foreach($codigo in @('& git worktree add destino HEAD 2>&1','& $exe @argumentos *> $null','git status *> $null','& $w.Source install 2>&1')){
 if(!@(Encontrar-CapturasNativas $codigo 'scripts/fixture.ps1').Count){throw 'Guarda aceitou chamada fora do auxiliar.'}
}
$seguro='function Executar-NativoOperacao { & $exe @argumentos 2>&1 }'
if(@(Encontrar-CapturasNativas $seguro 'scripts/operacao-logica.ps1').Count){throw 'Guarda recusou auxiliar canonico.'}
if(!@(Encontrar-CapturasNativas $seguro 'scripts/outro.ps1').Count){throw 'Guarda aceitou auxiliar falso.'}
if(@(Encontrar-CapturasNativas '# & git status 2>&1' 'scripts/fixture.ps1').Count-or@(Encontrar-CapturasNativas "Write-Output '& git status *> `$null'" 'scripts/fixture.ps1').Count){throw 'Guarda interpretou comentario/string como comando.'}
$arquivos=@(Get-ChildItem -LiteralPath (Join-Path $Raiz 'scripts'),(Join-Path $Raiz 'portal/scripts') -Recurse -File -Filter '*.ps1')
$achados=@(foreach($arquivo in $arquivos){
 $relativo=$arquivo.FullName.Substring($Raiz.Length+1).Replace('\','/')
 $codigo=[IO.File]::ReadAllText($arquivo.FullName)
 Encontrar-CapturasNativas $codigo $relativo
 Encontrar-ProcessosSemHandle $codigo $relativo
})
if($achados.Count){throw ("Chamadas nativas/processos fora das guardas:`n"+($achados-join"`n"))}
# Aviso em stderr com exit 0 nao e falha. Exit nao zero continua sendo falha.
$node=(Get-Command node -CommandType Application -ErrorAction Stop|Select-Object -First 1).Source
$antes=Get-Variable LASTEXITCODE -ValueOnly -ErrorAction SilentlyContinue
try{
 $global:LASTEXITCODE=42
 foreach($codigo in @(0,7)){
  $codigoNode="console.error('aviso ficticio');console.log('saida ficticia');process.exit($codigo);"
  $r=Executar-NativoOperacao $node @('-e',$codigoNode)
  if($r.codigo-ne$codigo-or($r.saida-join' ')-notlike'*aviso ficticio*'-or($r.saida-join' ')-notlike'*saida ficticia*'-or$ErrorActionPreference-ne'Stop'-or$LASTEXITCODE-ne42){throw 'Auxiliar perdeu saida/codigo ou alterou preferencia do chamador.'}
 }
}finally{$global:LASTEXITCODE=$antes}
# Filho real: captura antes de Refresh/HasExited, como no acompanhamento do CI.
foreach($codigo in @(0,7,17)){
 $processo=Start-Process $node -ArgumentList @('-e',("process.exit($codigo)")) -PassThru;[void]$processo.Handle
 try{
  $prazo=[Diagnostics.Stopwatch]::StartNew()
  while($true){
   $processo.Refresh();if($processo.HasExited){break}
   if($prazo.Elapsed.TotalSeconds-ge10){throw 'Filho da guarda excedeu 10 s.'}
   Start-Sleep -Milliseconds 50
  }
  $processo.WaitForExit()
  if($processo.ExitCode-ne$codigo){throw "Processo perdeu ExitCode: esperado=$codigo; recebido=$($processo.ExitCode)"}
 }finally{if(!$processo.HasExited){$processo.Kill()};$processo.Dispose()}
}
Write-Host "PASSOU: $($arquivos.Count) scripts conferidos; capturas restritas ao auxiliar; handles imediatos; stderr e ExitCode 0/7/17 conferidos."
