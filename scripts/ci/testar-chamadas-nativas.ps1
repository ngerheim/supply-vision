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
 Encontrar-CapturasNativas ([IO.File]::ReadAllText($arquivo.FullName)) $relativo
})
if($achados.Count){throw ("Chamadas nativas devem usar Executar-NativoOperacao:`n"+($achados-join"`n"))}
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
Write-Host "PASSOU: $($arquivos.Count) scripts conferidos; capturas restritas ao auxiliar; stderr/codigos testados sob Stop."
