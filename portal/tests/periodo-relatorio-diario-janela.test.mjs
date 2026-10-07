import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { dadosRelatorioDiario, prepararRelatoriosDiarios, reservarRelatoriosDiarios } from '../scripts/processar-emails.mjs';

function banco(){
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,active INTEGER,daily_report_enabled INTEGER,daily_report_time TEXT,role TEXT,email TEXT);
  INSERT INTO users VALUES ('u1','Ana',1,1,'17:45','editor','a@exemplo.com');
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
