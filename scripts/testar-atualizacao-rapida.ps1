# Apenas fixtures novas; exercita renomeacoes reais inclusive falha parcial.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'atualizacao-preparo.ps1')
$base=Join-Path ([IO.Path]::GetTempPath()) ('sv-h1-'+[guid]::NewGuid().ToString('N'))
$raiz=Join-Path $base 'instalacao'
function Exigir($Condicao,[string]$Mensagem){if(!$Condicao){throw $Mensagem}}
try{
 New-Item -ItemType Directory -Force $raiz|Out-Null
 foreach($caso in @('sucesso','falha-parcial','dependencias')){
  $preparo=Nova-PastaPreparo $raiz
  New-Item -ItemType Directory -Force $preparo|Out-Null
  foreach($rel in @('portal/dist','portal/node_modules','alertas/.venv')){
   New-Item -ItemType Directory -Force (Join-Path $raiz $rel),(Join-Path $preparo $rel)|Out-Null
   [IO.File]::WriteAllText((Join-Path $raiz "$rel/versao"),'anterior')
   [IO.File]::WriteAllText((Join-Path $preparo "$rel/versao"),'nova')
  }
  if($caso-eq'dependencias'){
   $copia=Join-Path $preparo 'copia'
   Exigir (Copiar-DependenciasPreparo (Join-Path $raiz 'portal/node_modules') $copia) 'Nao reaproveitou dependencias.'
   [IO.File]::WriteAllText((Join-Path $copia 'versao'),'teste alterou copia')
   Exigir ((Get-Content (Join-Path $raiz 'portal/node_modules/versao'))-eq'anterior') 'Copia alterou producao.'
   $vendor=Join-Path $raiz 'portal/vendor/pacote'
   New-Item -ItemType Directory -Force $vendor|Out-Null
   [IO.File]::WriteAllText((Join-Path $vendor 'versao'),'vendor')
   $link=Join-Path $raiz 'portal/node_modules/pacote'
   New-Item -ItemType $(if($env:OS-eq'Windows_NT'){'Junction'}else{'SymbolicLink'}) -Path $link -Target $vendor|Out-Null
   $isolado=Join-Path $preparo 'com-vendor'
   [void](Copiar-DependenciasPreparo (Join-Path $raiz 'portal/node_modules') $isolado)
   if((Get-Item -LiteralPath (Join-Path $isolado 'pacote') -Force).Attributes-band[IO.FileAttributes]::ReparsePoint){throw 'Junction sobreviveu a copia.'}
   [IO.File]::WriteAllText((Join-Path $isolado 'pacote/versao'),'teste')
   Exigir ((Get-Content (Join-Path $vendor 'versao'))-eq'vendor') 'Link copiado alterou vendor da instalacao.'
   $privado=Join-Path $raiz 'privado';New-Item -ItemType Directory -Force $privado|Out-Null
   New-Item -ItemType $(if($env:OS-eq'Windows_NT'){'Junction'}else{'SymbolicLink'}) -Path (Join-Path $raiz 'portal/node_modules/proibido') -Target $privado|Out-Null
   $recusou=$false
   try{[void](Copiar-DependenciasPreparo (Join-Path $raiz 'portal/node_modules') (Join-Path $preparo 'proibido'))}catch{$recusou=$true}
   Exigir $recusou 'Copia seguiu link para privado da producao.'
   # Materializacao direcionada: so o link vira copia; o resto nao e recopiado.
   [IO.Directory]::Delete((Join-Path $raiz 'portal/node_modules/proibido'),$false)
   $instalado=Join-Path $raiz 'portal/node_modules'
   New-Item -ItemType Directory -Force (Join-Path $instalado 'fisico')|Out-Null
   [IO.File]::WriteAllText((Join-Path $instalado 'fisico/marca'),'fisico')
   $antes=(Get-Item -LiteralPath (Join-Path $instalado 'fisico/marca')).LastWriteTimeUtc
   Exigir ((Materializar-LinksDependencias $instalado)-eq1) 'Nao materializou exatamente um link.'
   Exigir (!@(Get-ChildItem -LiteralPath $instalado -Recurse -Force -Attributes ReparsePoint).Count) 'Link sobreviveu a materializacao.'
   Exigir ((Get-Content (Join-Path $instalado 'pacote/versao'))-eq'vendor') 'Conteudo do link nao foi materializado.'
   Exigir ((Get-Item -LiteralPath (Join-Path $instalado 'fisico/marca')).LastWriteTimeUtc-eq$antes) 'Arvore fisica foi recopiada.'
   [IO.File]::WriteAllText((Join-Path $instalado 'pacote/versao'),'alterado')
   Exigir ((Get-Content (Join-Path $vendor 'versao'))-eq'vendor') 'Materializacao alterou o destino do link.'
   Exigir ((Materializar-LinksDependencias $instalado)-eq0) 'Arvore fisica nao deve ter links.'
   New-Item -ItemType $(if($env:OS-eq'Windows_NT'){'Junction'}else{'SymbolicLink'}) -Path (Join-Path $instalado 'proibido') -Target $privado|Out-Null
   $recusou=$false
   try{[void](Materializar-LinksDependencias $instalado)}catch{$recusou=$true}
   Exigir $recusou 'Materializacao seguiu link para privado da producao.'
   Exigir (Test-Path -LiteralPath $privado) 'Recusa removeu o destino proibido.'
   [IO.Directory]::Delete((Join-Path $instalado 'proibido'),$false)
   Exigir (!(Copiar-DependenciasPreparo (Join-Path $raiz 'ausente') (Join-Path $preparo 'ausente'))) 'Dependencias ausentes devem instalar.'
  }else{
   if($caso-eq'falha-parcial'){Remove-Item (Join-Path $preparo 'alertas/.venv') -Recurse -Force}
   $falhou=$false
   try{Trocar-ArtefatosPreparo $raiz $preparo}catch{$falhou=$true;if($caso-eq'sucesso'){throw}}
   Exigir ($falhou-eq($caso-eq'falha-parcial')) 'Resultado inesperado da troca.'
   Exigir ((Get-Content (Join-Path $raiz 'portal/dist/versao'))-eq'nova') 'Dist nao entrou.'
   if($caso-eq'falha-parcial'){Remove-Item (Join-Path $preparo 'trocado-portal-dist') -Force} # simula marcador perdido
   Restaurar-ArtefatosPreparo $raiz $preparo
   foreach($rel in @('portal/dist','portal/node_modules','alertas/.venv')){Exigir ((Get-Content (Join-Path $raiz "$rel/versao"))-eq'anterior') "Reversao incompleta: $rel"}
   Restaurar-ArtefatosPreparo $raiz $preparo # idempotente
  }
  Remove-Item -LiteralPath $preparo -Recurse -Force
  Write-Host "[OK] H1 artefatos: $caso"
 }
 # Processo real, sem depender de mocks: ambos os canais e argumentos com
 # espacos/aspas/barras atravessam o lancador, com codigo de saida preservado.
 $filho=Join-Path $base 'filho com espacos.ps1'
 [IO.File]::WriteAllText($filho,'param($Texto) Write-Output ($Texto|ConvertTo-Json -Compress); [Console]::Error.WriteLine("stderr-ficticio"); exit 7')
 $argumento='com espaco "aspas" e barra\'
 $hostTeste=(Get-Process -Id $PID).Path
 $saida=@(Executar-PowerShellOculto @('-NoProfile','-File',$filho,$argumento) $hostTeste)
 Exigir ($LASTEXITCODE-eq7) 'Lancador oculto perdeu codigo de saida.'
 Exigir (($saida[0].Trim()|ConvertFrom-Json)-eq$argumento) 'Lancador oculto alterou argumentos.'
 Exigir (($saida-join' ')-like'*stderr-ficticio*') 'Lancador oculto perdeu stderr.'
 Write-Host '[OK] Processo oculto: argumentos, stdout, stderr e codigo 7.'
 # Reserva real em disco: publica anteriores somente apos conclusao, depois
 # consome de uma vez. Falhas nunca movem dependencias da instalacao ativa.
 $r=Join-Path $base 'reserva';New-Item -ItemType Directory -Force (Join-Path $r 'portal'),(Join-Path $r 'alertas/config')|Out-Null
 foreach($rel in @('alertas/config/requirements.txt','alertas/config/requirements-dev.txt')){[IO.File]::WriteAllText((Join-Path $r $rel),'fixture')}
 # Manifestos validos: o hash distingue metadados da raiz de pacotes resolvidos.
 [IO.File]::WriteAllText((Join-Path $r 'portal/package.json'),'{"engines":{"node":">=22.13.0"},"dependencies":{"ficticio":"1"}}')
 [IO.File]::WriteAllText((Join-Path $r 'portal/package-lock.json'),'{"lockfileVersion":3,"packages":{"":{"engines":{"node":">=22.13.0"}},"node_modules/ficticio":{"version":"1","engines":{"node":">=20"}}}}')
 & git -C $r init -q
 & git -C $r add .
 & git -C $r -c user.name=Fixture -c user.email=fixture@example.invalid commit -qm fixture
 $assinatura=Obter-AssinaturaDependencias $r 'python'
 # O mesmo salto de engines da A1 nao deve invalidar a copia/reserva.
 foreach($rel in @('portal/package.json','portal/package-lock.json')){
  $f=Join-Path $r $rel;[IO.File]::WriteAllText($f,([IO.File]::ReadAllText($f).Replace('>=22.13.0','24.20.0')))
 }
 $soEngines=Obter-AssinaturaDependencias $r 'python'
 Exigir (Testar-DependenciasNodeIguais $assinatura $soEngines) 'engines.node da raiz alterou dependencias.'
 $registroEngines=$assinatura|ConvertTo-Json -Depth 6|ConvertFrom-Json
 Exigir (!(Comparar-AssinaturaDependencias $registroEngines $soEngines)) 'Reserva foi invalidada somente por engines.node.'
 $arquivoLock=Join-Path $r 'portal/package-lock.json';$lockOriginal=[IO.File]::ReadAllText($arquivoLock)
 foreach($par in @(@('>=20','>=24'),@('"version":"1"','"version":"2"'))){
  [IO.File]::WriteAllText($arquivoLock,$lockOriginal.Replace($par[0],$par[1]))
  $pacoteMudou=Obter-AssinaturaDependencias $r 'python'
  Exigir (!(Testar-DependenciasNodeIguais $assinatura $pacoteMudou)) 'Mudanca de pacote/engines transitivo passou como metadado da raiz.'
  Exigir ((Comparar-AssinaturaDependencias $registroEngines $pacoteMudou)-eq'lockfile/package diferente') 'Reserva aceitou pacote resolvido diferente.'
 }
 [IO.File]::WriteAllText($arquivoLock,$lockOriginal)
 $nodeMudou=$soEngines.Clone();$nodeMudou.node='v0.0.1'
 Exigir (!(Testar-DependenciasNodeIguais $assinatura $nodeMudou)) 'Versao efetiva do Node ignorada.'
 Write-Host '[OK] Assinatura: engines da raiz preserva copia/reserva; pacote, engines transitivo e Node real invalidam.'
 foreach($caso in @('valida','troca-falha','lockfile','requirements','node','python','ausente','arquivo','marcador-link','incompleta','corrompida','removido','tamanho','data','pasta-removida','inventario-legado','formato-antigo','sem-registro','link-raiz','link-externo','link-interno','em-uso','sha','registro','reinstalar','volume','falha-movimento')){
  $p=Nova-PastaPreparo $r;New-Item -ItemType Directory -Force $p|Out-Null
  foreach($rel in @('portal/node_modules','alertas/.venv')){
   $antigo=Join-Path $p ('anteriores/'+$rel);$ativo=Join-Path $r $rel
   New-Item -ItemType Directory -Force $antigo,$ativo,(Join-Path $antigo 'vazia')|Out-Null
   [IO.File]::WriteAllText((Join-Path $antigo 'pacote'),'reserva')
   [IO.File]::WriteAllText((Join-Path $ativo 'pacote'),'producao')
  }
  [IO.File]::WriteAllText((Join-Path $p 'dependencias-origem.json'),($assinatura|ConvertTo-Json -Depth 6))
  [void](Guardar-ReservaDependencias $r $p)
  $reserva=Pasta-ReservaDependencias $r;$registro=Join-Path $reserva 'registro.json'
  $j=Get-Content $registro -Raw|ConvertFrom-Json
  foreach($rel in @('portal/node_modules','alertas/.venv')){Exigir ($j.inventarios.$rel-match'^metadados-v2;arquivos=1;pastas=1;assinatura=[a-f0-9]{64}$') 'Inventario nao registra contagens e assinatura dos metadados.'}
  $a=$assinatura.Clone()
  if($caso-in@('valida','troca-falha')){
   # HEAD avanca sem trocar artefatos/reserva; a proxima normal ainda pode
   # consumir a reserva ancestral e restaurar as dependencias ativas se falhar.
   [IO.File]::WriteAllText((Join-Path $r 'README.md'),$caso)
   & git -C $r add README.md
   & git -C $r -c user.name=Fixture -c user.email=fixture@example.invalid commit -qm docs
   $a.sha=(& git -C $r rev-parse HEAD).Trim()
   Exigir ($a.sha-ne$j.sha) 'Fixture nao avancou HEAD depois de guardar a reserva.'
  }
  $a.hashes=@{};foreach($chave in $assinatura.hashes.Keys){$a.hashes[$chave]=$assinatura.hashes[$chave]}
  switch($caso){
   'lockfile' {$a.hashes['portal/package-lock.json']='diferente'}
   'requirements' {$a.hashes['alertas/config/requirements-dev.txt']='diferente'}
   'node' {$a.node='v0.0.1'}
   'python' {$a.python='Python 0.0.1'}
   'ausente' {Remover-ArvorePreparo $reserva}
   'arquivo' {Remover-ArvorePreparo $reserva;[IO.File]::WriteAllText($reserva,'corrompida')}
   'marcador-link' {New-Item -ItemType $(if($env:OS-eq'Windows_NT'){'Junction'}else{'SymbolicLink'}) -Path (Join-Path $reserva 'descartar') -Target (Join-Path $r 'portal/node_modules')|Out-Null}
   'incompleta' {Remover-ArvorePreparo (Join-Path $reserva 'alertas/.venv')}
   'corrompida' {[IO.File]::WriteAllText((Join-Path $reserva 'portal/node_modules/pacote'),'mudanca');[IO.File]::SetLastWriteTimeUtc((Join-Path $reserva 'portal/node_modules/pacote'),[datetime]::UtcNow.AddSeconds(20))}
   'removido' {Remove-Item (Join-Path $reserva 'portal/node_modules/pacote')}
   'tamanho' {$f=Join-Path $reserva 'portal/node_modules/pacote';$data=[IO.File]::GetLastWriteTimeUtc($f);[IO.File]::WriteAllText($f,'reserva com tamanho alterado');[IO.File]::SetLastWriteTimeUtc($f,$data)}
   'data' {$f=Join-Path $reserva 'portal/node_modules/pacote';[IO.File]::SetLastWriteTimeUtc($f,([IO.File]::GetLastWriteTimeUtc($f)).AddSeconds(20))}
   'pasta-removida' {Remove-Item (Join-Path $reserva 'alertas/.venv/vazia')}
   'inventario-legado' {$j.inventarios.'portal/node_modules'='a'*64;$j|ConvertTo-Json -Depth 6|Set-Content $registro}
   'formato-antigo' {$j.formato=1;$j.inventarios.'portal/node_modules'='a'*64;$j|ConvertTo-Json -Depth 6|Set-Content $registro}
   'sem-registro' {Remove-Item -LiteralPath $registro -Force}
   'sha' {$j=Get-Content $registro -Raw|ConvertFrom-Json;$j.sha='0'*40;$j|ConvertTo-Json -Depth 6|Set-Content $registro}
   'registro' {Set-Content $registro 'nao e json'}
   'link-raiz' {Remover-ArvorePreparo $reserva;New-Item -ItemType $(if($env:OS-eq'Windows_NT'){'Junction'}else{'SymbolicLink'}) -Path $reserva -Target (Join-Path $r 'portal/node_modules')|Out-Null}
   'link-externo' {New-Item -ItemType $(if($env:OS-eq'Windows_NT'){'Junction'}else{'SymbolicLink'}) -Path (Join-Path $reserva 'portal/node_modules/link') -Target (Join-Path $r 'portal/node_modules')|Out-Null}
   'link-interno' {New-Item -ItemType $(if($env:OS-eq'Windows_NT'){'Junction'}else{'SymbolicLink'}) -Path (Join-Path $reserva 'portal/node_modules/link') -Target (Join-Path $reserva 'alertas/.venv')|Out-Null}
   'falha-movimento' {New-Item -ItemType Directory -Force (Join-Path $p 'alertas/.venv')|Out-Null}
  }
  # Caches criados depois de guardar tambem sao removidos antes de validar.
  if($caso-eq'valida'){
   foreach($cache in @('portal/node_modules/.cache','alertas/.venv/__pycache__')){
    New-Item -ItemType Directory -Force (Join-Path $reserva $cache)|Out-Null
    [IO.File]::WriteAllText((Join-Path $reserva ($cache+'/execucao')),'descartar')
   }
  }
  $script:reservaEmUso=$caso-eq'em-uso';$script:volumeReserva=$caso-ne'volume'
  $emUsoReal=(Get-Command Reserva-DependenciasEmUso).ScriptBlock;$volumeReal=(Get-Command Mesmo-VolumeDependencias).ScriptBlock
  function Reserva-DependenciasEmUso($Pasta){return $script:reservaEmUso}
  function Mesmo-VolumeDependencias($Raiz,$Preparo){return $script:volumeReserva}
  $script:medicoesReserva=@();$script:pilhaReserva=New-Object Collections.ArrayList
  function Iniciar-PassoPreparo($Nome){$script:medicoesReserva+=$Nome;[void]$script:pilhaReserva.Add($Nome)}
  function Concluir-PassoPreparo($Codigo){$script:pilhaReserva.RemoveAt($script:pilhaReserva.Count-1)}
  $fisicaReal=(Get-Command Testar-ArvoreFisica).ScriptBlock;$inventarioReal=(Get-Command Inventariar-ReservaLimpa).ScriptBlock
  if($caso-eq'formato-antigo'){
   function Testar-ArvoreFisica {throw 'NAO deve conferir arquivos do formato antigo'}
   function Inventariar-ReservaLimpa {throw 'NAO deve inventariar o formato antigo'}
  }
  try{$uso=Usar-ReservaDependencias $r $p $a $(if($caso-eq'reinstalar'){'reinstalacao solicitada'}else{''})}
  finally{Set-Item Function:Testar-ArvoreFisica $fisicaReal;Set-Item Function:Inventariar-ReservaLimpa $inventarioReal;Set-Item Function:Reserva-DependenciasEmUso $emUsoReal;Set-Item Function:Mesmo-VolumeDependencias $volumeReal;Remove-Item Function:Iniciar-PassoPreparo,Function:Concluir-PassoPreparo}
  if($caso-eq'formato-antigo'){Exigir ($uso.motivo-ceq'formato antigo da reserva'-and$script:medicoesReserva-notcontains'Conferencia da reserva Node') 'Formato antigo deve ser descartado antes de qualquer inventario.'}
  Exigir ($script:pilhaReserva.Count-eq0) 'Medicao da reserva ficou aberta apos sucesso/falha.'
  if($caso-eq'valida'){foreach($nome in @('Conferencia geral da reserva','Conferencia da reserva Node','Conferencia da reserva Python','Consumo da reserva')){Exigir ($script:medicoesReserva-contains$nome) ("Passo da reserva ausente: $nome")}}
  Exigir ($uso.usada-eq($caso-in@('valida','troca-falha'))) "Reserva: resultado incorreto em ${caso}: $($uso.motivo)"
  Exigir (!(Test-Path $reserva)) "Reserva invalida nao foi isolada: $caso"
  foreach($rel in @('portal/node_modules','alertas/.venv')){
   Exigir ((Get-Content (Join-Path $r ($rel+'/pacote')))-eq'producao') "Reserva alterou producao: $caso"
   if($uso.usada){Exigir ((Get-Content (Join-Path $p ($rel+'/pacote')))-eq'reserva') 'Nao moveu ambas dependencias.'}
  }
  if($uso.usada){
   Exigir (!(Test-Path (Join-Path $p 'portal/node_modules/.cache'))) 'Cache de producao entrou no preparo.'
   if($caso-eq'troca-falha'){
    foreach($d in @((Join-Path $r 'portal/dist'),(Join-Path $p 'portal/dist'))){New-Item -ItemType Directory -Force $d|Out-Null;[IO.File]::WriteAllText((Join-Path $d 'pacote'),'dist')}
    Remover-ArvorePreparo (Join-Path $p 'alertas/.venv')
    $falhou=$false;try{Trocar-ArtefatosPreparo $r $p}catch{$falhou=$true}
    Exigir $falhou 'Fixture nao falhou no meio da troca.'
    Restaurar-ArtefatosPreparo $r $p
    foreach($rel in @('portal/node_modules','alertas/.venv')){Exigir ((Get-Content (Join-Path $r ($rel+'/pacote')))-eq'producao') 'Rollback de reserva perdeu dependencias ativas.'}
    Exigir (!(Test-Path (Pasta-ReservaDependencias $r))) 'Rollback republicou reserva consumida.'
   }
   # Falha de build depois do consumo: perde apenas reserva/preparo.
   Limpar-PastaPreparo $r $p
   Exigir ((Get-Content (Join-Path $r 'portal/node_modules/pacote'))-eq'producao') 'Falha de preparo removeu dependencias ativas.'
  }else{Remover-ArvorePreparo $p}
  Write-Host "[OK] Reserva: $caso"
 }
 if($env:OS-eq'Windows_NT'){
  $p=Nova-PastaPreparo $r;New-Item -ItemType Directory -Force $p|Out-Null
  foreach($rel in @('portal/node_modules','alertas/.venv')){New-Item -ItemType Directory -Force (Join-Path $p ('anteriores/'+$rel))|Out-Null;[IO.File]::WriteAllText((Join-Path $p ('anteriores/'+$rel+'/pacote')),'reserva')}
  [IO.File]::WriteAllText((Join-Path $p 'dependencias-origem.json'),($assinatura|ConvertTo-Json -Depth 6))
  [void](Guardar-ReservaDependencias $r $p)
  $reserva=Pasta-ReservaDependencias $r
  $h=[IO.File]::Open((Join-Path $reserva 'portal/node_modules/pacote'),[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)
  $script:medicoesReserva=@();$script:pilhaReserva=New-Object Collections.ArrayList
  function Iniciar-PassoPreparo($Nome){$script:medicoesReserva+=$Nome;[void]$script:pilhaReserva.Add($Nome)}
  function Concluir-PassoPreparo($Codigo){$script:pilhaReserva.RemoveAt($script:pilhaReserva.Count-1)}
  try{$uso=Usar-ReservaDependencias $r $p $assinatura;Exigir (!$uso.usada) 'Reutilizou reserva com handle real em uso.'}finally{$h.Dispose()}
  if(Test-Path $reserva){
   Exigir (Test-Path (Join-Path $reserva 'descartar')) 'Reserva bloqueada nao foi invalidada.'
   Descartar-ReservaDependencias $r $p
  }
  Exigir ((Get-Content (Join-Path $r 'portal/node_modules/pacote'))-eq'producao') 'Handle da reserva afetou producao.'
  Remover-ArvorePreparo $p
  Write-Host '[OK] Reserva: handle exclusivo real do Windows.'
 }

 # Destino de publicacao ocupado: nao aparece reserva parcial. nao ha reserva parcial.
 $p=Nova-PastaPreparo $r;New-Item -ItemType Directory -Force $p|Out-Null
 foreach($rel in @('portal/node_modules','alertas/.venv')){New-Item -ItemType Directory -Force (Join-Path $p ('anteriores/'+$rel))|Out-Null;[IO.File]::WriteAllText((Join-Path $p ('anteriores/'+$rel+'/pacote')),'ficticio')}
 [IO.File]::WriteAllText((Join-Path $p 'dependencias-origem.json'),($assinatura|ConvertTo-Json -Depth 6))
 New-Item -ItemType Directory -Force (Join-Path $p 'reserva-nova/registro.json')|Out-Null
 $falhou=$false;try{Guardar-ReservaDependencias $r $p}catch{$falhou=$true}
 Exigir ($falhou-and!(Test-Path (Pasta-ReservaDependencias $r))) 'Publicou reserva incompleta apos falha.'
 Exigir ((Get-Content (Join-Path $r 'alertas/.venv/pacote'))-eq'producao') 'Falha ao guardar alterou producao.'
 Remover-ArvorePreparo $p
 # Codigos documentados do robocopy, inclusive sucesso com diferencas.
 function robocopy.exe {$global:LASTEXITCODE=$script:codigoRobo}
 try{
  foreach($codigo in @(0,1,2,3,4,5,6,7,8,16)){
   $script:codigoRobo=$codigo;$global:LASTEXITCODE=42;$falhou=$false
   try{Executar-RobocopyDependencias 'origem ficticia' 'destino ficticio'}catch{$falhou=$true}
   Exigir ($falhou-eq($codigo-ge8)) "Codigo robocopy incorreto: $codigo"
   Exigir ($LASTEXITCODE-eq42) 'Robocopy perdeu codigo anterior.'
  }
 }finally{Remove-Item Function:robocopy.exe}
 Write-Host '[OK] Robocopy: 0-7 sucesso, 8/16 falha; codigo anterior preservado.'

 $rejeitou=$false;try{Validar-PastaPreparo $raiz $raiz}catch{$rejeitou=$true};Exigir $rejeitou 'Aceitou instalacao como preparo.'
}finally{if(Test-Path $base){Remove-Item $base -Recurse -Force}}

$global:LASTEXITCODE=0
