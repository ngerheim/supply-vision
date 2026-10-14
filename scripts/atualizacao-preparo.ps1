# Funcoes sem efeitos ao carregar; todos os destinos pertencem ao worktree novo.
function Nova-PastaPreparo([string]$Raiz) {
 return Join-Path (Split-Path $Raiz -Parent) ('.'+(Split-Path $Raiz -Leaf)+'-preparo-'+[guid]::NewGuid().ToString('N'))
}
function Validar-PastaPreparo([string]$Raiz,[string]$Preparo) {
 $r=[IO.Path]::GetFullPath($Raiz);$p=[IO.Path]::GetFullPath($Preparo)
 $prefixo='.'+(Split-Path $r -Leaf)+'-preparo-'
 if((Split-Path $p -Parent)-ne(Split-Path $r -Parent)-or(Split-Path $p -Leaf)-notmatch('^'+[regex]::Escape($prefixo)+'[0-9a-f]{32}$')){throw 'Pasta de preparo fora do local autorizado.'}
 if((Test-Path $p)-and((Get-Item -LiteralPath $p -Force).Attributes-band[IO.FileAttributes]::ReparsePoint)){throw 'Preparo nao pode ser um link.'}
}
function Copiar-ArvoreDependencias([string]$Origem,[string]$Destino,[string[]]$Bases,[int]$Profundidade=0) {
 if($Profundidade-gt64){throw 'Ciclo ou profundidade excessiva nas dependencias.'}
 $item=Get-Item -LiteralPath $Origem -Force
 if($item.Attributes-band[IO.FileAttributes]::ReparsePoint){
  $alvo=@($item.Target)[0]
  if(!$alvo){throw 'Link de dependencia sem destino verificavel.'}
  if(![IO.Path]::IsPathRooted($alvo)){$alvo=Join-Path (Split-Path $Origem -Parent) $alvo}
  $alvo=[IO.Path]::GetFullPath($alvo)
  $seguro=$false
  foreach($base in $Bases){if($alvo.StartsWith($base,[StringComparison]::OrdinalIgnoreCase)){$seguro=$true}}
  if(!$seguro){throw 'Link de dependencia fora de node_modules/venv/vendor; preparo cancelado.'}
  # Materializa o destino. Nenhum link para instalacao/preparo sobrevive a troca.
  Copiar-ArvoreDependencias $alvo $Destino $Bases ($Profundidade+1)
  return
 }
 if($item.PSIsContainer){
  New-Item -ItemType Directory -Force $Destino|Out-Null
  foreach($filho in @(Get-ChildItem -LiteralPath $Origem -Force)){
   Copiar-ArvoreDependencias $filho.FullName (Join-Path $Destino $filho.Name) $Bases ($Profundidade+1)
  }
 }else{Copy-Item -LiteralPath $Origem -Destination $Destino -Force}
}
function Copiar-DependenciasPreparo([string]$Origem,[string]$Destino) {
 # Nunca usar junction/hardlink: testes e npm podem escrever nos pacotes.
 if(!(Test-Path -LiteralPath $Origem -PathType Container)){return $false}
 $base=[IO.Path]::GetFullPath($Origem).TrimEnd('\','/')+[IO.Path]::DirectorySeparatorChar
 $bases=@($base)
 if((Split-Path $Origem -Leaf)-eq'node_modules'){
  $bases+=([IO.Path]::GetFullPath((Join-Path (Split-Path $Origem -Parent) 'vendor'))+[IO.Path]::DirectorySeparatorChar)
 }
 Copiar-ArvoreDependencias $Origem $Destino $bases
 return $true
}
function Trocar-ArtefatosPreparo([string]$Raiz,[string]$Preparo) {
 Validar-PastaPreparo $Raiz $Preparo
 foreach($rel in @('portal/dist','portal/node_modules','alertas/.venv')){
  $destino=Join-Path $Raiz $rel;$novo=Join-Path $Preparo $rel;$antigo=Join-Path $Preparo ('anteriores/'+$rel)
  if(!(Test-Path -LiteralPath $novo -PathType Container)){throw "Artefato preparado ausente: $rel"}
  New-Item -ItemType Directory -Force (Split-Path $antigo -Parent)|Out-Null
  if(Test-Path -LiteralPath $destino){[IO.Directory]::Move($destino,$antigo)}
  # Marcador antes da segunda renomeacao permite reverter tambem troca parcial.
  [IO.File]::WriteAllText((Join-Path $Preparo ('trocado-'+($rel-replace'[/\\]','-'))),'ok')
  [IO.Directory]::Move($novo,$destino)
 }
}
function Restaurar-ArtefatosPreparo([string]$Raiz,[string]$Preparo) {
 Validar-PastaPreparo $Raiz $Preparo
 foreach($rel in @('portal/dist','portal/node_modules','alertas/.venv')){
  $marca=Join-Path $Preparo ('trocado-'+($rel-replace'[/\\]','-'))
  $destino=Join-Path $Raiz $rel;$antigo=Join-Path $Preparo ('anteriores/'+$rel);$falho=Join-Path $Preparo ('reprovados/'+$rel)
  # Uma falha ao gravar o marcador pode vir DEPOIS de guardar o anterior.
  if(!(Test-Path -LiteralPath $marca)-and!(Test-Path -LiteralPath $antigo)){continue}
  New-Item -ItemType Directory -Force (Split-Path $falho -Parent)|Out-Null
  if(Test-Path -LiteralPath $destino){[IO.Directory]::Move($destino,$falho)}
  if(Test-Path -LiteralPath $antigo){[IO.Directory]::Move($antigo,$destino)}
  if(Test-Path -LiteralPath $marca){Remove-Item -LiteralPath $marca -Force}
 }
}
function Inicializar-PreparoNativo {
 if($env:OS-ne'Windows_NT'-or('SupplyVision.PreparoNativo' -as [type])){return}
 Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.ComponentModel;
using System.Runtime.InteropServices;
namespace SupplyVision {
 public static class PreparoNativo {
  // Handle nao herdavel, propriedade exclusiva deste processo. O SO o fecha
  // na saida (inclusive crash/exit), encerrando TODOS os descendentes do job.
  private static IntPtr job = IntPtr.Zero;
  [StructLayout(LayoutKind.Sequential)] struct Basic {
   public long processTime, jobTime; public uint flags;
   public UIntPtr minWorking, maxWorking; public uint active;
   public UIntPtr affinity; public uint priority, scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct Counters {
   public ulong readOps, writeOps, otherOps, readBytes, writeBytes, otherBytes;
  }
  [StructLayout(LayoutKind.Sequential)] struct Extended {
   public Basic basic; public Counters io;
   public UIntPtr processMemory, jobMemory, peakProcess, peakJob;
  }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct FindData {
   public uint attributes;
   public System.Runtime.InteropServices.ComTypes.FILETIME creation, access, write;
   public uint sizeHigh, sizeLow, reserved0, reserved1;
   [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string name;
   [MarshalAs(UnmanagedType.ByValTStr, SizeConst=14)] public string alternate;
  }
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr security, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int kind, IntPtr info, uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern uint GetFileAttributesW(string path);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool SetFileAttributesW(string path, uint attrs);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr FindFirstFileW(string path, out FindData data);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool FindNextFileW(IntPtr find, out FindData data);
  [DllImport("kernel32.dll")] static extern bool FindClose(IntPtr find);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool DeleteFileW(string path);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool RemoveDirectoryW(string path);
  public static void EntrarJob() {
   if(job != IntPtr.Zero) return;
   IntPtr novo = CreateJobObject(IntPtr.Zero, null);
   if(novo == IntPtr.Zero) throw new Win32Exception();
   IntPtr buffer = IntPtr.Zero;
   try {
    Extended info = new Extended(); info.basic.flags = 0x2000; // KILL_ON_JOB_CLOSE
    int size = Marshal.SizeOf(typeof(Extended)); buffer = Marshal.AllocHGlobal(size);
    Marshal.StructureToPtr(info, buffer, false);
    if(!SetInformationJobObject(novo, 9, buffer, (uint)size) || !AssignProcessToJobObject(novo, GetCurrentProcess())) throw new Win32Exception();
    job = novo; novo = IntPtr.Zero;
   } finally { if(buffer != IntPtr.Zero) Marshal.FreeHGlobal(buffer); if(novo != IntPtr.Zero) CloseHandle(novo); }
  }
  public static void Remover(string path) {
   string full = Path.GetFullPath(path);
   RemoverInterno(full.StartsWith(@"\\") ? @"\\?\UNC\" + full.Substring(2) : @"\\?\" + full);
  }
  static void RemoverInterno(string path) {
   uint attrs = GetFileAttributesW(path);
   if(attrs == UInt32.MaxValue) { int e = Marshal.GetLastWin32Error(); if(e == 2 || e == 3) return; throw new Win32Exception(e, path); }
   bool dir = (attrs & 0x10) != 0, link = (attrs & 0x400) != 0;
   // Junction/symlink e folha: nem atributos nem conteudo do alvo sao tocados.
   if(dir && !link) {
    FindData data; IntPtr find = FindFirstFileW(path + @"\*", out data);
    if(find == new IntPtr(-1)) { int e = Marshal.GetLastWin32Error(); if(e != 2) throw new Win32Exception(e, path); }
    else try {
     do { if(data.name != "." && data.name != "..") RemoverInterno(path + @"\" + data.name); } while(FindNextFileW(find, out data));
     int e = Marshal.GetLastWin32Error(); if(e != 18) throw new Win32Exception(e, path);
    } finally { FindClose(find); }
   }
   if(!link && !SetFileAttributesW(path, (attrs & ~7U) == 0 ? 0x80U : attrs & ~7U)) throw new Win32Exception(Marshal.GetLastWin32Error(), path);
   if(!(dir ? RemoveDirectoryW(path) : DeleteFileW(path))) throw new Win32Exception(Marshal.GetLastWin32Error(), path);
  }
 }
}
'@
}
function Entrar-JobPreparo {
 if($env:OS-ne'Windows_NT'){return} # Suites portaveis usam processos simulados.
 Inicializar-PreparoNativo
 [SupplyVision.PreparoNativo]::EntrarJob()
}
function Processo-DestePreparo($Processo,[string]$Preparo) {
 $prefixo=[IO.Path]::GetFullPath($Preparo).TrimEnd('\','/')
 $padrao='(?i)(?:^|[\s"''=])'+[regex]::Escape($prefixo)+'[\\/]'
 return [string]$Processo.CommandLine-match$padrao
}
function Encerrar-ProcessosPreparo([string]$Raiz,[string]$Preparo) {
 Validar-PastaPreparo $Raiz $Preparo
 if($env:OS-ne'Windows_NT'){return}
 foreach($p in @(Get-CimInstance Win32_Process -ErrorAction Stop)){
  if($p.ProcessId-eq$PID-or!(Processo-DestePreparo $p $Preparo)){continue}
  if((Get-Command Processo-OrfaoDestaInstalacao -ErrorAction SilentlyContinue)-and(Processo-OrfaoDestaInstalacao $p $Raiz)){continue}
  $atual=Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ProcessId)" -ErrorAction Stop
  if(!$atual-or$atual.CreationDate-ne$p.CreationDate-or!(Processo-DestePreparo $atual $Preparo)){continue}
  $encerrador=Start-Process taskkill.exe -ArgumentList @('/PID',"$($p.ProcessId)",'/T','/F') -PassThru -WindowStyle Hidden
  try{if(!$encerrador.WaitForExit(3000)){$encerrador.Kill();throw "Prazo excedido ao encerrar PID $($p.ProcessId) do preparo."}}finally{$encerrador.Dispose()}
  $restante=Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ProcessId)" -ErrorAction Stop
  if($restante-and$restante.CreationDate-eq$p.CreationDate-and(Processo-DestePreparo $restante $Preparo)){throw "PID $($p.ProcessId) do preparo permaneceu vivo apos taskkill."}
 }
}
function Remover-ArvorePreparo([string]$Preparo) {
 if($env:OS-eq'Windows_NT'){Inicializar-PreparoNativo;[SupplyVision.PreparoNativo]::Remover($Preparo)}
 elseif(Test-Path -LiteralPath $Preparo){
  Get-ChildItem -LiteralPath $Preparo -Recurse -Force -File|Where-Object {!($_.Attributes-band[IO.FileAttributes]::ReparsePoint)}|ForEach-Object {$_.IsReadOnly=$false}
  Remove-Item -LiteralPath $Preparo -Recurse -Force
 }
}
function Limpar-PastaPreparo([string]$Raiz,[string]$Preparo) {
 if(!$Preparo){return}
 Validar-PastaPreparo $Raiz $Preparo
 $codigoAntes=$global:LASTEXITCODE;$preferencia=$ErrorActionPreference;$ultimo='';$processosEncerrados=$false
 try{
  for($t=0;$t-lt4;$t++){
   try{
    if(!$processosEncerrados){Encerrar-ProcessosPreparo $Raiz $Preparo;$processosEncerrados=$true}
    if(Test-Path -LiteralPath $Preparo){
     # Primeiro a arvore fisica: nunca delegar a Git a travessia de junctions.
     # Tambem funciona se uma tentativa anterior ja removeu o registro Git.
     Remover-ArvorePreparo $Preparo
    }
    if(Test-Path -LiteralPath $Preparo){throw 'Pasta permaneceu apos remocao.'}
    $ErrorActionPreference='Continue'
    $saida=@(& git -C $Raiz worktree remove --force $Preparo 2>&1)
    $saida=@(& git -C $Raiz worktree prune --expire now 2>&1);$codigo=$LASTEXITCODE
    $ErrorActionPreference=$preferencia
    if($codigo){throw "Git nao limpou o registro: $saida"}
    return
   }catch{$ultimo=$_.Exception.Message}
   if($t-lt3){Start-Sleep -Milliseconds (200*[math]::Pow(2,$t))}
  }
  throw "Limpeza do preparo pendente em $Preparo apos 4 tentativas: $ultimo"
 }finally{$ErrorActionPreference=$preferencia;$global:LASTEXITCODE=$codigoAntes}
}
function Limpar-PreparosAntigos([string]$Raiz,[hashtable]$Contexto=@{}) {
 Inicializar-PreparoNativo
 $prefixo='.'+(Split-Path $Raiz -Leaf)+'-preparo-'
 foreach($p in @(Get-ChildItem -LiteralPath (Split-Path $Raiz -Parent) -Directory -Force|Where-Object {$_.Name-match('^'+[regex]::Escape($prefixo)+'[0-9a-f]{32}$')})){
  try{Validar-PastaPreparo $Raiz $p.FullName}catch{Write-Warning $_.Exception.Message;continue}
  if($Contexto.preparo-eq$p.FullName-and$Contexto.fase-in@('codigo','iniciada','recuperando')){Write-Warning "Preparo preservado para recuperacao: $($p.FullName)";continue}
  $emUso=$false
  foreach($nome in @('preparo-processo.json','preparo-atualizador.json')){
   $identidade=Join-Path $p.FullName $nome
   if(!(Test-Path -LiteralPath $identidade)){continue}
   try{
    $j=Get-Content -LiteralPath $identidade -Raw|ConvertFrom-Json
    if([int]$j.pid-le0){throw 'PID invalido.'}
    $inicio=[datetime]::Parse($j.inicio).ToUniversalTime()
    $dono=Get-Process -Id ([int]$j.pid) -ErrorAction SilentlyContinue
    if($dono-and[math]::Abs(($dono.StartTime.ToUniversalTime()-$inicio).TotalSeconds)-lt2){Write-Warning "Preparo ainda em execucao; preservado: $($p.FullName)";$emUso=$true;break}
   }catch{Write-Warning "Identidade do preparo invalida; preservado: $($p.FullName). $($_.Exception.Message)";$emUso=$true;break}
  }
  if($emUso){continue}
  try{Limpar-PastaPreparo $Raiz $p.FullName}catch{Write-Warning $_.Exception.Message}
 }
}

function Proteger-ArgumentoAtualizacao([string]$Argumento) {
 # Regras CommandLineToArgvW, incluindo barras antes de aspas e no fim.
 $texto=[regex]::Replace($Argumento,'(\\*)"','$1$1\"')
 return '"'+[regex]::Replace($texto,'(\\+)$','$1$1')+'"'
}
function Executar-PowerShellOculto([string[]]$Argumentos,[string]$Executavel='powershell.exe') {
 # -WindowStyle sozinho esconde a janela so depois que powershell inicia.
 # CreateNoWindow impede a criacao do console, inclusive em chamada direta.
 $info=New-Object Diagnostics.ProcessStartInfo
 $info.FileName=$Executavel
 $info.Arguments=(@($Argumentos|ForEach-Object {Proteger-ArgumentoAtualizacao ([string]$_)})-join' ')
 $info.WorkingDirectory=(Get-Location).Path
 $info.UseShellExecute=$false;$info.CreateNoWindow=$true
 $info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
 $processo=New-Object Diagnostics.Process
 $processo.StartInfo=$info
 try{
  [void]$processo.Start()
  # Drena os dois canais ao mesmo tempo: npm/pytest nao podem bloquear num
  # buffer cheio de stderr, nem esperar EOF antes de ler stdout.
  $saida=$processo.StandardOutput.ReadToEndAsync();$erro=$processo.StandardError.ReadToEndAsync()
  $aviso=[Diagnostics.Stopwatch]::StartNew()
  while(!$processo.WaitForExit(500)){
   if($aviso.Elapsed.TotalSeconds-ge30){Write-Host 'Atualizacao em andamento; aguardando o processo oculto.';$aviso.Restart()}
  }
  $texto=$saida.GetAwaiter().GetResult();$falha=$erro.GetAwaiter().GetResult()
  if($texto){Write-Output $texto}
  if($falha){Write-Output $falha}
  $global:LASTEXITCODE=$processo.ExitCode
 }finally{$processo.Dispose()}
}
