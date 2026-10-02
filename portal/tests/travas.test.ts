import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { LIMPAR_TRAVAS_VENCIDAS_SQL, TRAVA_VALIDADE_MS } from '../lib/travas-sql.ts';

void test('subida de outra instancia preserva exclusividade e limpa somente travas vencidas', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE travas (chave TEXT PRIMARY KEY, dono TEXT, adquirida_em TEXT NOT NULL)');
    const agora = Date.parse('2026-10-02T15:00:00Z');
    const limite = new Date(agora - TRAVA_VALIDADE_MS).toISOString();
    const inserir = db.prepare('INSERT INTO travas VALUES (?,?,?)');
    inserir.run('acordo:ativo', 'instancia-a', new Date(agora).toISOString());
    inserir.run('importacao', 'instancia-b', limite);
    inserir.run('acordo:orfao', 'instancia-antiga', new Date(agora - TRAVA_VALIDADE_MS - 1).toISOString());
    assert.equal(db.prepare(LIMPAR_TRAVAS_VENCIDAS_SQL).run(limite).changes, 1);
    assert.throws(() => inserir.run('acordo:ativo', 'instancia-c', new Date(agora).toISOString()), /UNIQUE/);
    assert.equal(db.prepare('SELECT dono FROM travas WHERE chave=?').get('acordo:ativo')?.dono, 'instancia-a');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM travas').get()?.n, 2);
    assert.doesNotThrow(() => inserir.run('acordo:orfao', 'instancia-c', new Date(agora).toISOString()));
  } finally { db.close(); }
});
