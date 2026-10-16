# Apenas dados ficticios e processos descartaveis; nao le a area privada real.
$ErrorActionPreference='Stop'
$raiz=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
. (Join-Path $raiz 'scripts/espera-testes.ps1')
$fixture=Join-Path ([IO.Path]::GetTempPath()) ('supply-vision-supervisor-'+[guid]::NewGuid().ToString('N'))
$evidencias=Join-Path ([IO.Path]::GetTempPath()) ('sv-evidencias-'+[guid]::NewGuid().ToString('N'))
try{
 Preparar-InstalacaoSupervisorTeste $raiz $fixture
 $manifesto=Join-Path $fixture 'portal/package.json'
 if(!(Test-Path $manifesto)-or[IO.File]::ReadAllText($manifesto)-cne[IO.File]::ReadAllText((Join-Path $raiz 'portal/package.json'))){throw 'Fixture nao instalou o manifesto exigido pelo launcher real.'}
 $operacao=Join-Path $fixture 'privado/operacao'
 $log=Join-Path $operacao 'supervisor.log'
 [IO.File]::WriteAllText($log,"portal iniciado (PID $PID).")
 Confirmar-PortalFixtureVivo $fixture
 $inexistente=[int]::MaxValue
 [IO.File]::WriteAllText($log,"portal iniciado (PID $inexistente).")
 $recusou=$false
 try{Confirmar-PortalFixtureVivo $fixture}catch{$recusou=$_.Exception.Message-like'*Portal real caiu durante a partida*'}
 if(!$recusou){throw 'Queda do launcher nao detectada antes do timeout.'}
 [IO.File]::WriteAllLines((Join-Path $operacao 'portal-saida.log'),[string[]](1..80|ForEach-Object {"saida ficticia $_"}))
 [IO.File]::WriteAllText((Join-Path $operacao 'portal-erro.log'),'Erro ficticio de partida: ENOENT package.json')
 [IO.File]::WriteAllText((Join-Path $operacao 'nao-publicar.env'),'segredo ficticio')
 $texto=@(Mostrar-DiagnosticoPortalTeste $fixture $evidencias 6>&1)-join"`n"
 if($texto-notlike'*portal-saida.log*saida ficticia 80*portal-erro.log*ENOENT package.json*'){throw 'Console perdeu stdout/stderr da partida.'}
 $destino=Join-Path $evidencias (Split-Path $fixture -Leaf)
 $nomes=@(Get-ChildItem -LiteralPath $destino -File|Select-Object -ExpandProperty Name|Sort-Object)
 if(($nomes-join',')-ne'portal-erro.log,portal-saida.log,supervisor.log'){throw 'Evidencias incluiram arquivos fora da lista de logs.'}
 $linhas=@(Get-Content (Join-Path $destino 'portal-saida.log'))
 if($linhas.Count-ne60-or$linhas[0]-ne'saida ficticia 21'-or$linhas[-1]-ne'saida ficticia 80'){throw 'Evidencia nao corresponde ao fim impresso no console.'}
 $recusou=$false
 try{Mostrar-DiagnosticoPortalTeste $raiz}catch{$recusou=$true}
 if(!$recusou){throw 'Diagnostico aceitou a instalacao real como fixture.'}
 Write-Host 'PASSOU: manifesto da partida, queda precoce, stdout/stderr e evidencias limitadas aos logs ficticios.'
}finally{
 foreach($pasta in @($fixture,$evidencias)){Remove-Item -LiteralPath $pasta -Recurse -Force -ErrorAction SilentlyContinue}
}
$global:LASTEXITCODE=0
