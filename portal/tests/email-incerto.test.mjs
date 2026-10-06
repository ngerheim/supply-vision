import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { reservarRelatoriosDiarios, reservar, falhar, falhaAntesEntrega } from '../scripts/processar-emails.mjs';

void test('ambas as filas exigem revisao para reservas expiradas inclusive sem horario', () => {
  const db=new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE users(id TEXT,name TEXT,email TEXT,active INTEGER,daily_report_enabled INTEGER);
      CREATE TABLE email_notifications(id TEXT,status TEXT,attempts INTEGER,next_attempt_at TEXT,locked_at TEXT,last_error TEXT,updated_at TEXT,created_at TEXT);
      CREATE TABLE daily_report_deliveries(id TEXT,user_id TEXT,status TEXT,attempts INTEGER,next_attempt_at TEXT,locked_at TEXT,last_error TEXT,updated_at TEXT,created_at TEXT);
      INSERT INTO users VALUES('u','Nome','a@b',1,1);`);
    for (const tabela of ['email_notifications','daily_report_deliveries']) {
      for(const [id,locked] of [['expirada','2000-01-01'],['sem-hora',null]]) {
        db.prepare(`INSERT INTO ${tabela}(id,status,attempts,next_attempt_at,locked_at) VALUES(?,'processing',1,'2000-01-01',?)`).run(id,locked);
      }
    }
    assert.deepEqual(reservar(db),[]);assert.deepEqual(reservarRelatoriosDiarios(db),[]);
    for(const tabela of ['email_notifications','daily_report_deliveries']) {
      for(const r of db.prepare(`SELECT * FROM ${tabela}`).all()) { assert.equal(r.status,'failed');assert.equal(r.attempts,1);assert.match(r.last_error,/resultado incerto/); }
    }
  } finally { db.close(); }
});

void test('timeout durante DATA nao retenta; rejeicao explicita e falha de conexao permitem tentativa', () => {
  assert.equal(falhaAntesEntrega({code:'ETIMEDOUT',command:'DATA'}),false);
  assert.equal(falhaAntesEntrega({code:'ECONNECTION',command:'CONN'}),true);
  assert.equal(falhaAntesEntrega({responseCode:451,command:'DATA'}),true);
  const db=new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE email_notifications(id TEXT,status TEXT,attempts INTEGER,next_attempt_at TEXT,locked_at TEXT,last_error TEXT,updated_at TEXT,created_at TEXT); INSERT INTO email_notifications VALUES('e','processing',1,'2000','lock',NULL,'2000','2000')");
    falhar(db,{id:'e',attempts:1,locked_at:'lock'},Object.assign(new Error('conexao caiu'),{code:'ETIMEDOUT',command:'DATA'}));
    assert.equal(db.prepare('SELECT status FROM email_notifications').get().status,'failed');
    assert.deepEqual(reservar(db),[]);
  } finally { db.close(); }
});
