import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_RELATORIOS } from '../lib/relatorios.ts';

void test('backup real e restauracao CLI recuperam estado e preservam copia anterior', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-backup-e2e-'));
  const banco = path.join(dir, 'portal/banco/estado/state/v3/d1/miniflare-D1DatabaseObject/teste.sqlite');
  fs.mkdirSync(path.dirname(banco), { recursive: true });
  const db = new DatabaseSync(banco);
  const fonte = fs.readFileSync(new URL('../lib/database.ts', import.meta.url), 'utf8');
  for (const [, ddl] of fonte.matchAll(/`(CREATE TABLE IF NOT EXISTS [^`]+)`/g)) db.exec(ddl);
  for (const ddl of SCHEMA_RELATORIOS) db.exec(ddl);
  db.exec("INSERT INTO users(id,name,email,password_hash,password_salt,created_at,role) VALUES('u','Antes','u@example.com','hash','salt','2026-01-01','admin')");
  db.exec("INSERT INTO report_jobs(id,request_key,action,created_by,created_at) VALUES('j','j','paralelo','u','2026-01-01')");
  const env = { ...process.env, SUPPLY_VISION_PRIVADO: dir };
  const cwd = path.resolve(import.meta.dirname, '..');
  try {
    execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', "import { criarCopiaIntegra } from './scripts/backup.mjs'; criarCopiaIntegra(process.argv[1]);", banco], { cwd, env });
    db.exec("UPDATE users SET name='Depois'"); db.close();
    const saida = execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/restaurar-backup.mjs', '--sim'], { cwd, env, encoding: 'utf8' });
    assert.match(saida, /Restauracao concluida/);
    const restaurado = new DatabaseSync(banco);
    assert.equal(restaurado.prepare('SELECT name FROM users').get().name, 'Antes');
    assert.equal(restaurado.prepare('SELECT status FROM report_jobs').get().status, 'review');
    assert.equal(restaurado.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    restaurado.close();
    const pasta = path.join(dir, 'portal/backups');
    const anterior = new DatabaseSync(path.join(pasta, fs.readdirSync(pasta).find(n => n.startsWith('pre-restauracao-'))));
    assert.equal(anterior.prepare('SELECT name FROM users').get().name, 'Depois'); anterior.close();
  } finally { try { db.close(); } catch {} fs.rmSync(dir, { recursive: true, force: true }); }
});
