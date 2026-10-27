import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { dadosRelatorioDiario, prepararRelatoriosDiarios, reservarRelatoriosDiarios } from '../scripts/processar-emails.mjs';

function banco(){
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,active INTEGER,daily_report_enabled INTEGER,daily_report_time TEXT,role TEXT,email TEXT);
  INSERT INTO users VALUES ('u1','Ana',1,1,'17:45','editor','a@example.com');
  CREATE TABLE daily_report_deliveries (id TEXT PRIMARY KEY,user_id TEXT,report_date TEXT,status TEXT,attempts INTEGER,next_attempt_at TEXT,locked_at TEXT,sent_at TEXT,last_error TEXT,created_at TEXT,updated_at TEXT,UNIQUE(user_id,report_date));
  CREATE TABLE tickets(id TEXT,code TEXT,supplier_name TEXT,status TEXT,created_at TEXT,updated_at TEXT);
  CREATE TABLE ticket_events(ticket_id TEXT,user_id TEXT,kind TEXT,from_status TEXT,to_status TEXT,message TEXT,created_at TEXT);`);
  return db;
}
const periodo=(db,data)=>{const r=db.prepare('SELECT period_start inicio,period_end fim FROM daily_report_deliveries WHERE report_date=?').get(data);return {inicio:r.inicio,fim:r.fim}};

void test('rebaixar usuário impede preparar e enviar relatórios pendentes', () => {
  const db=banco();
  try {
    const agora=new Date('2026-10-05T21:00:00.000Z');
    prepararRelatoriosDiarios(db,agora);
    db.exec("UPDATE users SET role='viewer'");
    assert.deepEqual(reservarRelatoriosDiarios(db,agora),[]);
    assert.equal(db.prepare('SELECT status FROM daily_report_deliveries').get().status,'failed');
    prepararRelatoriosDiarios(db,new Date('2026-10-06T21:00:00.000Z'));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM daily_report_deliveries').get().n,1);
  } finally { db.close(); }
});

void test('chamado criado as 19h de D aparece no relatorio de D+1',()=>{
  const db=banco();
  try{
    prepararRelatoriosDiarios(db,new Date('2026-10-05T20:45:00.000Z')); // 17:45 SP
    db.exec("INSERT INTO tickets VALUES ('a','SUP-1','Oficina','aberto','2026-10-05T22:00:00.000Z','2026-10-05T22:00:00.000Z')"); // 19:00 SP
    const d=periodo(db,'2026-10-05');
    assert.equal(d.inicio,'2026-10-05T03:00:00.000Z');assert.equal(d.fim,'2026-10-05T20:45:00.000Z');
    assert.equal(dadosRelatorioDiario(db,'2026-10-05',new Date(),d).chamados.length,0);
    prepararRelatoriosDiarios(db,new Date('2026-10-06T20:50:00.000Z'));
    const d1=periodo(db,'2026-10-06');
    assert.equal(d1.inicio,d.fim,'sem lacuna nem sobreposicao');
    assert.deepEqual(dadosRelatorioDiario(db,'2026-10-06',new Date(),d1).chamados.map(c=>c.codigo),['SUP-1']);
  }finally{db.close()}
});

void test('congelamento espera o commit do andamento e o inclui exatamente uma vez', async () => {
  const pasta=mkdtempSync(join(tmpdir(),'sv-relatorio-intercalacao-'));
  const arquivo=join(pasta,'portal.sqlite');
  const db=new DatabaseSync(arquivo);
  let worker;
  try{
    db.exec('PRAGMA busy_timeout=5000');
    db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,active INTEGER,daily_report_enabled INTEGER,daily_report_time TEXT,role TEXT,email TEXT);
    INSERT INTO users VALUES ('u1','Ana',1,1,'17:45','editor','a@example.com');
    CREATE TABLE daily_report_deliveries (id TEXT PRIMARY KEY,user_id TEXT,report_date TEXT,status TEXT,attempts INTEGER,next_attempt_at TEXT,locked_at TEXT,sent_at TEXT,last_error TEXT,created_at TEXT,updated_at TEXT,period_start TEXT,period_end TEXT,payload_json TEXT,UNIQUE(user_id,report_date));
    CREATE TABLE tickets(id TEXT,code TEXT,supplier_name TEXT,status TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE ticket_events(ticket_id TEXT,user_id TEXT,kind TEXT,from_status TEXT,to_status TEXT,message TEXT,created_at TEXT);
    INSERT INTO tickets VALUES ('a','SUP-1','Oficina','aberto','2026-10-05T03:00:00.000Z','2026-10-05T03:00:00.000Z');`);
    db.exec('BEGIN IMMEDIATE');
    const timestamp=new Date('2026-10-05T20:44:59.999Z'); // capturado depois de BEGIN IMMEDIATE do produtor
    // O primeiro BEGIN IMMEDIATE do worker usa timeout zero para confirmar,
    // sem sleeps, que o congelamento encontrou a trava do produtor ocupada.
    worker=new Worker(`const {parentPort,workerData}=require('node:worker_threads'); const {DatabaseSync}=require('node:sqlite'); (async()=>{const {prepararRelatoriosDiarios}=await import(workerData.modulo); const db=new DatabaseSync(workerData.arquivo); db.exec('PRAGMA busy_timeout=0'); try{prepararRelatoriosDiarios(db,()=>new Date(workerData.corte),workerData.raiz)}catch(erro){parentPort.postMessage({bloqueado:/locked|busy/i.test(String(erro.message))});} await new Promise(resolve=>parentPort.once('message',resolve)); db.exec('PRAGMA busy_timeout=5000'); const data=prepararRelatoriosDiarios(db,()=>new Date(workerData.corte),workerData.raiz); const payload=db.prepare('SELECT payload_json FROM daily_report_deliveries WHERE report_date=?').get(data).payload_json; parentPort.postMessage({data,payload}); db.close();})().catch(erro=>{parentPort.postMessage({erro:erro.message});});`,{eval:true,workerData:{arquivo,modulo:new URL('../scripts/processar-emails.mjs',import.meta.url).href,raiz:pasta,corte:'2026-10-05T20:45:00.000Z'}});
    const recebido=()=>new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject)});
    const bloqueio=recebido();
    const confirmado=await bloqueio;
    assert.deepEqual(confirmado,{bloqueado:true},'o congelamento precisa disputar a mesma trava');
    db.prepare("INSERT INTO ticket_events (ticket_id,user_id,kind,message,created_at) VALUES ('a','u1','note','Andamento intercalado',?)").run(timestamp.toISOString());
    db.exec('COMMIT');
    const finalizado=recebido();
    worker.postMessage('tentar novamente');
    const relatorio=await finalizado;
    assert.equal(relatorio.erro,undefined);
    const payload=JSON.parse(relatorio.payload);
    const ocorrencias=payload.chamados.flatMap(c=>c.atualizacoes).filter(a=>a.descricao==='Andamento intercalado').length;
    assert.equal(payload.periodo.fim,'2026-10-05T20:45:00.000Z');
    assert.equal(ocorrencias,1);
  }finally{try{db.exec('ROLLBACK')}catch{};db.close();await worker?.terminate();rmSync(pasta,{recursive:true,force:true})}
});

