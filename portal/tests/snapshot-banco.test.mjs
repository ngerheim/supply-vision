import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { criarSnapshot } from '../scripts/snapshot-banco.mjs';

void test('snapshot inclui transacoes confirmadas no WAL sem fechar escritor', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-snapshot-'));
  const origem = path.join(dir, 'origem.sqlite'), destino = path.join(dir, "copia ' consistente.sqlite");
  const db = new DatabaseSync(origem);
  try {
    const fonte = fs.readFileSync(new URL('../lib/database.ts', import.meta.url), 'utf8');
    for (const [, ddl] of fonte.matchAll(/`(CREATE TABLE IF NOT EXISTS [^`]+)`/g)) db.exec(ddl);
    db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; PRAGMA wal_checkpoint(TRUNCATE)');
    db.exec("INSERT INTO users VALUES ('u','Nome','a@b.com','salt','hash','viewer',1,'2026-10-06')");
    assert.ok(fs.statSync(origem + '-wal').size > 0);
    assert.equal(criarSnapshot(origem, destino).users, 1);
    const copia = new DatabaseSync(destino, { readOnly: true });
    try { assert.equal(copia.prepare('SELECT email FROM users').get().email, 'a@b.com'); }
    finally { copia.close(); }
    assert.throws(() => criarSnapshot(origem, destino), /ja existe/);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
