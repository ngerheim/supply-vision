$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
$pasta=Join-Path ([IO.Path]::GetTempPath()) ('sv-reversao-'+[guid]::NewGuid().ToString('N'))
function Git-Teste([string[]]$Argumentos){& git -C $pasta @Argumentos|Out-Null;if($LASTEXITCODE){throw 'Git da fixture falhou'}}
try{
 New-Item -ItemType Directory $pasta|Out-Null
 Git-Teste @('init');Git-Teste @('config','user.name','Ficticio');Git-Teste @('config','user.email','ficticio@example.com')
 Set-Content (Join-Path $pasta '.gitignore') "privado/`nignorado.txt`nignorado-novo.txt"
 Set-Content (Join-Path $pasta 'existente.txt') 'antigo'
 Git-Teste @('add','.');Git-Teste @('commit','-m','anterior')
 $ant=(& git -C $pasta rev-parse HEAD|Out-String).Trim()
 Set-Content (Join-Path $pasta 'novo com espaco.txt') 'novo'
 Set-Content (Join-Path $pasta 'ignorado-novo.txt') 'ficticio'
 New-Item -ItemType Directory (Join-Path $pasta 'privado')|Out-Null
 Set-Content (Join-Path $pasta 'privado/ficticio.txt') 'privado ficticio'
 Git-Teste @('add','novo com espaco.txt');Git-Teste @('add','-f','ignorado-novo.txt','privado/ficticio.txt');Git-Teste @('commit','-m','nova')
 $nova=(& git -C $pasta rev-parse HEAD|Out-String).Trim()
 $arquivos=@(& git -C $pasta -c core.quotepath=false diff --name-only --diff-filter=A "${ant}..${nova}" --)
 Git-Teste @('reset','--hard',$ant)
 # Reproduz os arquivos novos que restaram como nao rastreados apos o reset.
 Set-Content (Join-Path $pasta 'novo com espaco.txt') 'residuo'
 Set-Content (Join-Path $pasta 'usuario.txt') 'preservar'
 Set-Content (Join-Path $pasta 'ignorado.txt') 'preservar ignorado'
 Set-Content (Join-Path $pasta 'ignorado-novo.txt') 'preservar ignorado novo'
 New-Item -ItemType Directory -Force (Join-Path $pasta 'privado')|Out-Null
 Set-Content (Join-Path $pasta 'privado/ficticio.txt') 'preservar privado'
 Remover-ArquivosIntroduzidos $pasta $arquivos
 if(Test-Path (Join-Path $pasta 'novo com espaco.txt')){throw 'Arquivo introduzido bloqueia a proxima atualizacao.'}
 foreach($arq in @('existente.txt','usuario.txt','ignorado.txt','ignorado-novo.txt','privado/ficticio.txt')){if(!(Test-Path (Join-Path $pasta $arq))){throw "Arquivo indevidamente removido: $arq"}}
 if((Get-Content (Join-Path $pasta 'privado/ficticio.txt') -Raw).Trim()-ne'preservar privado'){throw 'Privado ficticio alterado'}
 Write-Host 'PASSOU: reversao remove somente introduzidos; preserva existentes, arquivos do usuario, ignorados e privado ficticio.'
}finally{if(Test-Path $pasta){Remove-Item -LiteralPath $pasta -Recurse -Force}}
