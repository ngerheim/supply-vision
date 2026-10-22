import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { criarTemporarioTeste } from './apoio/ambiente.mjs';
import { bancoSqliteLocal } from '../lib/sqlite-local.ts';
import { env } from '../scripts/configuracao-servidor.mjs';
import { prepararRestauracao } from '../scripts/restauracao-segura.mjs';
import { validarBanco } from '../scripts/validar-banco.mjs';

const hook = registerHooks({ resolve(s, c, next) {
  if (s === 'next/server') return next('vinext/shims/server', c);
  if (s.startsWith('@/')) return next(new URL(`../${s.slice(2)}.ts`, import.meta.url).href, c);
  return next(s, c);
} });
const banco = await import('../lib/database.ts');
hook.deregister();

void test('cookie valido no backup e revogado depois exige login apos restauracao', async t => {
  const pasta = criarTemporarioTeste('sv-restauracao-sessao-');
  const db = bancoSqliteLocal({ pastaPrivada: pasta, criar: true });
  const chave = Symbol.for('supply-vision:banco'), anterior = globalThis[chave], senha = env.INITIAL_ADMIN_PASSWORD;
  globalThis[chave] = db; env.INITIAL_ADMIN_PASSWORD = 'senha-ficticia-restauracao';
  let restaurado;
  t.after(() => { restaurado?.fechar(); db.fechar(); globalThis[chave] = anterior; env.INITIAL_ADMIN_PASSWORD = senha; fs.rmSync(pasta, { recursive: true, force: true }); });
  await banco.ensureDatabase();
  const usuario = await db.prepare('SELECT id FROM users LIMIT 1').first();
  const token = 'cookie-ficticio-anterior';
  await db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES(?,?,?,?)').bind(await banco.tokenHash(token), usuario.id, new Date(Date.now() + 60000).toISOString(), new Date().toISOString()).run();
  const request = new Request('http://fixture/api/session', { headers: { cookie: `acordos_session=${token}` } });
  assert.equal((await banco.currentUser(request)).id, usuario.id);
  const backup = path.join(pasta, 'backup.sqlite');
  await db.prepare('VACUUM INTO ?').bind(backup).run();
  await db.exec('DELETE FROM sessions');
  assert.equal(await banco.currentUser(request), null);
  const novaRaiz = path.join(pasta, 'restaurado');
  // O adaptador cria apenas a fixture vazia e fecha antes de preparar a copia.
  restaurado = bancoSqliteLocal({ pastaPrivada: novaRaiz, criar: true });
  const destino = restaurado.arquivo; restaurado.fechar();
  prepararRestauracao(backup, destino, validarBanco);
  restaurado = bancoSqliteLocal({ pastaPrivada: novaRaiz });
  globalThis[chave] = restaurado;
  assert.equal(await banco.currentUser(request), null, 'cookie antigo deve exigir novo login');
});
