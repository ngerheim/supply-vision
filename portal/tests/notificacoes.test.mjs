import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { ENTREGAS_EMAIL_SQL, REENVIAR_RELATORIO_DIARIO_SQL, filtrosNotificacoes } from '../lib/notificacoes-api.ts';
import { REENVIAR_NOTIFICACAO_SQL } from '../lib/notificacoes-api.ts';
import { AUDITAR_REENVIO_SQL } from '../lib/auditoria-api.ts';

void test('falha diaria aparece nos filtros e reenvio preserva intervalo original',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    for(const [,ddl] of fs.readFileSync(new URL('../lib/database.ts',import.meta.url),'utf8').matchAll(/`(CREATE TABLE IF NOT EXISTS [^`]+)`/g))db.exec(ddl);
    db.exec(`ALTER TABLE daily_report_deliveries ADD COLUMN period_start TEXT;
      ALTER TABLE daily_report_deliveries ADD COLUMN period_end TEXT;
      INSERT INTO users VALUES('u','Pessoa','ficticio@example.com','s','h','admin',1,'x');
      INSERT INTO daily_report_deliveries(id,user_id,report_date,status,attempts,next_attempt_at,created_at,updated_at,period_start,period_end)
      VALUES('d','u','2026-10-06','failed',5,'x','2026-10-06','antes','2026-10-05T20:45:00Z','2026-10-06T20:45:00Z')`);
    const {where,values}=filtrosNotificacoes(new URLSearchParams({status:'failed',type:'relatorio_diario',recipient:'u',q:'Pessoa'}));
    const rows=db.prepare(`SELECT * FROM ${ENTREGAS_EMAIL_SQL} ${where}`).all(...values);
    assert.equal(rows.length,1);assert.equal(rows[0].delivery_kind,'diario');
    assert.equal(db.prepare(REENVIAR_RELATORIO_DIARIO_SQL).run('agora','agora','d','antes',5).changes,1);
    const depois=db.prepare('SELECT * FROM daily_report_deliveries').get();
    assert.equal(depois.status,'pending');assert.equal(depois.period_start,rows[0].period_start);assert.equal(depois.period_end,rows[0].period_end);
    assert.equal(db.prepare(REENVIAR_RELATORIO_DIARIO_SQL).run('depois','depois','d','antes',5).changes,0);
  } finally { db.close(); }
});

void test('filtros combinam destinatario situacao tipo texto e periodo sem interpolar entrada',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE tickets(id TEXT,code TEXT,supplier_name TEXT);
      CREATE TABLE email_notifications(ticket_id TEXT,status TEXT,type TEXT,recipient_user_id TEXT,recipient_name TEXT,recipient_email TEXT,created_at TEXT);
      INSERT INTO tickets VALUES('1','SUP-0001','OFICINA');
      INSERT INTO email_notifications VALUES('1','failed','atribuicao','u1','Pessoa','p@example.com','2026-10-02T12:00:00Z'),
      ('1','sent','atribuicao','u1','Pessoa','p@example.com','2026-10-01T12:00:00Z');`);
    const params=new URLSearchParams({recipient:'u1',status:'failed',type:'atribuicao',q:'OFICINA',from:'2026-10-02',to:'2026-10-02'});
    const {where,values}=filtrosNotificacoes(params);
    const query=`SELECT e.status FROM (SELECT e.*,t.code ticket_code,t.supplier_name FROM email_notifications e JOIN tickets t ON t.id=e.ticket_id) e ${where}`;
    assert.deepEqual(db.prepare(query).all(...values).map(r=>r.status),['failed']);
    params.set('recipient',"u1' OR 1=1 --");
    const hostile=filtrosNotificacoes(params);
    assert.equal(db.prepare(`SELECT e.status FROM (SELECT e.*,t.code ticket_code,t.supplier_name FROM email_notifications e JOIN tickets t ON t.id=e.ticket_id) e ${hostile.where}`).all(...hostile.values).length,0);
  } finally {db.close();}
});
void test('paginacao recusa numeros fracionarios infinitos e negativos',()=>{
  for(const value of ['-1','Infinity','1.5','NaN']){
    const result=filtrosNotificacoes(new URLSearchParams({page:value,pageSize:value}));
    assert.equal(result.page,1);assert.equal(result.pageSize,25);
  }
  assert.equal(filtrosNotificacoes(new URLSearchParams({pageSize:'999'})).pageSize,100);
});

void test('reenvio atrasado nao reabre entrega nem audita transicao inexistente',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE email_notifications(id TEXT,status TEXT,attempts INTEGER,next_attempt_at TEXT,locked_at TEXT,last_error TEXT,updated_at TEXT);
      CREATE TABLE audit_logs(id TEXT,user_id TEXT,action TEXT,entity TEXT,entity_id TEXT,details TEXT,created_at TEXT);
      INSERT INTO email_notifications VALUES('e','failed',5,'x',NULL,'erro','antes')`);
    const reenviar=()=>{
      db.exec('BEGIN');
      const n=db.prepare(REENVIAR_NOTIFICACAO_SQL).run('agora','agora','e','antes',5).changes;
      db.prepare(AUDITAR_REENVIO_SQL).run('a','u','RETRY','email_notification','e','reenvio','agora');
      db.exec('COMMIT');return n;
    };
    assert.equal(reenviar(),1);
    assert.equal(reenviar(),0);
    db.exec("UPDATE email_notifications SET status='sent',attempts=1,updated_at='depois'");
    assert.equal(reenviar(),0);
    assert.equal(db.prepare('SELECT status FROM email_notifications').get().status,'sent');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n,1);
  } finally { db.close(); }
});
