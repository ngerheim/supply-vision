import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { validarBanco } from '../scripts/validar-banco.mjs';

void test('validador compartilhado aceita schema legado e recusa banco alheio, colunas ausentes e referencias orfas', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-validar-banco-'));
  const arquivo = path.join(dir, 'banco.sqlite');
  const db = new DatabaseSync(arquivo);
  try {
    db.exec('CREATE TABLE alheio(id INTEGER)');
    assert.throws(() => validarBanco(arquivo), /tabela ausente/);
    const fonte = fs.readFileSync(new URL('../lib/database.ts', import.meta.url), 'utf8');
    for (const [, ddl] of fonte.matchAll(/`(CREATE TABLE IF NOT EXISTS [^`]+)`/g)) db.exec(ddl);
    assert.equal(validarBanco(arquivo).users, 0);
    db.exec('ALTER TABLE users RENAME COLUMN password_hash TO errado');
    assert.throws(() => validarBanco(arquivo), /password_hash/);
    db.exec('ALTER TABLE users RENAME COLUMN errado TO password_hash');
    db.exec("PRAGMA foreign_keys=OFF; INSERT INTO sessions VALUES ('sessao','usuario-inexistente','2026-10-06')");
    assert.throws(() => validarBanco(arquivo), /referencias orfas/);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
