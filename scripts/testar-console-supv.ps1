# Console real descartavel no Windows; nunca altera o console do runner.
param([ValidateSet('teste','cliente','sinal')][string]$Modo='teste',[string]$Pasta,[int]$Cliente)
$ErrorActionPreference='Stop'
if($env:OS-ne'Windows_NT'){Write-Host 'PULADO: console nativo e Ctrl+C exigem Windows.';return}
. (Join-Path $PSScriptRoot 'supv.ps1')
Inicializar-TipoConsoleSupv
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SupvConsoleTeste {
 [DllImport("kernel32.dll")] public static extern bool AllocConsole();
 [DllImport("kernel32.dll")] public static extern bool FreeConsole();
 [DllImport("kernel32.dll")] public static extern bool AttachConsole(uint id);
 [DllImport("kernel32.dll")] public static extern bool SetStdHandle(int id, IntPtr h);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr CreateFile(string name,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
 [DllImport("kernel32.dll")] public static extern bool SetConsoleCtrlHandler(IntPtr handler,bool add);
 [DllImport("kernel32.dll")] public static extern bool GenerateConsoleCtrlEvent(uint e,uint group);
 public static IntPtr Input() { return CreateFile("CONIN$",0xC0000000u,3,IntPtr.Zero,3,0,IntPtr.Zero); }
}
'@
if($Modo-eq'cliente'){
 [void][SupvConsoleTeste]::FreeConsole()
 if(![SupvConsoleTeste]::AllocConsole()){throw 'AllocConsole falhou.'}
 $h=[SupvConsoleTeste]::Input();[void][SupvConsoleTeste]::SetStdHandle(-10,$h)
 [uint32]$original=0
 if(![SupplyVision.ConsoleAcompanhamento]::GetConsoleMode($h,[ref]$original)){throw 'Console sem modo.'}
 $original=$original-bor0xC0
 [void][SupplyVision.ConsoleAcompanhamento]::SetConsoleMode($h,$original)
 # stdout redirecionado: wrapper nao altera modo nem precisa de console.
 if(Suspender-QuickEditSupv){throw 'Redirecionamento alterou console.'}
 $g=[SupplyVision.ConsoleAcompanhamento]::Begin()
 if(!$g){throw 'Guard nao iniciou.'}
 [uint32]$atual=0;[void][SupplyVision.ConsoleAcompanhamento]::GetConsoleMode($h,[ref]$atual)
 if($atual-band0x40){throw 'QuickEdit continuou ligado.'}
 $g.Dispose();[void][SupplyVision.ConsoleAcompanhamento]::GetConsoleMode($h,[ref]$atual)
 if($atual-ne$original){throw 'Dispose nao restaurou modo completo.'}
 $g=[SupplyVision.ConsoleAcompanhamento]::Begin()
 [IO.File]::WriteAllText((Join-Path $Pasta 'pronto'),[string]$original)
 try{while($true){Start-Sleep -Milliseconds 100}}finally{if($g){$g.Dispose()}}
 exit 0
}
if($Modo-eq'sinal'){
 [void][SupvConsoleTeste]::FreeConsole()
 if(![SupvConsoleTeste]::AttachConsole($Cliente)){throw 'AttachConsole falhou.'}
 [void][SupvConsoleTeste]::SetConsoleCtrlHandler([IntPtr]::Zero,$true)
 $h=[SupvConsoleTeste]::Input()
 if(![SupvConsoleTeste]::GenerateConsoleCtrlEvent(0,0)){throw 'CTRL_C_EVENT falhou.'}
 $p=Get-Process -Id $Cliente -ErrorAction SilentlyContinue
 if($p-and!$p.WaitForExit(5000)){throw 'Ctrl+C nao encerrou cliente.'}
 [uint32]$atual=0
 if(![SupplyVision.ConsoleAcompanhamento]::GetConsoleMode($h,[ref]$atual)){throw 'Leitura apos Ctrl+C falhou.'}
 $original=[uint32][IO.File]::ReadAllText((Join-Path $Pasta 'pronto'))
 if($atual-ne$original){throw 'Ctrl+C nao restaurou modo completo.'}
 exit 0
}
$base=Join-Path ([IO.Path]::GetTempPath()) ('supv-console-'+[guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($base)
$p=$null
try{
 $hostTeste=(Get-Process -Id $PID).Path
 $p=Start-Process $hostTeste -ArgumentList ('-NoProfile -File "'+$PSCommandPath+'" -Modo cliente -Pasta "'+$base+'"') -PassThru -RedirectStandardOutput (Join-Path $base 'saida.log') -RedirectStandardError (Join-Path $base 'erro.log')
 $tempo=[Diagnostics.Stopwatch]::StartNew()
 while(!(Test-Path (Join-Path $base 'pronto'))){
  if($p.HasExited-or$tempo.Elapsed.TotalSeconds-gt15){throw ('Cliente sem console: '+(Get-Content (Join-Path $base 'erro.log') -Raw))}
  Start-Sleep -Milliseconds 100
 }
 $sinal=Executar-NativoOperacao $hostTeste @('-NoProfile','-File',$PSCommandPath,'-Modo','sinal','-Pasta',$base,'-Cliente',[string]$p.Id)
 if($sinal.codigo-ne0){throw ($sinal.saida-join"`n")}
 Write-Host 'PASSOU: QuickEdit desativado, modo integral restaurado por Dispose e Ctrl+C real; redirecionamento sem efeito.'
}finally{
 if($p){if(!$p.HasExited){$p.Kill()};$p.Dispose()}
 Remove-Item -LiteralPath $base -Recurse -Force -ErrorAction SilentlyContinue
}
