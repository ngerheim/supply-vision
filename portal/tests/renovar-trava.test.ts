import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { RENOVAR_TRAVA_SQL } from '../lib/travas-sql.ts';
void test('reserva expirada ou substituida nao pode ser renovada pelo dono anterior', () => {
  const db=new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE travas(chave TEXT PRIMARY KEY,dono TEXT,adquirida_em TEXT); INSERT INTO travas VALUES('importacao','primeiro','2026-10-06T10:00:00Z')");
    const renovar=db.prepare(RENOVAR_TRAVA_SQL);
    assert.equal(renovar.run('2026-10-06T10:01:00Z','importacao','primeiro','2026-10-06T09:31:00Z').changes,1);
    assert.equal(renovar.run('2026-10-06T11:00:00Z','importacao','primeiro','2026-10-06T10:30:00Z').changes,0);
    db.exec("UPDATE travas SET dono='segundo',adquirida_em='2026-10-06T11:00:00Z'");
    assert.equal(renovar.run('2026-10-06T11:01:00Z','importacao','primeiro','2026-10-06T10:31:00Z').changes,0);
  } finally { db.close(); }
});
