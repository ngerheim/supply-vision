import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { ENTREGAS_EMAIL_SQL } from '../lib/entregas-email-sql.ts';
import { REENVIAR_RELATORIO_DIARIO_SQL } from '../lib/reenvio-sql.ts';
import { filtrosNotificacoes } from '../lib/filtros-notificacoes.ts';

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
