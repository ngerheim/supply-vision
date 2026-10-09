import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

void test('assistente Windows: semente, SYSTEM, health, homologacao e retomada', { skip: process.platform !== 'win32', timeout: 240_000 }, () => {
  const root=path.resolve(import.meta.dirname,'../..');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sv-migrar-ci-'));
  const repo=path.join(dir,'repo'), origem=path.join(dir,'origem'), report=path.join(dir,'relatorio.txt');
  const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>k.toLowerCase()!=='psmodulepath'));
  const ps=(script,args=[],extra={})=>execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script,...args],{env:{...env,...extra},stdio:'pipe',timeout:200_000});
  const comando=(cmd)=>execFileSync('powershell.exe',['-NoProfile','-Command',cmd],{env:{...env,SV_REPO:repo},stdio:'pipe',timeout:30_000});
  // Nunca remove uma tarefa que nao pertence a esta fixture.
  comando("if(Get-ScheduledTask -TaskName 'Supply Vision' -ErrorAction SilentlyContinue){throw 'Tarefa preexistente: teste recusado'}");
  try {
    for(const pasta of ['scripts','portal/scripts','portal/lib','alertas/processo','alertas/parametros']) {
      fs.cpSync(path.join(root,pasta),path.join(repo,pasta),{recursive:true});
    }
    fs.symlinkSync(path.join(root,'portal/node_modules'),path.join(repo,'portal/node_modules'),'junction');
    fs.mkdirSync(path.join(repo,'alertas/.venv/Scripts'),{recursive:true});
    fs.copyFileSync(path.join(root,'alertas/.venv/Scripts/python.exe'),path.join(repo,'alertas/.venv/Scripts/python.exe'));
    fs.copyFileSync(path.join(root,'alertas/.venv/pyvenv.cfg'),path.join(repo,'alertas/.venv/pyvenv.cfg'));
    fs.copyFileSync(path.join(root,'INICIAR.bat'),path.join(repo,'INICIAR.bat'));
    // Componentes externos ao assistente: instalacao e firewall simulados.
    // A definicao/registro SYSTEM usam a funcao de producao.
    fs.writeFileSync(path.join(repo,'scripts/instalar.ps1'),`param($ModoInicializacao)
. (Join-Path $PSScriptRoot 'operacao-logica.ps1')
. (Join-Path $PSScriptRoot 'inicializacao-logica.ps1')
$r=Split-Path $PSScriptRoot
Definir-ModoInicializacao $r (Join-Path $r 'privado') (Join-Path $r 'startup.cmd') $ModoInicializacao '${process.execPath.replaceAll("'","''")}'
`);
    fs.writeFileSync(path.join(repo,'portal/scripts/abrir-firewall-lan.ps1'),"param([switch]$SemPausa)\n# firewall simulado\n");
    fs.writeFileSync(path.join(repo,'scripts/health.mjs'),"import http from 'node:http'; http.createServer((q,r)=>{r.setHeader('content-type','application/json');r.end(JSON.stringify({status:'ok'}));}).listen(3000,'127.0.0.1');");
    fs.writeFileSync(path.join(repo,'scripts/supervisor.ps1'),`param([switch]$SemLogin,[string]$NodeExecutavel,[string]$PastaPrivada)
$op=Join-Path $PastaPrivada 'operacao'
Remove-Item (Join-Path $op 'parar.sinal') -ErrorAction SilentlyContinue
$lock=[IO.File]::Open((Join-Path $op 'supervisor.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
$p=Start-Process $NodeExecutavel -ArgumentList ('"'+(Join-Path $PSScriptRoot 'health.mjs')+'"') -PassThru
try{
 @{ensaio=$true;conta=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;atualizado=(Get-Date).ToString('o')}|ConvertTo-Json|Set-Content (Join-Path $op 'status.json')
 Set-Content (Join-Path $op 'supervisor.log') 'configuracao SEGREDO-FICTICIO email=ficticio@example.com'
 while(!(Test-Path (Join-Path $op 'parar.sinal'))){Start-Sleep -Milliseconds 200}
}finally{Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue;$lock.Dispose()}
`);
    for(const pasta of ['comum','portal/configuracao','alertas/config','alertas/parametros','operacao','banco'])fs.mkdirSync(path.join(origem,pasta),{recursive:true});
    fs.writeFileSync(path.join(origem,'comum/operacao.env'),'MODO_ENSAIO=0\nLIMPEZA_HORARIO=03:00\nESPACO_MINIMO_GB=1\n');
    fs.writeFileSync(path.join(origem,'comum/smtp.env'),'SMTP_PASS=SEGREDO-FICTICIO');
    fs.writeFileSync(path.join(origem,'portal/configuracao/portal.env'),'PORTAL_URL=http://antigo:3000\nBACKUP_NETWORK_DIR=\\\\inexistente\\fixture\n');
    fs.writeFileSync(path.join(origem,'operacao/estado.json'),'{}');
    const dbpath=path.join(origem,'banco/portal.sqlite'),db=new DatabaseSync(dbpath);
    for(const [,ddl] of fs.readFileSync(path.join(root,'portal/lib/database.ts'),'utf8').matchAll(/`(CREATE TABLE IF NOT EXISTS [^`]+)`/g))db.exec(ddl);
    db.close();
    const hash=comando(`(Get-FileHash -LiteralPath '${dbpath.replaceAll("'","''")}' -Algorithm SHA256).Hash`).toString().trim();
    fs.writeFileSync(path.join(origem,'semente.json'),JSON.stringify({gerado:'2026-10-09',origem:'fixture',versao:'1234567890',estadoPersistente:true,banco:{arquivo:'fixture.sqlite',sha256:hash},revisar:[]}));
    const zip=path.join(dir,'supply-vision-semente-fixture.zip');
    comando(`Compress-Archive -Path '${origem.replaceAll("'","''")}\\*' -DestinationPath '${zip.replaceAll("'","''")}'`);
    const script=path.join(root,'scripts/migrar.ps1');
    const args=['-Zip',zip,'-RepositorioTeste',repo,'-PularInstalacoes','-Modo','ensaio','-PortalUrl','http://127.0.0.1:3000','-BackupNetworkDir','\\\\inexistente\\fixture','-LimpezaHorario','04:00','-ContinuarSemRede','-RelatorioDestino',report];
    assert.throws(()=>ps(script,[...args,'-InterromperApos','5']), /./);
    assert.match(fs.readFileSync(path.join(repo,'privado/comum/operacao.env'),'utf8'),/MODO_ENSAIO=1/);
    const banco=path.join(repo,'privado/portal/banco/estado/state/v3/d1/miniflare-D1DatabaseObject/fixture.sqlite');
    assert.ok(fs.existsSync(banco));
    const antes=fs.statSync(banco).mtimeMs;
    ps(script,args);
    assert.equal(fs.statSync(banco).mtimeMs,antes,'retomada nao restaura banco outra vez');
    assert.equal(JSON.parse(fs.readFileSync(path.join(repo,'privado/operacao/status.json'),'utf8').replace(/^\uFEFF/,'' )).conta,'S-1-5-18');
    const texto=fs.readFileSync(report,'utf8');assert.match(texto,/verificacao|verificação/);assert.match(texto,/✅/);
    assert.ok(!texto.includes('SEGREDO-FICTICIO'));assert.ok(!texto.includes('ficticio@example.com'));
    ps(script,args); // Tudo concluido; nenhuma recriacao/restauracao.
    ps(script,['-RepositorioTeste',repo,'-DescartarEnsaio']);
    assert.ok(!fs.existsSync(path.join(repo,'privado')));
    assert.ok(fs.readdirSync(repo).some(n=>n.startsWith('privado.ensaio-')));
    assert.equal(comando("@(Get-ScheduledTask -TaskName 'Supply Vision' -ErrorAction SilentlyContinue).Count").toString().trim(),'0');
  } finally {
    comando("$t=Get-ScheduledTask -TaskName 'Supply Vision' -ErrorAction SilentlyContinue;if($t-and([string]$t.Actions.Arguments).Contains($env:SV_REPO)){Stop-ScheduledTask -TaskName 'Supply Vision';Unregister-ScheduledTask -TaskName 'Supply Vision' -Confirm:$false}");
    // Descarta somente arquivos ficticios; encerra eventual servidor health desta fixture.
    comando("Get-CimInstance Win32_Process | Where-Object {$_.Name-eq'node.exe'-and$_.CommandLine-like('*'+$env:SV_REPO+'*health.mjs*')} | ForEach-Object {Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}");
    fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:200});
  }
});
