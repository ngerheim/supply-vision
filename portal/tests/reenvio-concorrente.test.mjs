import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { REENVIAR_NOTIFICACAO_SQL, AUDITAR_REENVIO_SQL } from '../lib/reenvio-sql.ts';

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
