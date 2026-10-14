import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import test from 'node:test';
import { criarServidorSqlite, arquivoSqliteLocal } from '../scripts/sqlite-local.mjs';
import { bancoSqliteLocal } from '../lib/sqlite-local.ts';

async function fixture(t: test.TestContext) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-teste-sqlite-local-'));
  const arquivo = path.join(pasta, 'fixture.sqlite');
  const seed = new DatabaseSync(arquivo);
  seed.exec('PRAGMA journal_mode=WAL; CREATE TABLE dados (id INTEGER PRIMARY KEY, valor TEXT); CREATE TABLE travas(chave TEXT PRIMARY KEY,dono TEXT)');seed.close();
  const token = 'a'.repeat(64);
  const servidor = criarServidorSqlite({ arquivo, token });
  await new Promise<void>(r => servidor.listen(0, '127.0.0.1', r));
  const porta = (servidor.address() as {port:number}).port;
  const db = bancoSqliteLocal(String(porta), token, () => { throw new Error('Base existente nao usa D1'); });
  t.after(async () => { servidor.closeAllConnections();await new Promise<void>(r => servidor.close(()=>r()));fs.rmSync(pasta, {recursive:true,force:true}); });
  return { pasta, arquivo, porta, token, db };
}

void test('leitura durante reserva de escritor externo funciona sem bookmark, inclusive apos a liberacao', async t => {
  const {arquivo, db} = await fixture(t);
  await db.prepare("INSERT INTO dados VALUES (1,'antes')").run();
  const controle = new Int32Array(new SharedArrayBuffer(4));
  const escritor = new Worker(`const {workerData,parentPort}=require('node:worker_threads');const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(workerData.arquivo);db.exec("BEGIN IMMEDIATE; UPDATE dados SET valor='depois' WHERE id=1");parentPort.postMessage('ocupado');Atomics.wait(new Int32Array(workerData.controle),0,0,2000);db.exec('COMMIT');db.close();`, {eval:true,workerData:{arquivo,controle:controle.buffer}});
  const fim = new Promise<void>((r,j) => { escritor.once('exit',()=>r());escritor.once('error',j); });
  await new Promise<void>((r,j) => { escritor.once('message',()=>r());escritor.once('error',j); });
  try {
    const rs = await Promise.all(Array.from({length:20},()=>db.prepare('SELECT valor FROM dados WHERE id=1').first<{valor:string}>()));
    assert.ok(rs.every(r=>r?.valor==='antes'));
  } finally { Atomics.store(controle,0,1);Atomics.notify(controle,0);await fim; }
  assert.equal((await db.prepare('SELECT valor FROM dados WHERE id=1').first<{valor:string}>())?.valor,'depois');
});

void test('escritas concorrentes respeitam PRIMARY KEY e preservam dono da trava', async t => {
  const {db} = await fixture(t);
  const tentativas = await Promise.allSettled(Array.from({length:20},(_,i)=>db.prepare('INSERT INTO travas VALUES (?,?)').bind('acordo:fixture','dono-'+i).run()));
  assert.equal(tentativas.filter(r=>r.status==='fulfilled').length,1);
  assert.ok(tentativas.filter(r=>r.status==='rejected').every(r=>String(r.reason).includes('UNIQUE')));
  const dono = (await db.prepare('SELECT dono FROM travas').first<{dono:string}>())?.dono;
  const r = await db.prepare('DELETE FROM travas WHERE chave=? AND dono=?').bind('acordo:fixture','outro-dono').run();
  assert.equal(r.meta.changes,0);assert.equal((await db.prepare('SELECT dono FROM travas').first<{dono:string}>())?.dono,dono);
});

void test('batch reverte escrita e auditoria juntas; SELECT em batch mantem snapshot e ordem', async t => {
  const {db} = await fixture(t);
  await assert.rejects(db.batch([db.prepare("INSERT INTO dados VALUES (1,'nao confirmar')"),db.prepare("INSERT INTO ausente VALUES (1)")]),/no such table/);
  assert.equal(await db.prepare('SELECT * FROM dados').first(),null);
  const rs = await db.batch([db.prepare("INSERT INTO dados VALUES (1,'confirmado')"),db.prepare('SELECT valor FROM dados')]);
  assert.equal(rs[0].meta.changes,1);assert.equal(rs[1].results[0].valor,'confirmado');
});

