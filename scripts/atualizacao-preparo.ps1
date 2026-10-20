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
function Resolver-CaminhoDependencia([string]$Caminho,[int]$Saltos=0) {
 if($Saltos-gt64){throw 'Ciclo no caminho de dependencia.'}
 $completo=[IO.Path]::GetFullPath($Caminho);$atual=[IO.Path]::GetPathRoot($completo)
 $partes=@($completo.Substring($atual.Length)-split'[\\/]'|Where-Object {$_})
 for($i=0;$i-lt$partes.Count;$i++){
  $atual=Join-Path $atual $partes[$i]
  if(!(Test-Path -LiteralPath $atual)){continue}
  $item=Get-Item -LiteralPath $atual -Force
  if($item.Attributes-band[IO.FileAttributes]::ReparsePoint){
   $alvo=@($item.Target)[0]
   if(!$alvo){throw 'Link de dependencia sem destino verificavel.'}
   if(![IO.Path]::IsPathRooted($alvo)){$alvo=Join-Path (Split-Path $atual -Parent) $alvo}
   for($j=$i+1;$j-lt$partes.Count;$j++){$alvo=Join-Path $alvo $partes[$j]}
   return Resolver-CaminhoDependencia $alvo ($Saltos+1)
  }
 }
 return $atual
}
function Copiar-ArvoreDependencias([string]$Origem,[string]$Destino,[string[]]$Bases,[int]$Profundidade=0) {
 if($Profundidade-gt64){throw 'Ciclo ou profundidade excessiva nas dependencias.'}
 $real=Resolver-CaminhoDependencia $Origem
 $seguro=$false
 foreach($base in $Bases){
  $limite=[IO.Path]::GetFullPath($base).TrimEnd('\','/')
  if($real-eq$limite-or$real.StartsWith($limite+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){$seguro=$true}
 }
 if(!$seguro){throw 'Link de dependencia fora de node_modules/venv/vendor; preparo cancelado.'}
 if((Resolver-CaminhoDependencia $Destino)-ne[IO.Path]::GetFullPath($Destino)){throw 'Link no destino de dependencia; preparo cancelado.'}
 $item=Get-Item -LiteralPath $Origem -Force
 if($item.Attributes-band[IO.FileAttributes]::ReparsePoint){
  $alvo=$real
  # Materializa o destino. Nenhum link para instalacao/preparo sobrevive a troca.
  $medirLink=!!(Get-Command Iniciar-PassoPreparo -ErrorAction SilentlyContinue)
  if($medirLink){Iniciar-PassoPreparo ('Materializacao de junction: '+$item.Name)}
  $codigoLink='falhou'
  try{Copiar-ArvoreDependencias $alvo $Destino $Bases ($Profundidade+1);$codigoLink='0'}finally{if($medirLink){Concluir-PassoPreparo $codigoLink}}
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
 $script:MetodoCopiaDependencias='recursiva (links ou robocopy indisponivel)'
 if((Usar-RobocopyDependencias)-and(Testar-ArvoreFisica $Origem)){
  Executar-RobocopyDependencias $Origem $Destino
  if((Testar-ArvoreFisica $Origem)-and(Testar-ArvoreFisica $Destino)){$script:MetodoCopiaDependencias='robocopy /MT:16';return $true}
  # Um link surgiu durante a copia: apaga apenas a copia isolada e usa
  # a materializacao conservadora; nunca segue o link pelo robocopy.
  Remover-ArvorePreparo $Destino
 }
 Copiar-ArvoreDependencias $Origem $Destino $bases
 return $true
}
# npm cria junction para pacote file: de pasta (vendor/fast-glob-compat).
# Materializa somente cada link, no proprio lugar e com a mesma validacao de
# destino de Copiar-ArvoreDependencias. Copiar a arvore inteira por causa de
# um unico link levava 171 s no servidor; o resto ja e fisico.
function Materializar-LinksDependencias([string]$Modulos) {
 $base=[IO.Path]::GetFullPath($Modulos).TrimEnd('\','/')+[IO.Path]::DirectorySeparatorChar
 $bases=@($base,([IO.Path]::GetFullPath((Join-Path (Split-Path $Modulos -Parent) 'vendor'))+[IO.Path]::DirectorySeparatorChar))
 $total=0
 # Um link por volta: o destino copiado pode trazer links novos.
 for($volta=0;$volta-lt256;$volta++){
  $link=@(Get-ChildItem -LiteralPath $Modulos -Recurse -Force -Attributes ReparsePoint -ErrorAction Stop|Select-Object -First 1)
  if(!$link.Count){return $total}
  $caminho=$link[0].FullName;$temporario=$caminho+'.sv-materializado'
  if(Test-Path -LiteralPath $temporario){Remover-ArvorePreparo $temporario}
  Copiar-ArvoreDependencias $caminho $temporario $bases
  # Delete nao recursivo remove o link, nunca o conteudo do destino.
  if($link[0].PSIsContainer){[IO.Directory]::Delete($caminho,$false)}else{[IO.File]::Delete($caminho)}
  if($link[0].PSIsContainer){[IO.Directory]::Move($temporario,$caminho)}else{[IO.File]::Move($temporario,$caminho)}
  $total++
 }
 throw 'Links demais nas dependencias; preparo cancelado.'
}
# Reserva e copia usam apenas arvores fisicas. Qualquer reparse point exige
# materializacao pelo caminho conservador, inclusive links internos.
function Inicializar-ArvoreDependencias {
 if('SupplyVision.ArvoreDependencias' -as [type]){return}
 Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
using System.ComponentModel;
namespace SupplyVision {
 public static class ArvoreDependencias {
  static void AncestraisSemLinks(string path) {
   for(string p = Path.GetFullPath(path); !String.IsNullOrEmpty(p); p = Path.GetDirectoryName(p)) {
    if((File.GetAttributes(p) & FileAttributes.ReparsePoint) != 0) throw new IOException("Reparse point nas dependencias: " + p);
   }
  }
  public static void SemLinks(string path) { AncestraisSemLinks(path); Conferir(new DirectoryInfo(path), 0); }
  static void Conferir(DirectoryInfo directory, int depth) {
   if(depth > 64) throw new IOException("Profundidade excessiva nas dependencias.");
   foreach(FileSystemInfo item in directory.EnumerateFileSystemInfos()) {
    if((item.Attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("Reparse point nas dependencias: " + item.FullName);
    if((item.Attributes & FileAttributes.Directory) != 0) Conferir((DirectoryInfo)item, depth + 1);
   }
  }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, ExactSpelling = true)]
  static extern SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
  static void ConferirUso(string path) {
   if(Environment.OSVersion.Platform == PlatformID.Win32NT) {
    // Acesso apenas a metadados: share=0 ainda recusa handles de leitura/escrita,
    // sem abrir conteudo nem disparar uma leitura/varredura do pacote inteiro.
    using(SafeFileHandle handle = CreateFileW(path, 0, 0, IntPtr.Zero, 3, 0x00200000, IntPtr.Zero)) {
     if(handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error(), path);
    }
   } else using(FileStream handle = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.None, 1)) { }
  }
  static string Hex(byte[] bytes) { return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant(); }
  // resíduos de instalações antigas (workerd); remover só quando nenhuma reserva ou instalação os tiver
  static bool Cache(string name) { return name == ".cache" || name == ".mf" || name == ".wrangler" || name == ".miniflare" || name == "__pycache__"; }
  static void Inventariar(string root, DirectoryInfo directory, StringBuilder entries, ref long files, ref long dirs, int depth, Action<string> limpar) {
   if(depth > 64) throw new IOException("Profundidade excessiva nas dependencias.");
   // FileSystemInfo reutiliza os metadados retornados pela enumeracao no Windows.
   // Ordenacao ordinal torna a assinatura independente da ordem do filesystem.
   List<FileSystemInfo> children = new List<FileSystemInfo>(directory.EnumerateFileSystemInfos());
   children.Sort(delegate(FileSystemInfo a, FileSystemInfo b) { return StringComparer.Ordinal.Compare(a.Name, b.Name); });
   foreach(FileSystemInfo item in children) {
    string p = item.FullName, rel = p.Substring(root.Length).Replace('\\', '/');
    if((item.Attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("Reparse point nas dependencias: " + p);
    if((item.Attributes & FileAttributes.Directory) != 0) {
     if(limpar != null && Cache(item.Name)) { SemLinks(p); limpar(p); continue; }
     dirs++; entries.Append("D:").Append(rel.Length).Append(':').Append(rel).Append('\n');
     Inventariar(root, (DirectoryInfo)item, entries, ref files, ref dirs, depth + 1, limpar);
    } else {
     ConferirUso(p);
     FileInfo f = (FileInfo)item;
     files++; entries.Append("F:").Append(rel.Length).Append(':').Append(rel).Append(':').Append(f.Length).Append(':').Append(f.LastWriteTimeUtc.Ticks).Append('\n');
    }
   }
  }
  public static string Inventario(string path) { return Inventario(path, null); }
  public static string Inventario(string path, Action<string> limpar) {
   AncestraisSemLinks(path); StringBuilder entries = new StringBuilder(); long files = 0, dirs = 0;
   Inventariar(Path.GetFullPath(path), new DirectoryInfo(path), entries, ref files, ref dirs, 0, limpar);
   // SHA256 apenas do texto dos metadados, nao do conteudo dos arquivos.
   using(SHA256 hash = SHA256.Create()) return "metadados-v2;arquivos=" + files + ";pastas=" + dirs + ";assinatura=" + Hex(hash.ComputeHash(Encoding.UTF8.GetBytes(entries.ToString())));
  }

 }
}
'@
}
function Testar-ArvoreFisica([string]$Pasta) {
 try{Inicializar-ArvoreDependencias;[SupplyVision.ArvoreDependencias]::SemLinks($Pasta);return $true}catch{return $false}
}
function Usar-RobocopyDependencias {
 return $env:OS-eq'Windows_NT'-and!!(Get-Command robocopy.exe -ErrorAction SilentlyContinue)
}
function Executar-RobocopyDependencias([string]$Origem,[string]$Destino) {
 $antes=Get-Variable LASTEXITCODE -Scope Global -ValueOnly -ErrorAction SilentlyContinue
 try{
  # Nao segue links que aparecam durante a copia. Conferencia posterior
  # recusa links copiados ou omitidos; nunca entrega uma arvore parcial.
  & robocopy.exe $Origem $Destino /E /MT:16 /COPY:DAT /DCOPY:DAT /XJ /SL /SJ /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  $codigo=$LASTEXITCODE
  if($codigo-lt0-or$codigo-ge8){throw "Robocopy de dependencias falhou: codigo=$codigo."}
 }finally{$global:LASTEXITCODE=$antes}
}
function Pasta-ReservaDependencias([string]$Raiz) {
 return Join-Path (Split-Path ([IO.Path]::GetFullPath($Raiz)) -Parent) ('.'+(Split-Path $Raiz -Leaf)+'-dependencias-reserva')
}
function Mesmo-VolumeDependencias([string]$Raiz,[string]$Preparo) {
 # Exige arvores fisicas tambem nos ancestrais. Montagens/junctions nunca
 # transformam a comparacao de letra da unidade em uma falsa garantia.
 foreach($p in @($Raiz,$Preparo)){
  for($a=[IO.Path]::GetFullPath($p);$a;$a=Split-Path $a -Parent){
   if((Test-Path -LiteralPath $a)-and((Get-Item -LiteralPath $a -Force).Attributes-band[IO.FileAttributes]::ReparsePoint)){return $false}
  }
 }
 return [IO.Path]::GetPathRoot([IO.Path]::GetFullPath($Raiz))-eq[IO.Path]::GetPathRoot([IO.Path]::GetFullPath($Preparo))
}
# engines.node da raiz e requisito de partida, nao altera node_modules. O Node
# efetivamente executado continua na assinatura; engines dos pacotes permanecem.
function Hash-ManifestoNodeDependencias([string]$Arquivo) {
 if(!(Get-Command Executar-NativoOperacao -ErrorAction SilentlyContinue)){. (Join-Path $PSScriptRoot 'operacao-logica.ps1')}
 # Node le tambem a chave vazia packages[''] do lockfile, incompativel com
 # ConvertFrom-Json do PS5.1. Sem dependencias nem leitor da versao do Portal.
 $codigo=@'
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const arquivo = process.argv[1];
const manifesto = JSON.parse(fs.readFileSync(arquivo, 'utf8').replace(/^\uFEFF/, ''));
const raiz = path.basename(arquivo) === 'package-lock.json' ? manifesto.packages?.[''] : manifesto;
if (raiz?.engines && Object.hasOwn(raiz.engines, 'node')) {
 delete raiz.engines.node;
 if (!Object.keys(raiz.engines).length) delete raiz.engines;
}
function ordenar(valor) {
 if (Array.isArray(valor)) return valor.map(ordenar);
 if (valor && typeof valor === 'object') return Object.fromEntries(Object.keys(valor).sort().map(k => [k, ordenar(valor[k])]));
 return valor;
}
console.log(crypto.createHash('sha256').update(JSON.stringify(ordenar(manifesto))).digest('hex'));
'@
 $r=Executar-NativoOperacao 'node' @('-e',$codigo,$Arquivo)
 if($r.codigo-or$r.stdout.Count-ne1-or$r.stdout[0]-cnotmatch'^[a-f0-9]{64}$'){throw 'Nao foi possivel assinar manifesto Node.'}
 # Prefixo distingue hashes legados; reservas antigas sao recusadas com seguranca.
 return 'node-v1:'+$r.stdout[0]
}
function Testar-DependenciasNodeIguais($Origem,$Destino) {
 if(!$Origem-or!$Destino-or$Origem.node-cne$Destino.node){return $false}
 foreach($rel in @('portal/package-lock.json','portal/package.json')){
  $a=$Origem.hashes.$rel;$b=$Destino.hashes.$rel
  if($a-cnotmatch'^node-v1:[a-f0-9]{64}$'-or$a-cne$b){return $false}
 }
 return $true
}
function Obter-AssinaturaDependencias([string]$Raiz,[string]$Python) {
 $antes=Get-Variable LASTEXITCODE -Scope Global -ValueOnly -ErrorAction SilentlyContinue
 try{
  $sha=(& git -C $Raiz rev-parse HEAD).Trim();if($LASTEXITCODE-or$sha-notmatch'^[0-9a-f]{40}$'){throw 'SHA de origem invalido.'}
  $arquivos=@('portal/package-lock.json','portal/package.json')+@(Get-ChildItem -LiteralPath (Join-Path $Raiz 'alertas/config') -Filter 'requirements*.txt' -File|Sort-Object Name|ForEach-Object {'alertas/config/'+$_.Name})
  if($arquivos.Count-lt3){throw 'Requirements ausentes.'}
  $hashes=[ordered]@{}
  foreach($rel in $arquivos){
   $item=Get-Item -LiteralPath (Join-Path $Raiz $rel) -Force
   if($item.Attributes-band[IO.FileAttributes]::ReparsePoint){throw 'Manifesto de dependencias e link.'}
   $hashes[$rel]=if($rel-like'portal/package*.json'){Hash-ManifestoNodeDependencias $item.FullName}else{(Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash}
  }
  $node=(& node --version|Out-String).Trim();if($LASTEXITCODE-or$node-notmatch'^v\d+\.\d+\.\d+$'){throw 'Versao Node desconhecida.'}
  $pythonVersao=(& $Python --version|Out-String).Trim();if($LASTEXITCODE-or$pythonVersao-notmatch'^Python \d+\.\d+\.\d+$'){throw 'Versao Python desconhecida.'}
  return @{formato=2;sha=$sha;data=[datetime]::UtcNow.ToString('o');node=$node;python=$pythonVersao;hashes=$hashes}
 }finally{$global:LASTEXITCODE=$antes}
}
function Comparar-AssinaturaDependencias($Registro,$Atual) {
 if($Registro.formato-ne2-or$Registro.sha-notmatch'^[0-9a-f]{40}$'-or!$Registro.data){return 'registro invalido'}
 try{[void][datetime]::Parse($Registro.data)}catch{return 'data invalida'}
 if($Registro.node-cne$Atual.node){return 'Node diferente'}
 if($Registro.python-cne$Atual.python){return 'Python diferente'}
 foreach($rel in @('portal/package-lock.json','portal/package.json')){if($Registro.hashes.$rel-cne$Atual.hashes[$rel]){return 'lockfile/package diferente'}}
 $registrados=@($Registro.hashes.PSObject.Properties|Where-Object Name -Like 'alertas/config/requirements*.txt'|Sort-Object Name)
 $novos=@($Atual.hashes.Keys|Where-Object {$_-like'alertas/config/requirements*.txt'}|Sort-Object)
 if($registrados.Count-ne$novos.Count){return 'requirements diferentes'}
 foreach($rel in $novos){if($Registro.hashes.$rel-cne$Atual.hashes[$rel]){return 'requirements diferentes'}}
 return ''
}
function Inventariar-ReservaLimpa([string]$Pasta) {
 Inicializar-ArvoreDependencias
 # Delegate chamado so por pasta de cache, nunca por arquivo do inventario.
 return [SupplyVision.ArvoreDependencias]::Inventario($Pasta,[Action[string]]{param($cache) Remover-ArvorePreparo $cache})
}
function Descartar-ReservaDependencias([string]$Raiz,[string]$Preparo) {
 Validar-PastaPreparo $Raiz $Preparo
 $reserva=Pasta-ReservaDependencias $Raiz
 if(Test-Path -LiteralPath $reserva){
  # Mesmo se um handle impedir a renomeacao, nunca reutilizar uma reserva
  # que ja foi recusada. Nao escreve atraves de junction/ancestral externo.
  $item=Get-Item -LiteralPath $reserva -Force
  if($item.PSIsContainer-and(Mesmo-VolumeDependencias $Raiz $Preparo)-and!($item.Attributes-band[IO.FileAttributes]::ReparsePoint)){
   $marca=Join-Path $reserva 'descartar'
   if(!(Get-Item -LiteralPath $marca -Force -ErrorAction SilentlyContinue)){
    # CreateNew nunca sobrescreve/segue um link que apareca como marcador.
    $m=[IO.File]::Open($marca,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None);$m.Dispose()
   }
  }
  # Quarentena dentro do worktree: worker de limpeza ja existente apaga
  # depois, com as mesmas barreiras contra links, processos e producao.
  $descarte=Join-Path $Preparo ('reserva-descartada-'+[guid]::NewGuid().ToString('N'))
  if($item.PSIsContainer){[IO.Directory]::Move($reserva,$descarte)}else{[IO.File]::Move($reserva,$descarte)}
 }
}
function Reserva-DependenciasEmUso([string]$Pasta) {
 if($env:OS-ne'Windows_NT'){return $false}
 # Falha de consulta tambem impede reutilizacao. Handles abertos sao
 # conferidos separadamente pelo inventario com FileShare.None.
 foreach($p in @(Get-CimInstance Win32_Process -ErrorAction Stop)){
  if((Processo-DestePreparo $p $Pasta)-or($p.ExecutablePath-and$p.ExecutablePath.StartsWith($Pasta+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase))){return $true}
 }
 return $false
}
# Mede tambem consultas/limpeza da reserva, antes de Dependencias Node/Python.
# O worker de limpeza reutiliza a mesma logica sem depender do preparador.
function Executar-PassoReserva([string]$Nome,[scriptblock]$Codigo) {
 $medir=!!(Get-Command Iniciar-PassoPreparo -ErrorAction SilentlyContinue)
 if($medir){Iniciar-PassoPreparo $Nome}
 $resultado='falhou'
 try{& $Codigo;$resultado='0'}finally{if($medir){Concluir-PassoPreparo $resultado}}
}
function Usar-ReservaDependencias([string]$Raiz,[string]$Preparo,$Atual,[string]$Impedimento='') {
 Validar-PastaPreparo $Raiz $Preparo
 $reserva=Pasta-ReservaDependencias $Raiz;$tomada=Join-Path $Preparo 'reserva-tomada'
 $motivo='reserva ausente';$h=$null
 if(!(Test-Path -LiteralPath $reserva)){return @{usada=$false;motivo=$motivo}}
 try{
  $medir=!!(Get-Command Iniciar-PassoPreparo -ErrorAction SilentlyContinue)
  if($medir){Iniciar-PassoPreparo 'Conferencia geral da reserva'}
  $codigoConferencia='falhou'
  try{
   if($Impedimento){throw $Impedimento}
   if(Test-Path -LiteralPath (Join-Path $reserva 'descartar')){throw 'reserva pendente de descarte'}
   if(!(Mesmo-VolumeDependencias $Raiz $Preparo)){throw 'volume diferente ou ancestral com link'}
   $arquivoRegistro=Join-Path $reserva 'registro.json'
   if(!(Mesmo-VolumeDependencias $reserva $arquivoRegistro)){throw 'registro com reparse point'}
   $h=[IO.File]::Open($arquivoRegistro,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)
   $leitor=New-Object IO.StreamReader($h);$registro=$leitor.ReadToEnd()|ConvertFrom-Json -ErrorAction Stop
   # Versao antes de qualquer travessia dos pacotes (inclusive caches/links).
   if($registro.formato-ne2){throw 'formato antigo da reserva'}
   if(!$Atual){throw 'metadados/ambiente indisponiveis'}
   if(!(Testar-ArvoreFisica $reserva)){throw 'reserva com reparse point ou incompleta'}
   if(Reserva-DependenciasEmUso $reserva){throw 'reserva em uso'}
   $motivo=Comparar-AssinaturaDependencias $registro $Atual;if($motivo){throw $motivo}
   # SHA e proveniencia: deve existir no repositorio e ser ancestral do
   # destino. Nao se exige SHA igual ao destino (isso impediria atualizar).
   & git -C $Raiz merge-base --is-ancestor $registro.sha $Atual.sha
   if($LASTEXITCODE){throw 'SHA de origem nao e ancestral do destino'}
   $codigoConferencia='0'
  }finally{if($medir){Concluir-PassoPreparo $codigoConferencia}}
  foreach($rel in @('portal/node_modules','alertas/.venv')){
   $p=Join-Path $reserva $rel
   $tipo=if($rel-eq'portal/node_modules'){'Node'}else{'Python'}
   Executar-PassoReserva ("Conferencia da reserva $tipo") {
    if(!(Test-Path -LiteralPath $p -PathType Container)){throw 'reserva incompleta'}
    if((Inventariar-ReservaLimpa $p)-cne$registro.inventarios.$rel){throw 'reserva incompleta, corrompida ou em uso'}
   }
  }
  if($medir){Iniciar-PassoPreparo 'Consumo da reserva'}
  $codigoConsumo='falhou'
  try{
   $h.Dispose();$h=$null
   foreach($rel in @('portal/node_modules','alertas/.venv')){if(Test-Path -LiteralPath (Join-Path $Preparo $rel)){throw 'destino de dependencias ja existe'}}
   [IO.Directory]::Move($reserva,$tomada)
   foreach($rel in @('portal/node_modules','alertas/.venv')){
    $destino=Join-Path $Preparo $rel
    [void][IO.Directory]::CreateDirectory((Split-Path $destino -Parent))
    [IO.Directory]::Move((Join-Path $tomada $rel),$destino)
   }
   $codigoConsumo='0'
   return @{usada=$true;motivo='registro, ambiente e integridade conferidos'}
  }finally{if($medir){Concluir-PassoPreparo $codigoConsumo}}
 }catch{
  $motivo=$_.Exception.Message
  # Falha na segunda renomeacao nao pode deixar uma mistura de caminhos.
  if(Test-Path -LiteralPath $tomada){
   foreach($rel in @('portal/node_modules','alertas/.venv')){
    $destino=Join-Path $Preparo $rel;$origem=Join-Path $tomada $rel
    if((Test-Path -LiteralPath $destino)-and!(Test-Path -LiteralPath $origem)){[IO.Directory]::Move($destino,$origem)}
   }
  }
 }finally{if($h){$h.Dispose()}}
 try{Executar-PassoReserva 'Descarte da reserva' {Descartar-ReservaDependencias $Raiz $Preparo}}catch{Write-Warning ('Reserva pendente de descarte: '+$_.Exception.Message)}
 return @{usada=$false;motivo=$motivo}
}
function Guardar-ReservaDependencias([string]$Raiz,[string]$Preparo) {
 Validar-PastaPreparo $Raiz $Preparo
 if(!(Mesmo-VolumeDependencias $Raiz $Preparo)){return $false}
 $reserva=Pasta-ReservaDependencias $Raiz;$candidata=Join-Path $Preparo 'reserva-nova'
 # Chamada somente depois de gravar contexto concluido. Antes disso os
 # anteriores pertencem exclusivamente ao rollback; TROCAR nao muda.
 $registro=Get-Content -LiteralPath (Join-Path $Preparo 'dependencias-origem.json') -Raw|ConvertFrom-Json -ErrorAction Stop
 if(Test-Path -LiteralPath $candidata){throw 'Destino de reserva nova ja existe; sem reserva.'}
 $inventarios=[ordered]@{}
 foreach($rel in @('portal/node_modules','alertas/.venv')){
  $p=Join-Path $Preparo ('anteriores/'+$rel)
  $tipo=if($rel-eq'portal/node_modules'){'Node'}else{'Python'}
  $inventarios[$rel]=Executar-PassoReserva ("Inventario da reserva $tipo") {
   Inventariar-ReservaLimpa $p
  }
 }
 Descartar-ReservaDependencias $Raiz $Preparo
 foreach($rel in @('portal/node_modules','alertas/.venv')){
  $p=Join-Path $candidata $rel;[void][IO.Directory]::CreateDirectory((Split-Path $p -Parent))
  [IO.Directory]::Move((Join-Path $Preparo ('anteriores/'+$rel)),$p)
 }
 $registro.formato=2
 $registro.data=[datetime]::UtcNow.ToString('o')
 $registro|Add-Member -NotePropertyName inventarios -NotePropertyValue $inventarios -Force
 [IO.File]::WriteAllText((Join-Path $candidata 'registro.json'),($registro|ConvertTo-Json -Depth 6))
 # Publicacao atomica: reserva parcial nunca aparece no endereco reutilizavel.
 [IO.Directory]::Move($candidata,$reserva)
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
  [DllImport("kernel32.dll")] static extern uint GetCurrentProcessId();
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, IntPtr info, uint size, out uint returned);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool member);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process, uint code);
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
  public static void EncerrarFilhos() {
   if(job == IntPtr.Zero) return;
   // O processo raiz precisa sobreviver para limpar seu proprio worktree.
   // Revalida a associacao ao job para nao matar um PID reciclado da producao.
   IntPtr buffer = Marshal.AllocHGlobal(65536);
   DateTime limite = DateTime.UtcNow.AddSeconds(3);
   try {
    while(true) {
     uint returned;
     if(!QueryInformationJobObject(job, 3, buffer, 65536, out returned)) throw new Win32Exception();
     int count = Marshal.ReadInt32(buffer, 4), filhos = 0;
     for(int i = 0; i < count; i++) {
      uint pid = (uint)(IntPtr.Size == 8 ? Marshal.ReadInt64(buffer, 8 + i * 8) : Marshal.ReadInt32(buffer, 8 + i * 4));
      if(pid == GetCurrentProcessId()) continue;
      filhos++;
      IntPtr process = OpenProcess(0x1001, false, pid);
      if(process == IntPtr.Zero) { int e = Marshal.GetLastWin32Error(); if(e == 87) continue; throw new Win32Exception(e); }
      try {
       bool member;
       if(!IsProcessInJob(process, job, out member)) throw new Win32Exception();
       if(member && !TerminateProcess(process, 1)) { int e = Marshal.GetLastWin32Error(); if(e != 5) throw new Win32Exception(e); }
      } finally { CloseHandle(process); }
     }
     if(filhos == 0) return;
     if(DateTime.UtcNow >= limite) throw new IOException("Filhos do PREPARAR nao encerraram em 3 s.");
     System.Threading.Thread.Sleep(50);
    }
   } finally { Marshal.FreeHGlobal(buffer); }
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
function Encerrar-FilhosPreparo {
 if($env:OS-eq'Windows_NT'){[SupplyVision.PreparoNativo]::EncerrarFilhos()}
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
  $encerrador=Start-Process taskkill.exe -ArgumentList @('/PID',"$($p.ProcessId)",'/T','/F') -PassThru -WindowStyle Hidden;[void]$encerrador.Handle
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
 if(!(Get-Command Executar-NativoOperacao -ErrorAction SilentlyContinue)){. (Join-Path $PSScriptRoot 'operacao-logica.ps1')}
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
    [void](Executar-NativoOperacao 'git' @('-C',$Raiz,'worktree','remove','--force',$Preparo))
    $resultadoPrune=Executar-NativoOperacao 'git' @('-C',$Raiz,'worktree','prune','--expire','now')
    $saida=$resultadoPrune.saida;$codigo=$resultadoPrune.codigo
    if($codigo){throw "Git nao limpou o registro: $saida"}
    return
   }catch{$ultimo=$_.Exception.Message}
   if($t-lt3){Start-Sleep -Milliseconds (200*[math]::Pow(2,$t))}
  }
  throw "Limpeza do preparo pendente em $Preparo apos 4 tentativas: $ultimo"
 }finally{$ErrorActionPreference=$preferencia;$global:LASTEXITCODE=$codigoAntes}
}
function Limpar-PreparosAntigos([string]$Raiz,[hashtable]$Contexto=@{},[string]$PreparoAtual='', [switch]$SomenteReprovados) {
 Inicializar-PreparoNativo
 $prefixo='.'+(Split-Path $Raiz -Leaf)+'-preparo-'
 foreach($p in @(Get-ChildItem -LiteralPath (Split-Path $Raiz -Parent) -Directory -Force|Where-Object {$_.Name-match('^'+[regex]::Escape($prefixo)+'[0-9a-f]{32}$')})){
  try{Validar-PastaPreparo $Raiz $p.FullName}catch{Write-Warning $_.Exception.Message;continue}
  if($p.FullName-eq$PreparoAtual){continue}
  # Bootstrap pelo preparador novo: sem ler contexto privado da producao,
  # conserva qualquer pasta que possa conter artefatos aprovados/de socorro.
  if($SomenteReprovados-and((Test-Path (Join-Path $p.FullName 'preparo-aprovado'))-or(Test-Path (Join-Path $p.FullName 'anteriores')))){
   Write-Warning "Preparo aprovado/recuperacao preservado: $($p.FullName)";continue
  }
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

function Registrar-LinhaTempoAtualizacao([string]$Caminho,[string]$Texto) {
 $codigo=Get-Variable LASTEXITCODE -ValueOnly -ErrorAction SilentlyContinue
 Set-Variable -Name limiteLinhas -Value 500 -Option Constant
 try{
  for($tentativa=0;$tentativa-lt3;$tentativa++){
   $trava=$null;$arquivo=$null;$escritor=$null;$temporario=$null
   try{
    [void][IO.Directory]::CreateDirectory((Split-Path $Caminho -Parent))
    # Serializa os escritores (pai, PREPARAR e limpeza) durante append/rotacao.
    $trava=[IO.File]::Open(($Caminho+'.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    $arquivo=[IO.File]::Open($Caminho,[IO.FileMode]::Append,[IO.FileAccess]::Write,[IO.FileShare]::ReadWrite)
    $escritor=New-Object IO.StreamWriter($arquivo,(New-Object Text.UTF8Encoding($false)))
    $escritor.WriteLine($Texto);$escritor.Dispose();$escritor=$null;$arquivo=$null
    try{
     $linhas=@(Get-Content -LiteralPath $Caminho -Tail ($limiteLinhas+1) -Encoding UTF8 -ErrorAction Stop)
     if($linhas.Count-gt$limiteLinhas){
      $temporario=$Caminho+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
      [IO.File]::WriteAllLines($temporario,[string[]]$linhas[-$limiteLinhas..-1],(New-Object Text.UTF8Encoding($false)))
      [IO.File]::Replace($temporario,$Caminho,[NullString]::Value)
     }
    }catch{} # Se a troca falhar, o append ja esta preservado; tentar na proxima linha.
    return
   }catch{
    if($tentativa-eq2){Write-Warning 'Nao foi possivel gravar a medicao de tempos da atualizacao.' -WarningAction Continue}
   }finally{
    try{if($escritor){$escritor.Dispose()}elseif($arquivo){$arquivo.Dispose()}}catch{}
    if($temporario){Remove-Item -LiteralPath $temporario -Force -ErrorAction SilentlyContinue}
    if($trava){$trava.Dispose()}
   }
   if($tentativa-lt2){Start-Sleep -Milliseconds 100}
  }
 }catch{}finally{$global:LASTEXITCODE=$codigo}
}

function Formatar-MotivoPreparo([string]$Motivo) {
 # Expressoes de matriz do GitHub sao rotulos, nao registros de banco.
 return ([regex]::Replace($Motivo,'\$\{\{\s*([^{}]+?)\s*\}\}','($1)') -replace '\s+', ' ').Trim()
}

# CI conhecido pode bloquear a troca; indisponibilidade usa todas as suites.
function Consultar-APICIPreparo([string]$Caminho) {
 # Sem Authorization, sem token e sem ferramentas autenticadas do GitHub.
 try{Invoke-RestMethod -Uri ("https://api.github.com/repos/ngerheim/supply-vision/"+$Caminho) -Headers @{Accept='application/vnd.github+json';'User-Agent'='Supply-Vision-Preparo';'X-GitHub-Api-Version'='2022-11-28'} -TimeoutSec 8 -ErrorAction Stop}
 catch{$_.Exception.Data['CIPreparoAPI']=$true;throw}
}
function Obter-ChecksCIPreparo([string]$Sha) {
 $checks=@();$total=-1
 for($pagina=1;$pagina-le5;$pagina++){
  $j=Consultar-APICIPreparo "commits/$Sha/check-runs?per_page=100&filter=latest&page=$pagina"
  if($null-eq$j.total_count-or($j.total_count-isnot[int]-and$j.total_count-isnot[long])-or$j.total_count-le0-or$j.total_count-gt500-or$null-eq$j.check_runs){throw 'resposta inesperada da API de checks'}
  if($total-ge0-and$total-ne$j.total_count){throw 'total de checks mudou durante a consulta'};$total=$j.total_count
  $checks+=@($j.check_runs)
  if($checks.Count-ge$total){break}
  if(@($j.check_runs).Count-ne100){throw 'pagina de checks incompleta'}
 }
 if($checks.Count-ne$total){throw 'conjunto de checks incompleto'}
 foreach($c in $checks){
  if(!$c.name-or!$c.app.slug-or!$c.app.id){throw 'check sem nome ou identidade na resposta da API'}
  if($c.head_sha-cne$Sha){throw "SHA inesperado no check: $($c.name) ($($c.status)/$($c.conclusion))"}
  if($c.status-cnotin@('completed','queued','in_progress','pending','waiting','requested')){throw "estado inesperado no check: $($c.name)"}
 }
 return $checks
}
# O H2 so roda em PR. No push da main, o agregador e os grupos da matriz
# aparecem pulados; o GitHub pode registrar o nome sem expandir a matriz
# ("Atualizacao real - ${{ matrix.grupo }}"). Somente eles podem ser skipped.
function Testar-H2PuladoNaMain($Check) {
 return $Check.status-ceq'completed'-and$Check.conclusion-ceq'skipped'-and$Check.name-cmatch'^Atualizacao real( - .+)?$'
}
function Consultar-CIPRIdentica([string]$Sha,$ChecksMain) {
 $checks=$ChecksMain
 try{
  # O endpoint pode associar outras PRs ao commit. Exige uma unica PR mesclada
  # para main deste repositorio cujo commit final do merge seja o alvo exato.
  $prs=@()
  for($pagina=1;$pagina-le5;$pagina++){
   $resposta=Consultar-APICIPreparo "commits/$Sha/pulls?per_page=100&page=$pagina"
   $lote=@($resposta)
   $prs+=@($lote|Where-Object {$_.merged_at-and$_.state-ceq'closed'-and$_.merge_commit_sha-ceq$Sha-and$_.base.ref-ceq'main'-and$_.base.repo.full_name-ceq'ngerheim/supply-vision'})
   if($lote.Count-lt100){break}
   if($pagina-eq5){throw 'lista de PRs incompleta'}
  }
  if($prs.Count-ne1){throw 'PR de origem mesclada nao encontrada ou ambigua'}
  $pr=$prs[0];$head=[string]$pr.head.sha
  if($head-cnotmatch'^[0-9a-f]{40}$'-or!$pr.number){throw 'head SHA ou numero da PR invalido'}
  $main=Consultar-APICIPreparo "commits/$Sha"
  $origem=Consultar-APICIPreparo "commits/$head"
  if($main.sha-cne$Sha-or$origem.sha-cne$head-or$main.commit.tree.sha-cnotmatch'^[0-9a-f]{40}$'-or$origem.commit.tree.sha-cnotmatch'^[0-9a-f]{40}$'){throw 'resposta inesperada da API de commits'}
  if($main.commit.tree.sha-cne$origem.commit.tree.sha){throw "arvore diferente da PR #$($pr.number)"}
  $checksPR=@(Obter-ChecksCIPreparo $head)
  foreach($c in $checksPR){
   $skipMain=@($checks|Where-Object {$_.name-ceq$c.name-and$_.app.id-eq$c.app.id-and$_.app.slug-ceq$c.app.slug-and$_.status-ceq'completed'-and$_.conclusion-ceq'skipped'})
   if($c.status-cne'completed'-or($c.conclusion-cne'success'-and!($c.name-ceq'Atualizacao real'-and$c.conclusion-ceq'skipped'-and$skipMain.Count-eq1))){throw "check da PR nao aprovado: $($c.name) ($($c.status)/$($c.conclusion))"}
  }
  # Compara tambem checks extras observados na main, sem afrouxar jobs push-only.
  foreach($c in $checks){
   # Grupos do H2 pulados na main nao existem com esse nome na PR; o
   # agregador "Atualizacao real" da PR ja exige os dois grupos verdes.
   if((Testar-H2PuladoNaMain $c)-and$c.name-cne'Atualizacao real'){continue}
   $cobertura=@($checksPR|Where-Object {$_.name-ceq$c.name-and$_.app.id-eq$c.app.id-and$_.app.slug-ceq$c.app.slug})
   if($cobertura.Count-ne1){throw "check da main sem cobertura unica na PR (bloqueia): $($c.name)"}
  }
  return @{rapido=$true;sha=$Sha;motivo="CI da PR #$($pr.number) ($($head.Substring(0,7))) verde, conteudo identico ao da main ($($Sha.Substring(0,7)))"}
 }catch{return @{rapido=$false;indisponivel=[bool]$_.Exception.Data['CIPreparoAPI'];motivo=$_.Exception.Message}}
}
# A espera pertence ao PREPARAR; nenhuma falha conhecida da main autoriza TROCAR.
function Consultar-CIPreparo([string]$Sha,[switch]$ForcarCompleto,$Andamento=$null,
 [scriptblock]$Agora={ [datetime]::UtcNow },[scriptblock]$Pausa={param($Ms) Start-Sleep -Milliseconds $Ms}) {
 $completo=@{rapido=$false;sha=$Sha;motivo='resposta inesperada da API'}
 if($ForcarCompleto){$completo.motivo='preparo completo forcado';return $completo}
 if($Sha-notmatch'^[0-9a-f]{40}$'){$completo.motivo='SHA invalido';return $completo}
 $obrigatorios=@('Portal','Portal - instalacao nova e autenticacao real','PowerShell','Alertas','Atualizacao real')
 $motivoPrazo='Prazo de 30 min aguardando CI da main esgotado; modo completo'
 $inicio=& $Agora;$id=[guid]::NewGuid().ToString('N');$prConsultada=$false;$aguardou=$false;$motivoPR=''
 try{
  while($true){
   if(Testar-CancelamentoEsperaCI $Andamento $id){throw (New-Object OperationCanceledException 'Espera do CI cancelada; operacao continua no ar e preparo sera limpo.')}
   if($aguardou-and((& $Agora)-$inicio).TotalSeconds-ge1800){
    $completo.motivo="$motivoPrazo; check pendente: $($c.name) ($($c.status)); $incompleto $motivoPR";return $completo
   }
   try{$checks=@(Obter-ChecksCIPreparo $Sha)}
   catch{$completo.motivo='CI da main: consulta indisponivel ou invalida; modo completo: '+$_.Exception.Message;return $completo}
   # Falhas precedem pendencias e qualquer tentativa de aproveitar a PR.
   foreach($c in $checks){
    if($c.conclusion-cin@('failure','timed_out','cancelled','action_required','startup_failure')){
     return @{rapido=$false;bloqueado=$true;sha=$Sha;motivo="CI da main ($($Sha.Substring(0,7))) reprovado; check nao aprovado: $($c.name) ($($c.status)/$($c.conclusion)). Atualizacao cancelada SEM parar a operacao. Saidas: re-run no GitHub, PR de correcao, ou supv atualizar --completo."}
    }
    if(($c.conclusion-and$c.conclusion-cne'success'-and!(Testar-H2PuladoNaMain $c))-or($c.status-ceq'completed'-and!$c.conclusion)){
     $completo.motivo="check nao aprovado: $($c.name) ($($c.status)/$($c.conclusion)); modo completo";return $completo
    }
   }
   if(((& $Agora)-$inicio).TotalSeconds-ge1800){$completo.motivo=$motivoPrazo;return $completo}
   $incompleto=''
   foreach($nome in $obrigatorios){
    $encontrados=@($checks|Where-Object {$_.name-ceq$nome-and$_.app.slug-ceq'github-actions'-and$_.app.id-eq15368})
    if(!$encontrados.Count){$incompleto='check obrigatorio ausente: '+$nome;break}
    if($encontrados.Count-ne1){$incompleto='check obrigatorio ambiguo: '+$nome;break}
   }
   $pendentes=@($checks|Where-Object {$_.status-cne'completed'})
   if(!$pendentes.Count){
    if($incompleto){$completo.motivo=$incompleto+'; modo completo';return $completo}
    return @{rapido=$true;sha=$Sha;motivo="CI da main verde ($($Sha.Substring(0,7)))"}
   }
   if(!$prConsultada-and!$incompleto){
    $prConsultada=$true;$pr=Consultar-CIPRIdentica $Sha $checks
    if(((& $Agora)-$inicio).TotalSeconds-ge1800){$completo.motivo=$motivoPrazo;return $completo}
    if($pr.rapido){return $pr};$motivoPR=$pr.motivo
    if($pr.indisponivel){$completo.motivo='CI da main pendente; consulta indisponivel; modo completo: '+$motivoPR;return $completo}
   }
   $aguardou=$true
   $c=$pendentes[0]
   if(((& $Agora)-$inicio).TotalSeconds-ge1800){
    $completo.motivo="$motivoPrazo; check pendente: $($c.name) ($($c.status)); $incompleto $motivoPR";return $completo
   }
   $minutos=[math]::Floor(((& $Agora)-$inicio).TotalMinutes)
   $concluidos=@($checks|Where-Object {$_.status-ceq'completed'}).Count
   $mensagem="Aguardando CI da main ($($Sha.Substring(0,7))): $concluidos de $($checks.Count) checks concluidos, $minutos min"
   Write-Host $mensagem
   if($Andamento){$Andamento.esperaCI=@{id=$id;mensagem=$mensagem};Publicar-AndamentoAtualizacao $Andamento 'PREPARAR / Consulta CI'}
   # API a cada 30 s; o sinal cooperativo e observado sem esperar o polling.
   for($i=0;$i-lt60;$i++){
    if(Testar-CancelamentoEsperaCI $Andamento $id){throw (New-Object OperationCanceledException 'Espera do CI cancelada; operacao continua no ar e preparo sera limpo.')}
    & $Pausa 500
    if(((& $Agora)-$inicio).TotalSeconds-ge1800){break}
   }
  }
 }finally{
  $cancelado=Testar-CancelamentoEsperaCI $Andamento $id
  if($Andamento){
   $Andamento.esperaCI=$null
   Publicar-AndamentoAtualizacao $Andamento 'PREPARAR / Consulta CI'
   Remove-Item -LiteralPath ($Andamento.arquivo+'.cancelar-ci') -Force -ErrorAction SilentlyContinue
  }
  if($cancelado){throw (New-Object OperationCanceledException 'Espera do CI cancelada; operacao continua no ar e preparo sera limpo.')}
 }
}
function Testar-CancelamentoEsperaCI($Andamento,[string]$Id) {
 if(!$Andamento-or!$Andamento.arquivo){return $false}
 try{return [IO.File]::ReadAllText($Andamento.arquivo+'.cancelar-ci')-ceq$Id}catch{return $false}
}
function Solicitar-CancelamentoEsperaCI([string]$ArquivoAndamento) {
 # O identificador impede um Ctrl+C atrasado de cancelar outra execucao.
 try{
  $a=Ler-AndamentoAtualizacao $ArquivoAndamento
  if($a.estado-eq'andamento'-and$a.esperaCI.id-match'^[0-9a-f]{32}$'){
   [IO.File]::WriteAllText($ArquivoAndamento+'.cancelar-ci',[string]$a.esperaCI.id)
  }
 }catch{}
}
function Plano-AndamentoAtualizacao([bool]$Rapido=$false) {
 $preparo=@('Inicializacao isolada','Limpeza de preparos reprovados','Configuracao de teste','Metadados das dependencias','Conferencia geral da reserva','Conferencia da reserva Node','Conferencia da reserva Python','Consumo da reserva','Descarte da reserva','Dependencias Node','Materializacao de junctions Node','Dependencias Python','Validar-PythonAlertas','Consulta CI','Build do Portal')
 if(!$Rapido){$preparo+=@('Testes do Portal','Testes dos Alertas')}
 $preparo+=@('Configuracao dos testes operacionais','Teste operacional: validar-operacao.ps1','Teste operacional: testar-operacao.ps1')
 if($Rapido){$preparo+='Fumaca do Portal compilado'}else{$preparo+=@('Teste operacional: testar-supervisor-isolado.ps1','Teste operacional: testar-persistencia-alertas.ps1')}
 return @('Conferindo ambiente de atualizacao','Limpeza de preparos antigos','Conferindo o repositorio','Buscando novidades','PREPARAR: versao nova com a operacao NO AR','PREPARAR / Criacao do worktree')+@($preparo|ForEach-Object {'PREPARAR / '+$_})+@('PREPARAR / Aprovacao e conferencia','TROCAR: parando a operacao','Backup do banco antes de trocar a versao','Aplicando a nova versao','Trazendo artefatos prontos por renomeacao no mesmo volume','Seguindo com o script da nova versao','Conferindo a configuracao privada','Conferindo configuracao da instalacao antes da partida','Religando a operacao','Conferindo interface e consumidores da operacao','CONCLUIR: delegando limpeza da pasta de preparo')
}
function Novo-AndamentoAtualizacao([string]$Arquivo,[string]$Tempos,[datetime]$Inicio=[datetime]::UtcNow) {
 $duracoes=@{};$linhas=@()
 try{if(Test-Path -LiteralPath $Tempos){$linhas=@(Get-Content -LiteralPath $Tempos -Tail 4000 -Encoding UTF8 -ErrorAction Stop)}}catch{}
 $resumos=@(for($i=0;$i-lt$linhas.Count;$i++){if($linhas[$i]-match'Resumo atualizacao:'){$i}})
 if($resumos.Count){
  $fim=$resumos[-1];$comeco=if($resumos.Count-gt1){$resumos[-2]+1}else{0}
  foreach($linha in $linhas[$comeco..$fim]){
   if($linha-match'^PREPARAR / (.+): codigo=.+; duracao=([0-9.]+) s\.'){$duracoes['PREPARAR / '+$Matches[1]]=[double]::Parse($Matches[2],[Globalization.CultureInfo]::InvariantCulture)}
   elseif($linha-match'^\[.+?\] (.+): .+ em ([0-9.]+) s;'){$duracoes[$Matches[1]]=[double]::Parse($Matches[2],[Globalization.CultureInfo]::InvariantCulture)}
  }
 }
 return @{arquivo=$Arquivo;inicioGeral=$Inicio.ToString('o');inicioEtapa=$Inicio.ToString('o');nome='Iniciando atualizacao';numero=1;total=@(Plano-AndamentoAtualizacao).Count;modo='a definir';motivoModo='';estado='andamento';plano=@(Plano-AndamentoAtualizacao);duracoes=$duracoes}
}
function Ler-AndamentoAtualizacao([string]$Arquivo) {
 try{$j=Get-Content -LiteralPath $Arquivo -Raw -Encoding UTF8 -ErrorAction Stop|ConvertFrom-Json -ErrorAction Stop;$h=@{};foreach($p in $j.PSObject.Properties){$h[$p.Name]=$p.Value};$h.arquivo=$Arquivo;return $h}catch{return $null}
}
function Publicar-AndamentoAtualizacao($Andamento,[string]$Nome,[string]$Estado='andamento',[string]$Modo='',[string]$MotivoModo='') {
 $codigo=Get-Variable LASTEXITCODE -Scope Global -ValueOnly -ErrorAction SilentlyContinue
 $temporario=$null
 try{
  if(!$Andamento-or!$Andamento.arquivo){return}
  # Um resultado terminal nao pode voltar a avancar durante limpeza ou retomada.
  if($Andamento.estado-ne'andamento'){return}
  if($Modo){$Andamento.modo=$Modo;$Andamento.plano=@(Plano-AndamentoAtualizacao ($Modo-eq'rapido'));$Andamento.total=$Andamento.plano.Count}
  if($MotivoModo){$Andamento.motivoModo=$MotivoModo}
  if($Nome-ne$Andamento.nome){$Andamento.inicioEtapa=[datetime]::UtcNow.ToString('o')}
  $Andamento.nome=$Nome;$Andamento.estado=$Estado
  $indice=[array]::IndexOf([object[]]$Andamento.plano,$Nome)
  if($indice-ge0){$Andamento.numero=$indice+1}
  if($Estado-ne'andamento'){$Andamento.fim=[datetime]::UtcNow.ToString('o')}
  [void][IO.Directory]::CreateDirectory((Split-Path $Andamento.arquivo -Parent))
  $temporario=$Andamento.arquivo+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
  [IO.File]::WriteAllText($temporario,($Andamento|ConvertTo-Json -Depth 6),(New-Object Text.UTF8Encoding($false)))
  if(Test-Path -LiteralPath $Andamento.arquivo){[IO.File]::Replace($temporario,$Andamento.arquivo,[NullString]::Value)}else{[IO.File]::Move($temporario,$Andamento.arquivo)}
 }catch{}finally{if($temporario-and(Test-Path -LiteralPath $temporario)){Remove-Item -LiteralPath $temporario -Force -ErrorAction SilentlyContinue};$global:LASTEXITCODE=$codigo}
}
# Arquivo exclusivo mantido pelo worker. PID+inicio tambem protegem a janela de partida.
function Confirmar-LimpezaAnterior([string]$Arquivo) {
 if(!(Test-Path -LiteralPath $Arquivo)){return}
 $h=$null
 try{
  try{$h=[IO.File]::Open($Arquivo,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)}catch{throw 'Limpeza anterior em andamento; aguarde antes de atualizar novamente.'}
  $leitor=New-Object IO.StreamReader($h);$j=$leitor.ReadToEnd()|ConvertFrom-Json -ErrorAction Stop
  if(!$j.pid-or!$j.inicio){throw 'Identidade da limpeza anterior invalida; confira o registro de limpeza.'}
  $p=Get-Process -Id ([int]$j.pid) -ErrorAction SilentlyContinue
  if($p-and[math]::Abs(($p.StartTime.ToUniversalTime()-[datetime]::Parse($j.inicio).ToUniversalTime()).TotalSeconds)-lt2){throw 'Limpeza anterior em andamento; aguarde antes de atualizar novamente.'}
 }finally{if($h){$h.Dispose()}}
 Remove-Item -LiteralPath $Arquivo -Force
}
function Iniciar-LimpezaPreparoSegundoPlano([string]$Raiz,[string]$Preparo,[string]$Operacao,[string]$Executavel='powershell.exe') {
 Validar-PastaPreparo $Raiz $Preparo
 $arquivo=Join-Path $Operacao 'limpeza-preparo.lock'
 Confirmar-LimpezaAnterior $arquivo
 $h=[IO.File]::Open($arquivo,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$bytes=[Text.Encoding]::UTF8.GetBytes((@{pid=$PID;inicio=(Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o')}|ConvertTo-Json));$h.Write($bytes,0,$bytes.Length)}finally{$h.Dispose()}
 try{
  $info=New-Object Diagnostics.ProcessStartInfo
  $info.FileName=$Executavel;$info.UseShellExecute=$false;$info.CreateNoWindow=$true
  $argumentos=@('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $Raiz 'scripts/limpar-preparo-assincrono.ps1'),'-Instalacao',$Raiz,'-Preparo',$Preparo,'-Operacao',$Operacao)
  $info.Arguments=(@($argumentos|ForEach-Object {Proteger-ArgumentoAtualizacao $_})-join' ')
  $info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
  $p=[Diagnostics.Process]::Start($info)
  [void]$p.StandardOutput.ReadToEndAsync();[void]$p.StandardError.ReadToEndAsync()
  # Worker nao escreve em stdout; seus resultados vao para arquivos proprios.
  $p.Dispose()
 }catch{Remove-Item -LiteralPath $arquivo -Force;throw}
}
