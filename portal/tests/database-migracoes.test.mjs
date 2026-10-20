import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { bancoSqliteLocal } from '../lib/sqlite-local.ts';
import { env } from '../scripts/configuracao-servidor.mjs';

async function carregar(sufixo) {
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === '@/lib/domain') return { url: new URL('../lib/domain.ts', import.meta.url).href, shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
  try { return await import(`../lib/database.ts?${sufixo}`); }
  finally { hooks.deregister(); }
}

void test('falha ao inspecionar colunas bloqueia inicializacao e retomada migra em ordem sem regravar', async t => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-lote08-migracoes-'));
  const db = bancoSqliteLocal({ pastaPrivada: pasta, criar: true });
  const chave = Symbol.for('supply-vision:banco');
  const anterior = globalThis[chave], senhaAnterior = env.INITIAL_ADMIN_PASSWORD;
  const falha = new Error('falha ficticia de leitura do schema');
  let falhar = true;
  globalThis[chave] = {
    ...db,
    prepare(sql) {
      const consulta = db.prepare(sql);
      return falhar && sql.startsWith('PRAGMA table_info(')
        ? { ...consulta, async all() { throw falha; } }
        : consulta;
    },
  };
  env.INITIAL_ADMIN_PASSWORD = 'senha-ficticia-lote08';
  t.after(() => {
    if (anterior === undefined) delete globalThis[chave]; else globalThis[chave] = anterior;
    env.INITIAL_ADMIN_PASSWORD = senhaAnterior;
    db.fechar();
    fs.rmSync(pasta, { recursive: true, force: true });
  });
  const { ensureDatabase } = await carregar('falha');
  await assert.rejects(ensureDatabase(), erro => erro === falha);
  assert.equal(await db.prepare('SELECT COUNT(*) FROM schema_migrations').first('COUNT(*)'), 0);
  // Observa a ordem real das insercoes, sem copiar as migracoes para o teste.
  await db.exec(`CREATE TABLE ordem_migracoes(posicao INTEGER PRIMARY KEY,version INTEGER);
    CREATE TRIGGER registrar_ordem AFTER INSERT ON schema_migrations BEGIN
      INSERT INTO ordem_migracoes(version) VALUES(NEW.version);
    END`);
  falhar = false;
  await ensureDatabase();
  assert.deepEqual((await db.prepare('SELECT version FROM ordem_migracoes ORDER BY posicao').all()).results.map(r => r.version), [1,2,3,4,5,6,7]);
  const antes = (await db.prepare('SELECT * FROM schema_migrations ORDER BY version').all()).results;
  const usuarios = (await db.prepare('SELECT * FROM users ORDER BY id').all()).results;
  await (await carregar('reinicio')).ensureDatabase();
  assert.deepEqual((await db.prepare('SELECT * FROM schema_migrations ORDER BY version').all()).results, antes);
  assert.deepEqual((await db.prepare('SELECT * FROM users ORDER BY id').all()).results, usuarios);
  assert.equal(await db.prepare('SELECT COUNT(*) FROM ordem_migracoes').first('COUNT(*)'), 7);
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
  assert.equal(await db.prepare('PRAGMA foreign_keys').first('foreign_keys'), 1);
});
