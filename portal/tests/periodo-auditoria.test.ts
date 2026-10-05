import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { inicioDiaNegocio, intervaloDatasNegocio } from '../lib/periodo-auditoria.ts';

void test('auditoria inclui o fim do dia em São Paulo e exclui o próximo', () => {
  const { inicio, fim } = intervaloDatasNegocio('2026-10-05', '2026-10-05');
  assert.equal(inicio, '2026-10-05T03:00:00.000Z');
  assert.equal(fim, '2026-10-06T03:00:00.000Z');
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE audit_logs (id TEXT,created_at TEXT)');
    const insert = db.prepare('INSERT INTO audit_logs VALUES (?,?)');
    for (const [id, time] of [['antes','2026-10-05T02:59:59.999Z'], ['inicio',inicio!], ['noite','2026-10-06T01:30:00.000Z'], ['fim',fim!]]) insert.run(id!,time!);
    assert.deepEqual(db.prepare('SELECT id FROM audit_logs WHERE created_at>=? AND created_at<? ORDER BY created_at').all(inicio!,fim!).map(row => row.id), ['inicio','noite']);
  } finally { db.close(); }
});

void test('histórico respeita o dia de 23 horas com início do horário de verão', () => {
  assert.equal(inicioDiaNegocio('2018-11-04'), '2018-11-04T03:00:00.000Z');
  assert.equal(inicioDiaNegocio('2018-11-05'), '2018-11-05T02:00:00.000Z');
});

void test('filtros abertos, virada do ano e datas inválidas', () => {
  assert.deepEqual(intervaloDatasNegocio(null,null), {inicio:null,fim:null});
  assert.deepEqual(intervaloDatasNegocio(null,'2026-12-31'), {inicio:null,fim:'2027-01-01T03:00:00.000Z'});
  assert.throws(() => intervaloDatasNegocio('2026-02-30',null));
  assert.throws(() => intervaloDatasNegocio('2026-10-06','2026-10-05'));
});
