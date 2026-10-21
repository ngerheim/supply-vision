import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { MENSAGEM_RESTAURACAO, marcarFilasAposRestauracao } from '../scripts/processar-emails.mjs';

void test('restauracao marca pendentes e em envio como falha para o administrador decidir',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    db.exec(`CREATE TABLE email_notifications(id TEXT,status TEXT,locked_at TEXT,last_error TEXT,updated_at TEXT);
    CREATE TABLE daily_report_deliveries(id TEXT,status TEXT,locked_at TEXT,last_error TEXT,updated_at TEXT);
    INSERT INTO email_notifications VALUES ('p','pending',NULL,NULL,'x'),('e','processing','2026-01-01',NULL,'x'),('s','sent',NULL,NULL,'x');
    INSERT INTO daily_report_deliveries VALUES ('r','pending',NULL,NULL,'x'),('f','failed',NULL,'SMTP','x');`);
    assert.equal(marcarFilasAposRestauracao(db),3);
    const linhas=db.prepare("SELECT id,status,last_error,locked_at FROM email_notifications UNION ALL SELECT id,status,last_error,locked_at FROM daily_report_deliveries").all();
    const porId=Object.fromEntries(linhas.map(l=>[l.id,l]));
    for(const id of ['p','e','r']){assert.equal(porId[id].status,'failed');assert.equal(porId[id].last_error,MENSAGEM_RESTAURACAO);assert.equal(porId[id].locked_at,null)}
    assert.equal(porId.s.status,'sent');assert.equal(porId.f.last_error,'SMTP');
  }finally{db.close()}
});

void test('base sem as tabelas de fila nao quebra a restauracao',()=>{
  const db=new DatabaseSync(':memory:');
  try{assert.equal(marcarFilasAposRestauracao(db),0)}finally{db.close()}
});