void test('periodo continua do relatorio anterior mesmo nao enviado e e estavel em novas tentativas',()=>{
  const db=banco();
  try{
    prepararRelatoriosDiarios(db,new Date('2026-10-04T21:00:00.000Z'));
    db.prepare("UPDATE daily_report_deliveries SET status='failed'").run();
    prepararRelatoriosDiarios(db,new Date('2026-10-06T21:00:00.000Z'));
    prepararRelatoriosDiarios(db,new Date('2026-10-06T23:00:00.000Z'));
    const d=periodo(db,'2026-10-06');
    assert.equal(d.inicio,'2026-10-04T21:00:00.000Z');assert.equal(d.fim,'2026-10-06T21:00:00.000Z');
  }finally{db.close()}
});

void test('linha antiga sem periodo: o proximo comeca onde o legado terminou',()=>{
  const db=banco();
  try{
    prepararRelatoriosDiarios(db,new Date('2026-10-01T00:00:00.000Z'));
    db.exec("INSERT INTO daily_report_deliveries (id,user_id,report_date,status,attempts,next_attempt_at,sent_at,created_at,updated_at) VALUES ('x','u1','2026-10-05','sent',1,'x','2026-10-05T20:46:00.000Z','2026-10-05T20:45:00.000Z','x')");
    prepararRelatoriosDiarios(db,new Date('2026-10-06T21:00:00.000Z'));
    assert.equal(periodo(db,'2026-10-06').inicio,'2026-10-05T20:46:00.000Z');
  }finally{db.close()}
});
