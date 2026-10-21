import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { bancoSqliteLocal } from '../lib/sqlite-local.ts';
import { env } from '../scripts/configuracao-servidor.mjs';
import { NextRequest } from 'vinext/shims/server';

const hook = registerHooks({ resolve(s, c, next) {
  if (s === 'next/server') return next('vinext/shims/server', c);
  if (s.startsWith('@/')) return next(new URL(`../${s.slice(2)}.ts`, import.meta.url).href, c);
  if (s === './database') return next(new URL('../lib/database.ts', import.meta.url).href, c);
  return next(s, c);
} });
const banco = await import('../lib/database.ts');
const rota = await import('../app/api/[...path]/route.ts');
hook.deregister();

void test('viewer pode entrar e sair; todas as escritas de negocio continuam restritas', async t => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-viewer-escrita-'));
  const db = bancoSqliteLocal({ pastaPrivada: pasta, criar: true });
  const chave = Symbol.for('supply-vision:banco'), anterior = globalThis[chave], senha = env.INITIAL_ADMIN_PASSWORD;
  globalThis[chave] = db; env.INITIAL_ADMIN_PASSWORD = 'senha-ficticia-viewer';
  t.after(() => { db.fechar(); globalThis[chave] = anterior; env.INITIAL_ADMIN_PASSWORD = senha; fs.rmSync(pasta, { recursive: true, force: true }); });
  await banco.ensureDatabase();
  await db.prepare("INSERT INTO users(id,name,email,password_salt,password_hash,password_iterations,role,active,created_at) SELECT 'viewer','Viewer fixture','viewer@example.com',password_salt,password_hash,password_iterations,'viewer',1,created_at FROM users LIMIT 1").run();
  const login = await rota.POST(new NextRequest('http://fixture/api/login', { method: 'POST', body: JSON.stringify({email: 'viewer@example.com', password: env.INITIAL_ADMIN_PASSWORD}) }));
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const caminhos = {
    POST: ['agreements', 'agreements/a/items', 'catalogs/items', 'users', 'tickets', 'tickets/t/events', 'daily-report-deliveries/d/retry', 'email-notifications/n/retry', 'imports/agreement/a', 'reports', 'mappings/items'],
    PUT: ['agreements/a', 'items/i', 'catalogs/items/i', 'users/u', 'tickets/t', 'mappings/items/m'],
    DELETE: ['items/i', 'agreements/a', 'catalogs/items/i', 'reports/r', 'mappings/items/m'],
  };
  for (const [method, paths] of Object.entries(caminhos)) for (const caminho of paths) {
    const resposta = await rota[method](new NextRequest(`http://fixture/api/${caminho}`, {method, headers: {cookie}, ...(method !== 'DELETE' ? {body: '{}'} : {})}));
    assert.equal(resposta.status, 403, `${method} ${caminho}`);
  }
  const logout = await rota.POST(new NextRequest('http://fixture/api/logout', {method: 'POST', headers: {cookie}}));
  assert.equal(logout.status, 200);
  assert.equal(await db.prepare("SELECT COUNT(*) n FROM sessions WHERE user_id='viewer'").first('n'), 0);
  assert.equal(await db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE user_id='viewer' AND action IN ('LOGIN','LOGOUT')").first('n'), 2);
});

