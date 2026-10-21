import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as esperar } from 'node:timers/promises';

void test('escritor permanece reservado ate todas as respostas, inclusive alem de cinco segundos', async t => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-teste-gate-'));
  const arquivo = path.join(pasta, 'fixture.sqlite'), db = new DatabaseSync(arquivo);
  db.exec('PRAGMA busy_timeout=10; CREATE TABLE audit_logs(id TEXT PRIMARY KEY,action TEXT,entity TEXT,details TEXT,created_at TEXT)');
  const argv = process.argv, antes = { ...process.env };
  process.argv = [process.execPath, 'fixture', pasta, arquivo];
  Object.assign(process.env, { PORTAL_TESTE_DESCARTAVEL: 'SIM', PORTAL_TESTE_PORTA: '45678' });
  let iniciou, liberar;
  const pronto = new Promise(r => { iniciou = r; }), fim = new Promise(r => { liberar = r; });
  t.mock.method(globalThis, 'fetch', async () => { iniciou(); await fim; return new Response('{}'); });
  const execucao = import('../scripts/teste-sqlite-local-concorrente.mjs');
  t.after(async () => { liberar(); await execucao; db.close(); fs.rmSync(pasta, { recursive: true, force: true }); process.argv = argv; process.env = antes; });
  await pronto;
  await esperar(5200);
  try { assert.throws(() => db.exec('BEGIN IMMEDIATE'), /locked|busy/i); }
  finally { if (db.isTransaction) db.exec('ROLLBACK'); }
});
