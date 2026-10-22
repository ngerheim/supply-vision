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

void test('Central migra banco existente sem alterar usuarios e reaplica sem duplicar', async t => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-central-migracao-'));
  const db = bancoSqliteLocal({ pastaPrivada:pasta, criar:true });
  const chave = Symbol.for('supply-vision:banco'), anterior = globalThis[chave], senha = env.INITIAL_ADMIN_PASSWORD;
  globalThis[chave] = db; env.INITIAL_ADMIN_PASSWORD = 'senha-ficticia-migracao-central';
  t.after(() => { globalThis[chave] = anterior; env.INITIAL_ADMIN_PASSWORD = senha; db.fechar(); fs.rmSync(pasta,{recursive:true,force:true}); });
  await (await carregar('central-novo')).ensureDatabase();
  const usuarios = (await db.prepare('SELECT * FROM users').all()).results;
  await db.exec('DROP TABLE notificacoes_usuario; DELETE FROM schema_migrations WHERE version=8');
  await (await carregar('central-existente')).ensureDatabase();
  assert.deepEqual((await db.prepare('SELECT * FROM users').all()).results,usuarios);
  assert.equal(await db.prepare('SELECT COUNT(*) n FROM notificacoes_usuario').first('n'),0);
  const marcador = await db.prepare('SELECT * FROM schema_migrations WHERE version=8').first();
  await (await carregar('central-reinicio')).ensureDatabase();
  assert.deepEqual(await db.prepare('SELECT * FROM schema_migrations WHERE version=8').first(),marcador);
});

void test('marcador inserido por concorrente entre consulta e migracao nao conflita', async t => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-migracao-corrida-'));
  const db = bancoSqliteLocal({ pastaPrivada: pasta, criar: true });
  const chave = Symbol.for('supply-vision:banco'), anterior = globalThis[chave], senha = env.INITIAL_ADMIN_PASSWORD;
  const disputadas = [];
  globalThis[chave] = { ...db, prepare(sql) {
    const stmt = db.prepare(sql);
    const versao = sql.match(/^SELECT 1 ok FROM schema_migrations WHERE version=([2-5])$/)?.[1];
    if (!versao) return stmt;
    return { ...stmt, async first() {
      if (!await stmt.first()) {
        await db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').bind(Number(versao), 'concorrente').run();
        disputadas.push(Number(versao));
        return null;
      }
      return stmt.first();
    } };
  } };
  env.INITIAL_ADMIN_PASSWORD = 'senha-ficticia-concorrente';
  t.after(() => { globalThis[chave] = anterior; env.INITIAL_ADMIN_PASSWORD = senha; db.fechar(); fs.rmSync(pasta, { recursive: true, force: true }); });
  await (await carregar('corrida')).ensureDatabase();
  assert.deepEqual(disputadas, [2, 3, 4, 5]);
  assert.deepEqual((await db.prepare('SELECT applied_at FROM schema_migrations WHERE version BETWEEN 2 AND 5').all()).results.map(r => r.applied_at), Array(4).fill('concorrente'));
});

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
  assert.deepEqual((await db.prepare('SELECT version FROM ordem_migracoes ORDER BY posicao').all()).results.map(r => r.version), [1,2,3,4,5,6,7,8]);
  const antes = (await db.prepare('SELECT * FROM schema_migrations ORDER BY version').all()).results;
  const usuarios = (await db.prepare('SELECT * FROM users ORDER BY id').all()).results;
  await (await carregar('reinicio')).ensureDatabase();
  assert.deepEqual((await db.prepare('SELECT * FROM schema_migrations ORDER BY version').all()).results, antes);
  assert.deepEqual((await db.prepare('SELECT * FROM users ORDER BY id').all()).results, usuarios);
  assert.equal(await db.prepare('SELECT COUNT(*) FROM ordem_migracoes').first('COUNT(*)'), 8);
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
  assert.equal(await db.prepare('PRAGMA foreign_keys').first('foreign_keys'), 1);
});
