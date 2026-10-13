import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fork } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { executarBackup, replicarNaRede, prazoRedeMs, hashArquivo } from '../scripts/backup.mjs';

const worker=new URL('../scripts/backup-rede.mjs',import.meta.url);
function fixture(t){
  const pasta=fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'sv-prazo-rede-'));
  t.after(()=>fs.rmSync(pasta,{recursive:true,force:true}));
  const origem=path.join(pasta,'local.sqlite'),rede=path.join(pasta,'rede');
  const db=new DatabaseSync(origem);db.exec("CREATE TABLE teste(valor TEXT);INSERT INTO teste VALUES('preservado')");db.close();
  fs.mkdirSync(rede);fs.writeFileSync(path.join(rede,'portal-atual.sqlite'),'copia anterior');
  return {pasta,origem,rede};
}
void test('prazo padrao 10 min, configuravel e validado; sem destino nao inicia processo',async()=>{
  assert.equal(prazoRedeMs({}),600_000);
  assert.equal(prazoRedeMs({BACKUP_NETWORK_TIMEOUT_SECONDS:'120'}),120_000);
  for(const valor of ['0','-1','1.5','invalido','86401'])assert.throws(()=>prazoRedeMs({BACKUP_NETWORK_TIMEOUT_SECONDS:valor}),/BACKUP_NETWORK_TIMEOUT_SECONDS/);
  assert.equal(await replicarNaRede({}, {iniciar:()=>assert.fail('Nao inicia sem rede')}),null);
});
void test('worker real substitui copia existente atomicamente e conserva hash/historico',async t=>{
  const {origem,rede}=fixture(t);
  const final=await replicarNaRede({BACKUP_NETWORK_DIR:rede},{origem,prazoMs:10000});
  assert.equal(final,path.join(rede,'portal-atual.sqlite'));
  assert.equal(hashArquivo(final),hashArquivo(origem));
  assert.equal(fs.readdirSync(path.join(rede,'historico')).length,1);
  assert.equal(fs.readdirSync(rede).filter(n=>n.includes('.tmp.')).length,0);
});
void test('hash divergente nao substitui a copia anterior e remove somente seu temporario',async t=>{
  const {pasta,origem,rede}=fixture(t),preload=path.join(pasta,'corromper.mjs');
  fs.writeFileSync(preload,`import fs from 'node:fs';import path from 'node:path';const rede=${JSON.stringify(rede)},copiar=fs.copyFileSync;fs.copyFileSync=(a,b,...v)=>{copiar(a,b,...v);if(path.dirname(b)===rede)fs.writeFileSync(b,'copia corrompida')};`);
  await assert.rejects(replicarNaRede({BACKUP_NETWORK_DIR:rede},{origem,prazoMs:10000,iniciar:()=>fork(worker,[],{execArgv:['--import',pathToFileURL(preload).href],stdio:['ignore','ignore','ignore','ipc']})}),/nao confere/);
  assert.deepEqual(fs.readdirSync(rede),['portal-atual.sqlite']);
  assert.equal(fs.readFileSync(path.join(rede,'portal-atual.sqlite'),'utf8'),'copia anterior');
});
for(const fase of ['mkdir','copia','hash'])void test(`I/O sincrono de rede travado em ${fase}: encerra filho, preserva local e aprova pre-atualizacao`,async t=>{
  const {pasta,origem,rede}=fixture(t),marcador=path.join(pasta,'travou.txt');
  const preload=path.join(pasta,'travar.mjs');
  // Injeta somente no processo descartavel. Loop sincrono reproduz uma chamada
  // fs que nao retorna: Promise.race no mesmo processo nao resolveria o caso.
  fs.writeFileSync(preload,`import fs from 'node:fs';import path from 'node:path';
const rede=${JSON.stringify(rede)},marca=${JSON.stringify(marcador)};
function travar(){fs.writeFileSync(marca,'${fase}');for(;;){}}
${fase==='mkdir'?"const fn=fs.mkdirSync;fs.mkdirSync=(a,...b)=>a===rede?travar():fn(a,...b);":fase==='copia'?"fs.copyFileSync=()=>travar();":"let remoto;const abrir=fs.openSync,ler=fs.readSync;fs.openSync=(a,...b)=>{const fd=abrir(a,...b);if(typeof a==='string'&&path.dirname(a)===rede)remoto=fd;return fd};fs.readSync=(fd,...b)=>fd===remoto?travar():ler(fd,...b);"}`);
  let filho;const avisos=[],passos=[];
  const iniciar=()=>{filho=fork(worker,[],{execArgv:['--import',pathToFileURL(preload).href],stdio:['ignore','ignore','ignore','ipc']});return filho;};
  t.after(()=>{if(filho&&filho.exitCode===null&&filho.signalCode===null)filho.kill('SIGKILL');});
  const hashAntes=hashArquivo(origem),inicio=performance.now();
  let pulsos=0;const pulso=setInterval(()=>pulsos++,50);t.after(()=>clearInterval(pulso));
  const codigo=await executarBackup({ensaio:false,preAtualizacao:true,
    copiar(){const db=new DatabaseSync(origem,{readOnly:true});try{assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');passos.push('local validado');}finally{db.close();}},
    rede:()=>replicarNaRede({BACKUP_NETWORK_DIR:rede},{origem,prazoMs:1500,iniciar}),
    email:()=>assert.fail('Nao envia apos falha de rede'),registrar:m=>avisos.push(m)});
  assert.equal(codigo,3);assert.deepEqual(passos,['local validado']);
  assert.match(avisos.join('\n'),/Prazo.*excedido.*processo encerrado.*copia local validada/);
  assert.equal(fs.readFileSync(marcador,'utf8'),fase,'Worker chegou ao I/O bloqueado');
  assert.ok(filho.exitCode!==null||filho.signalCode!==null,'Filho encerrado antes de retornar');
  assert.ok(pulsos>0,'O pai continua respondendo');assert.ok(performance.now()-inicio<10000);
  assert.equal(hashArquivo(origem),hashAntes);
  assert.equal(fs.readFileSync(path.join(rede,'portal-atual.sqlite'),'utf8'),'copia anterior');
});
void test('backup agendado sinaliza erro de prazo; ensaio nao tenta rede',async()=>{
  await assert.rejects(executarBackup({ensaio:false,copiar(){},rede:async()=>{throw new Error('Prazo excedido');},email:()=>assert.fail()}),/Prazo excedido/);
  assert.equal(await executarBackup({ensaio:true,copiar(){},rede:()=>assert.fail(),email:()=>assert.fail()}),0);
});
