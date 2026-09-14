[CmdletBinding()]
param([switch]$SomenteVerificar,[switch]$SemTestes,[switch]$SemBuild)
$ErrorActionPreference='Stop'
$Raiz=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Portal=Join-Path $Raiz 'portal'; $Alertas=Join-Path $Raiz 'alertas'; $Privado=Join-Path $Raiz 'privado'
function Etapa([string]$m){Write-Host "`n==> $m" -ForegroundColor Cyan}
function Localizar-Comando([string]$nome){
  foreach($c in @(Get-Command $nome -All -ErrorAction SilentlyContinue)){
    $origem=[string]$c.Source
    if(!$origem-or!(Test-Path -LiteralPath $origem -PathType Leaf)){continue}
    if($nome-eq'python.exe'-and$origem-like '*\Microsoft\WindowsApps\python.exe'){continue}
    return $origem
  }
  if($nome-eq'python.exe'){
    $padroes=@(
      (Join-Path $env:LocalAppData 'Programs\Python\Python*\python.exe'),
      (Join-Path $env:ProgramFiles 'Python*\python.exe')
    )
    foreach($c in @($padroes|ForEach-Object{Get-ChildItem -Path $_ -File -ErrorAction SilentlyContinue}|Sort-Object FullName -Descending)){
      return [string]$c.FullName
    }
  }
  return $null
}
function Comando([string]$nome,[string]$pacote,[string]$descricao){
  $c=Localizar-Comando $nome
  if($c){return $c}
  if($SomenteVerificar){throw "$descricao nao encontrado. Execute INSTALAR.bat."}
  $w=Get-Command winget.exe -ErrorAction SilentlyContinue
  if(!$w){throw "$descricao ausente e winget indisponivel. Instale-o e execute novamente."}
  Etapa "Instalando $descricao"
  $saidaWinget=@(& $w.Source install --id $pacote --exact --accept-package-agreements --accept-source-agreements 2>&1)
  $codigoWinget=$LASTEXITCODE
  $saidaWinget|ForEach-Object{Write-Host $_}
  if($codigoWinget){throw "Falha ao instalar $descricao (codigo $codigoWinget)."}
  $env:Path=[Environment]::GetEnvironmentVariable('Path','Machine')+';'+[Environment]::GetEnvironmentVariable('Path','User')
  $c=Localizar-Comando $nome
  if(!$c){throw "$descricao foi instalado, mas o Windows ainda nao o disponibilizou. Reinicie o Windows e execute INSTALAR.bat novamente."}
  return $c
}
function Versao([string]$exe,[version]$min,[string]$nome){
  $t=(& $exe --version 2>&1|Select-Object -First 1)
  if($t -notmatch '(\d+)\.(\d+)\.(\d+)'){throw "Nao foi possivel identificar a versao de $nome em: $t"}
  $v=[version]"$($Matches[1]).$($Matches[2]).$($Matches[3])"
  if($v-lt$min){throw "$nome $v encontrado; necessario $min ou superior."}; Write-Host "$nome $v OK"
}
function Copiar([string]$origem,[string]$destino){
  if(Test-Path -LiteralPath $destino){return}; New-Item -ItemType Directory -Force (Split-Path $destino)|Out-Null
  Copy-Item -LiteralPath $origem -Destination $destino; Write-Host "Criado modelo privado: $destino"
}
function Rodar([string]$exe,[string[]]$Argumentos,[string]$pasta){
  Push-Location $pasta; try{& $exe @Argumentos; if($LASTEXITCODE){throw "Falha: $exe $($Argumentos-join ' ')"}}finally{Pop-Location}
}
Etapa 'Verificando a estrutura'
foreach($c in @($Portal,$Alertas,(Join-Path $Portal 'package-lock.json'),(Join-Path $Alertas 'config\requirements.txt'))){if(!(Test-Path -LiteralPath $c)){throw "Item obrigatorio ausente: $c"}}
$Node=Comando 'node.exe' 'OpenJS.NodeJS.LTS' 'Node.js'; $Python=Comando 'python.exe' 'Python.Python.3.12' 'Python'
Versao $Node ([version]'22.13.0') 'Node.js'; Versao $Python ([version]'3.11.0') 'Python'
$Npm=Join-Path (Split-Path $Node) 'npm.cmd'; if(!(Test-Path $Npm)){$Npm=Comando 'npm.cmd' 'OpenJS.NodeJS.LTS' 'npm'}
if($SomenteVerificar){Write-Host 'Estrutura e requisitos verificados. Nenhum arquivo foi alterado.' -ForegroundColor Green; exit 0}
Etapa 'Preparando a area privada sem sobrescrever dados'
@('comum','portal\backups','portal\banco\estado','portal\configuracao','portal\logs','alertas\config','alertas\dados','alertas\logs','alertas\parametros\de_para','alertas\parametros\filtros','alertas\relatorios\diarios','alertas\relatorios\historicos')|ForEach-Object{New-Item -ItemType Directory -Force (Join-Path $Privado $_)|Out-Null}
Copiar "$Raiz\compartilhado\smtp.env.example" "$Privado\comum\smtp.env"
Copiar "$Raiz\compartilhado\operacao.env.example" "$Privado\comum\operacao.env"
Copiar "$Portal\portal.env.example" "$Privado\portal\configuracao\portal.env"
Copiar "$Alertas\config\cfg_ambiente.exemplo.txt" "$Privado\alertas\config\cfg_ambiente.txt"
Copiar "$Alertas\config\cfg_qlik.exemplo.txt" "$Privado\alertas\config\cfg_qlik.txt"
Copiar "$Alertas\config\destinatarios.exemplo.txt" "$Privado\alertas\config\destinatarios.txt"
Copiar "$Alertas\parametros\de_para\itens.exemplo.csv" "$Privado\alertas\parametros\de_para\itens.csv"
Copiar "$Alertas\parametros\de_para\modelos.exemplo.csv" "$Privado\alertas\parametros\de_para\modelos.csv"
foreach($n in @('excluir_descricoes','excluir_fornecedores','excluir_grupos_despesa','excluir_modelos')){Copiar "$Alertas\parametros\filtros\$n.exemplo.txt" "$Privado\alertas\parametros\filtros\$n.txt"}
$amb="@echo off`r`nREM Gerado pelo INSTALAR.bat. Caminho portatil.`r`nset `"PYTHON=%~dp0..\..\..\alertas\.venv\Scripts\python.exe`"`r`n"
[IO.File]::WriteAllText("$Privado\alertas\config\ambiente.bat",$amb,[Text.Encoding]::ASCII)
Etapa 'Instalando dependencias do Portal'; Rodar $Npm @('ci','--include=dev','--audit=false') $Portal
Etapa 'Instalando dependencias dos Alertas'
$PyVenv="$Alertas\.venv\Scripts\python.exe"; if(!(Test-Path $PyVenv)){Rodar $Python @('-m','venv',"$Alertas\.venv") $Raiz}
Rodar $PyVenv @('-m','pip','install','--upgrade','pip') $Raiz
Rodar $PyVenv @('-m','pip','install','-r',"$Alertas\config\requirements.txt",'-r',"$Alertas\config\requirements-dev.txt") $Raiz
if(!$SemTestes){Etapa 'Validando o Portal'; Rodar $Npm @('run','lint') $Portal; Rodar $Npm @('run','typecheck') $Portal; Rodar $Npm @('test') $Portal; Rodar $Npm @('audit','--omit=dev','--include=prod') $Portal; Etapa 'Validando os Alertas'; Rodar $PyVenv @('-m','pytest','-q') $Alertas}
if(!$SemBuild){Etapa 'Gerando o Portal'; Rodar $Npm @('run','build') $Portal}
Etapa 'Validando a operacao integrada'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Raiz 'scripts\testar-operacao.ps1')
if($LASTEXITCODE){throw 'Testes da logica operacional falharam.'}
if(!$SemTestes){
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Raiz 'scripts\testar-supervisor-isolado.ps1')
  if($LASTEXITCODE){throw 'Teste isolado do supervisor falhou.'}
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Raiz 'scripts\testar-persistencia-alertas.ps1')
  if($LASTEXITCODE){throw 'Teste de persistencia dos alertas falhou.'}
}
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Raiz 'scripts\validar-operacao.ps1') -Raiz $Raiz
if($LASTEXITCODE){throw 'Configuracao operacional reprovada.'}
if(Test-Path (Join-Path $Privado 'portal\backups\portal-atual.sqlite')){Rodar $Node @('scripts\testar-restauracao.mjs') $Portal}
Write-Host "`nSupply Vision instalado e validado." -ForegroundColor Green
$Startup=Join-Path ([Environment]::GetFolderPath('Startup')) 'Supply Vision.cmd'
$Inicio=Join-Path $Raiz 'INICIAR.bat'
$linha="@echo off`r`nstart `"`" `"$Inicio`"`r`n"
[IO.File]::WriteAllText($Startup,$linha,[Text.Encoding]::ASCII)
Write-Host 'Inicializacao automatica no login do Windows configurada.'
