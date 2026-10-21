import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { SITUACAO_EFETIVA_SQL, correspondeSituacaoAcordo } from '../lib/situacao-acordos.ts';

void test('situação efetiva respeita início, fim inclusivo e os 60 dias', () => {
  const db=new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE agreements (id TEXT,status TEXT,start_date TEXT,end_date TEXT)');
    const insert=db.prepare('INSERT INTO agreements VALUES (?,?,?,?)');
    for(const row of [['futuro','active','2026-10-06',null],['vence-hoje','active','2026-01-01','2026-10-05'],['60-dias','active','2026-01-01','2026-12-04'],['61-dias','active','2026-01-01','2026-12-05'],['aberto','active','2026-01-01',null],['expirado','active','2026-01-01','2026-10-04'],['suspenso','suspended','2026-11-01',null]])insert.run(...row);
    const statuses=db.prepare(`SELECT id,${SITUACAO_EFETIVA_SQL} AS effectiveStatus FROM agreements a`).all('2026-10-05');
    assert.deepEqual(statuses.map(r=>r.effectiveStatus),['scheduled','expiring','expiring','active','active','expired','suspended']);
    assert.deepEqual(statuses.filter(r=>correspondeSituacaoAcordo(String(r.effectiveStatus),'active')).map(r=>r.id),['vence-hoje','60-dias','61-dias','aberto']);
    assert.equal(correspondeSituacaoAcordo('scheduled','scheduled'),true);
    assert.equal(correspondeSituacaoAcordo('expiring','expiring'),true);
    assert.equal(correspondeSituacaoAcordo('scheduled','active'),false);
  } finally {db.close();}
});
