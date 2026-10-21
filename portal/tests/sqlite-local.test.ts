import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import test from 'node:test';
import { diretorioBanco, localizarBanco } from '../scripts/banco-local.mjs';
import { bancoSqliteLocal } from '../lib/sqlite-local.ts';

async function fixture(t: test.TestContext) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-teste-sqlite-local-'));
  const dir = diretorioBanco(pasta);fs.mkdirSync(dir,{recursive:true});
  const arquivo = path.join(dir, 'fixture.sqlite');
  const seed = new DatabaseSync(arquivo);
  seed.exec('PRAGMA journal_mode=WAL; CREATE TABLE dados (id INTEGER PRIMARY KEY, valor TEXT); CREATE TABLE travas(chave TEXT PRIMARY KEY,dono TEXT)');seed.close();
  const db = bancoSqliteLocal({ pastaPrivada: pasta });
  t.after(() => { db.fechar();fs.rmSync(pasta, {recursive:true,force:true}); });
  return { pasta, arquivo, db };
}

void test('leitura durante reserva de escritor externo funciona sem bookmark, inclusive apos a liberacao', async t => {
  const {arquivo, db} = await fixture(t);
  await db.prepare("INSERT INTO dados VALUES (1,'antes')").run();
  const controle = new Int32Array(new SharedArrayBuffer(4));
  const escritor = new Worker(`const {workerData,parentPort}=require('node:worker_threads');const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(workerData.arquivo);db.exec("BEGIN IMMEDIATE; UPDATE dados SET valor='depois' WHERE id=1");parentPort.postMessage('ocupado');Atomics.wait(new Int32Array(workerData.controle),0,0,30000);if(Atomics.load(new Int32Array(workerData.controle),0)!==1)throw new Error('reserva sem liberacao');db.exec('COMMIT');db.close();`, {eval:true,workerData:{arquivo,controle:controle.buffer}});
  const fim = new Promise<void>((r,j) => { escritor.once('exit',codigo=>codigo===0?r():j(new Error(`Escritor encerrou com codigo ${codigo}`)));escritor.once('error',j); });
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

void test('blob e primeira coluna preservam contrato esperado pela API', async t => {
  const {db} = await fixture(t);
  assert.deepEqual(await db.prepare('SELECT ? valor').bind(new Uint8Array([1,2,3])).first('valor'),[1,2,3]);
  await db.exec('CREATE TABLE relacao(id INTEGER PRIMARY KEY, dado INTEGER REFERENCES dados(id))');
  await assert.rejects(db.prepare('INSERT INTO relacao VALUES (1,999)').run(),/FOREIGN KEY/);
});

void test('arquivo persistido e unico; identidade original e recusa de ambiguidade', t => {
  const pasta=fs.mkdtempSync(path.join(os.tmpdir(),'portal-teste-identidade-'));
  t.after(()=>fs.rmSync(pasta,{recursive:true,force:true}));
  assert.equal(localizarBanco(null,pasta),null);
  const dir=diretorioBanco(pasta);fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'metadata.sqlite'),'');fs.writeFileSync(path.join(dir,'fixture.sqlite'),'');
  assert.equal(localizarBanco(null,pasta),path.join(dir,'fixture.sqlite'));
  fs.writeFileSync(path.join(dir,'outra.sqlite'),'');assert.throws(()=>localizarBanco(null,pasta),/ambiguo/);
});

void test('batch de escrita aguarda reserva externa sem reenviar ou confirmar parcialmente', async t => {
  const {arquivo,db}=await fixture(t);
  await db.prepare("INSERT INTO dados VALUES (1,'antes')").run();
  const escritor=new Worker(`const {workerData,parentPort}=require('node:worker_threads');const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(workerData);db.exec("BEGIN IMMEDIATE; UPDATE dados SET valor='externo' WHERE id=1");parentPort.postMessage('ocupado');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,150);db.exec('COMMIT');db.close();`,{eval:true,workerData:arquivo});
  const fim=new Promise<void>((r,j)=>{escritor.once('exit',codigo=>codigo===0?r():j(new Error(`Escritor encerrou com codigo ${codigo}`)));escritor.once('error',j);});
  await new Promise<void>((r,j)=>{escritor.once('message',()=>r());escritor.once('error',j);});
  try {
    await db.batch([db.prepare("INSERT INTO dados VALUES (2,'local')"),db.prepare("UPDATE dados SET valor='confirmado' WHERE id=1")]);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM dados').first<{n:number}>())?.n,2);
    assert.equal((await db.prepare('SELECT valor FROM dados WHERE id=1').first<{valor:string}>())?.valor,'confirmado');
  }finally{await fim;}
});

void test('restauracao em DELETE volta a WAL e conexao ativa bloqueia restauracao exclusiva', async t => {
  const { travarRestauracao } = await import('../scripts/trava-restauracao.mjs');
  const {pasta,arquivo,db} = await fixture(t);
  db.fechar();
  const seed = new DatabaseSync(arquivo);seed.exec('PRAGMA journal_mode=DELETE');seed.close();
  const reaberto=bancoSqliteLocal({pastaPrivada:pasta,pastaRestauracao:pasta});
  try {
    assert.throws(()=>travarRestauracao(true,pasta),/ao mesmo tempo/);
    const leitura=new DatabaseSync(arquivo,{readOnly:true});
    try { assert.equal(leitura.prepare('PRAGMA journal_mode').get()?.journal_mode,'wal'); }
    finally { leitura.close(); }
  } finally { reaberto.fechar(); }
  const liberar=travarRestauracao(true,pasta);liberar();
});

void test('arquivo existente mantem caminho, inode e dados; criacao explicita usa nome fixo', async t => {
  const pasta=fs.mkdtempSync(path.join(os.tmpdir(),'sv-identidade-'));
  t.after(()=>fs.rmSync(pasta,{recursive:true,force:true}));
  assert.throws(()=>bancoSqliteLocal({pastaPrivada:pasta}),/nao inicializado/);
  const novo=bancoSqliteLocal({pastaPrivada:pasta,criar:true});
  const arquivo=novo.arquivo!;
  assert.equal(path.basename(arquivo),'portal.sqlite');
  await novo.exec("CREATE TABLE prova(valor TEXT);INSERT INTO prova VALUES('preservado')");novo.fechar();
  const legado=path.join(path.dirname(arquivo),'hash-legado.sqlite');fs.renameSync(arquivo,legado);
  const antes=fs.statSync(legado).ino;
  const aberto=bancoSqliteLocal({pastaPrivada:pasta});
  try {
    assert.equal(aberto.arquivo,legado);assert.equal(fs.statSync(legado).ino,antes);
    assert.equal(await aberto.prepare('SELECT valor FROM prova').first('valor'),'preservado');
  }finally{aberto.fechar();}
});
