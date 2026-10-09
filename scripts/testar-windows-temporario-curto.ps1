# Fixture exclusiva do CI: usuario comum, TEMP 8.3 e integracao SYSTEM.
$ErrorActionPreference='Stop'
if($env:SV_TESTES_INTEGRACAO_WINDOWS-ne'1'){Write-Host 'SKIPPED: cenario Windows 8.3 exige SV_TESTES_INTEGRACAO_WINDOWS=1 no CI.';return}
$raiz=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$pasta=Join-Path ([Environment]::GetFolderPath('Windows')) ('Temp\sv-curto-'+[guid]::NewGuid().ToString('N'))
$usuario='svteste'+[guid]::NewGuid().ToString('N').Substring(0,8)
$criouUsuario=$false
$tempAnterior=$env:TEMP;$tmpAnterior=$env:TMP;$cacheAnterior=$env:npm_config_cache
$chaveAnterior=$env:SV_TESTES_INTEGRACAO_WINDOWS
$gitCountAnterior=$env:GIT_CONFIG_COUNT;$gitKeyAnterior=$env:GIT_CONFIG_KEY_0;$gitValorAnterior=$env:GIT_CONFIG_VALUE_0
try{
 $perfil=Join-Path $pasta 'Users\automacao.ficticia'
 $longo=Join-Path $perfil 'AppData\Local\Temp'
 New-Item -ItemType Directory -Force $longo,(Join-Path $perfil 'AppData\Roaming')|Out-Null
 # Define um alias real, mesmo quando a criacao automatica de 8.3 esta desligada.
 & fsutil.exe file setshortname $perfil 'AUTO~1.FIC'|Out-Null
 if($LASTEXITCODE){throw 'Windows nao permitiu criar o alias 8.3 da fixture.'}
 Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class CaminhoCurtoTeste {
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
 public static extern uint GetShortPathName(string caminho, StringBuilder destino, uint tamanho);
}
'@
 $buffer=New-Object Text.StringBuilder 32768
 if(![CaminhoCurtoTeste]::GetShortPathName($longo,$buffer,32768)){throw 'Falha ao obter caminho curto real do Windows.'}
 $curto=$buffer.ToString()
 if($curto-notmatch 'AUTO~1\.FIC'){throw 'Fixture nao exercitou o nome curto com ponto.'}
 $env:TEMP=$curto;$env:TMP=$curto;$env:npm_config_cache=Join-Path $longo 'npm-cache'
 Write-Host "TEMP/TMP da fixture: $curto"

 # npm test igual ao atualizador, mas com uma conta que nao e administradora.
 $senha=ConvertTo-SecureString ('Aa!'+[guid]::NewGuid().ToString('N')) -AsPlainText -Force
 New-LocalUser -Name $usuario -Password $senha -AccountNeverExpires|Out-Null
 $criouUsuario=$true
 $conta=$env:COMPUTERNAME+'\'+$usuario
 & icacls.exe $pasta /grant ($conta+':(OI)(CI)M')|Out-Null
 if($LASTEXITCODE){throw 'Falha ao liberar somente a fixture para o usuario de teste.'}
 & icacls.exe $raiz /grant ($conta+':(OI)(CI)RX') /deny ($conta+':(OI)(CI)(W)')|Out-Null
 if($LASTEXITCODE){throw 'Falha ao tornar o checkout somente leitura para o usuario de teste.'}
 $tarefasAntes=@(Get-ScheduledTask|ForEach-Object {$_.TaskPath+$_.TaskName}|Sort-Object)
 $firewallAntes=@(Get-NetFirewallRule|Select-Object Name,Enabled,Action,Direction,Profile|Sort-Object Name|ConvertTo-Json -Depth 3)
 $gitAntes=(& git -C $raiz status --porcelain --untracked-files=all|Out-String)
 $npm=(Get-Command npm.cmd).Source
 $launcher=Join-Path $longo 'npm-comum.cmd'
 @"
@echo off
set "USERPROFILE=$perfil"
set "APPDATA=$perfil\AppData\Roaming"
set "LOCALAPPDATA=$perfil\AppData\Local"
powershell.exe -NoProfile -Command "if(([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){exit 1}; Write-Host 'Conta de teste sem elevacao confirmada'"
if errorlevel 1 exit /b 1
call "$npm" test
exit /b %errorlevel%
"@|Set-Content -LiteralPath $launcher -Encoding ASCII
 $env:GIT_CONFIG_COUNT='1';$env:GIT_CONFIG_KEY_0='safe.directory';$env:GIT_CONFIG_VALUE_0=$raiz
 $env:SV_TESTES_INTEGRACAO_WINDOWS=$null
 $proc=Start-Process -FilePath $env:ComSpec -Credential ([pscredential]::new($conta,$senha)) -WorkingDirectory (Join-Path $raiz 'portal') -ArgumentList @('/d','/c',('"'+$launcher+'"')) -RedirectStandardOutput (Join-Path $longo 'npm.log') -RedirectStandardError (Join-Path $longo 'npm-erro.log') -PassThru
 if(!$proc.WaitForExit(180000)){& taskkill.exe /PID $proc.Id /T /F|Out-Null;throw 'npm test sem elevacao excedeu 180 segundos.'}
 $proc.Refresh()
 Get-Content (Join-Path $longo 'npm.log'),(Join-Path $longo 'npm-erro.log')|Write-Host
 if($proc.ExitCode-ne0){throw "npm test sem elevacao falhou: $($proc.ExitCode)"}
 $tarefasDepois=@(Get-ScheduledTask|ForEach-Object {$_.TaskPath+$_.TaskName}|Sort-Object)
 $firewallDepois=@(Get-NetFirewallRule|Select-Object Name,Enabled,Action,Direction,Profile|Sort-Object Name|ConvertTo-Json -Depth 3)
 if(Compare-Object $tarefasAntes $tarefasDepois){throw 'npm test alterou tarefas agendadas.'}
 if(($firewallAntes-join '')-ne($firewallDepois-join '')){throw 'npm test alterou regras de firewall.'}
 if($gitAntes-ne(& git -C $raiz status --porcelain --untracked-files=all|Out-String)){throw 'npm test escreveu no checkout.'}
 Write-Host 'npm test sem elevacao: nenhuma tarefa, regra de firewall ou escrita no checkout.'

 # A mesma raiz curta agora exercita a copia e a migracao privilegiada.
 $env:SV_TESTES_INTEGRACAO_WINDOWS=$chaveAnterior
 Push-Location (Join-Path $raiz 'portal')
 try{
  & node --test --experimental-strip-types tests/migracao-windows.test.mjs
  if($LASTEXITCODE){throw 'Migracao SYSTEM com TEMP/TMP 8.3 falhou.'}
 }finally{Pop-Location}
}finally{
 $env:TEMP=$tempAnterior;$env:TMP=$tmpAnterior;$env:npm_config_cache=$cacheAnterior
 $env:SV_TESTES_INTEGRACAO_WINDOWS=$chaveAnterior
 $env:GIT_CONFIG_COUNT=$gitCountAnterior;$env:GIT_CONFIG_KEY_0=$gitKeyAnterior;$env:GIT_CONFIG_VALUE_0=$gitValorAnterior
 if($criouUsuario){
  & icacls.exe $raiz /remove:g $conta /remove:d $conta|Out-Null
  Remove-LocalUser -Name $usuario
 }
 if(Test-Path $pasta){Remove-Item -LiteralPath $pasta -Recurse -Force}
}