void test('transporte SQL exige token e metodo; blob e primeira coluna preservam contrato D1', async t => {
  const {db,porta,token} = await fixture(t);
  assert.equal((await fetch(`http://127.0.0.1:${porta}/sql`,{method:'POST',body:'{}'})).status,403);
  assert.equal((await fetch(`http://127.0.0.1:${porta}/sql`,{headers:{authorization:`Bearer ${token}`}})).status,404);
  assert.equal((await fetch(`http://127.0.0.1:${porta}/ready`,{headers:{authorization:'Bearer incorreto'}})).status,403);
  assert.deepEqual(await db.prepare('SELECT ? valor').bind(new Uint8Array([1,2,3])).first('valor'),[1,2,3]);
});

void test('arquivo persistido e unico; identidade original e recusa de ambiguidade', t => {
  const pasta=fs.mkdtempSync(path.join(os.tmpdir(),'portal-teste-identidade-'));
  t.after(()=>fs.rmSync(pasta,{recursive:true,force:true}));
  assert.equal(arquivoSqliteLocal(pasta),null);
  const dir=path.join(pasta,'v3/d1/miniflare-D1DatabaseObject');fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'metadata.sqlite'),'');fs.writeFileSync(path.join(dir,'fixture.sqlite'),'');
  assert.equal(arquivoSqliteLocal(pasta),path.join(dir,'fixture.sqlite'));
  fs.writeFileSync(path.join(dir,'outra.sqlite'),'');assert.throws(()=>arquivoSqliteLocal(pasta),/ambiguo/);
});

void test('falha de transporte em escrita nao provoca nova tentativa', async t => {
  let envios = 0;
  t.mock.method(globalThis,'fetch',async (url: string | URL | Request) => {
    const destino=typeof url==='string'?url:url instanceof URL?url.href:url.url;
    if (destino.endsWith('/ready')) return new Response('{"pronto":true}');
    envios++;throw new TypeError('conexao interrompida');
  });
  const db=bancoSqliteLocal('3199','a'.repeat(64),()=>{throw new Error('nao inicializar');});
  await assert.rejects(db.prepare('INSERT INTO dados VALUES (1,?)').bind('fixture').run(),/conexao interrompida/);
  assert.equal(envios,1);
});

void test('batch de escrita aguarda reserva externa sem reenviar ou confirmar parcialmente', async t => {
  const {arquivo,db}=await fixture(t);
  await db.prepare("INSERT INTO dados VALUES (1,'antes')").run();
  const escritor=new Worker(`const {workerData,parentPort}=require('node:worker_threads');const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(workerData);db.exec("BEGIN IMMEDIATE; UPDATE dados SET valor='externo' WHERE id=1");parentPort.postMessage('ocupado');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,150);db.exec('COMMIT');db.close();`,{eval:true,workerData:arquivo});
  const fim=new Promise<void>((r,j)=>{escritor.once('exit',()=>r());escritor.once('error',j);});
  await new Promise<void>((r,j)=>{escritor.once('message',()=>r());escritor.once('error',j);});
  try {
    await db.batch([db.prepare("INSERT INTO dados VALUES (2,'local')"),db.prepare("UPDATE dados SET valor='confirmado' WHERE id=1")]);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM dados').first<{n:number}>())?.n,2);
    assert.equal((await db.prepare('SELECT valor FROM dados WHERE id=1').first<{valor:string}>())?.valor,'confirmado');
  }finally{await fim;}
});

void test('base preparada pela restauracao em journal DELETE retorna a WAL ao abrir no executor', async t => {
  const {arquivo,db}=await fixture(t);
  const restaurado=new DatabaseSync(arquivo);
  restaurado.exec('PRAGMA journal_mode=DELETE');restaurado.close();
  await db.prepare('SELECT 1').first();
  const leitura=new DatabaseSync(arquivo,{readOnly:true});
  try{assert.equal(leitura.prepare('PRAGMA journal_mode').get()?.journal_mode,'wal');assert.equal(leitura.prepare('PRAGMA integrity_check').get()?.integrity_check,'ok');}finally{leitura.close();}
});
