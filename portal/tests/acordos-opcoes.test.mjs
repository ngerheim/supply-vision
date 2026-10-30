import './apoio/logs-email.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { NextRequest } from 'vinext/shims/server';
import { bancoSqliteLocal } from '../lib/sqlite-local.ts';
import { env } from '../scripts/configuracao-servidor.mjs';
import { PORTAL_BUILD } from '../lib/portal-build.ts';

const hooks = registerHooks({ resolve(s, c, next) {
  if (s === 'next/server') return next('vinext/shims/server', c);
  if (s.startsWith('@/')) return next(new URL(`../${s.slice(2)}.ts`, import.meta.url).href, c);
  if (s === './database') return next(new URL('../lib/database.ts', import.meta.url).href, c);
  return next(s, c);
} });
const banco = await import('../lib/database.ts'), rota = await import('../app/api/[...path]/route.ts');
hooks.deregister();

// Regressao da 3.2.0: as consultas de opcoes juntam tabelas que tambem tem
// coluna id; sem alias o ORDER BY ficava ambiguo e a tela de Acordos falhava.
void test('opcoes do filtro de Acordos respondem com dados reais nas tabelas', async t => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-opcoes-acordos-'));
  const db = bancoSqliteLocal({ pastaPrivada: pasta, criar: true }), sql = new DatabaseSync(db.arquivo);
  const chave = Symbol.for('supply-vision:banco'), anterior = globalThis[chave], senha = env.INITIAL_ADMIN_PASSWORD;
  globalThis[chave] = db; env.INITIAL_ADMIN_PASSWORD = 'senha-ficticia-opcoes';
  t.after(() => { sql.close(); db.fechar(); globalThis[chave] = anterior; env.INITIAL_ADMIN_PASSWORD = senha; fs.rmSync(pasta, { recursive: true, force: true }); });
  await banco.ensureDatabase();
  const admin = (await db.prepare('SELECT id FROM users LIMIT 1').first()).id;
  await db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES(?,?,?,?)').bind(await banco.tokenHash(admin), admin, new Date(Date.now() + 3600000).toISOString(), banco.now()).run();
  const ts = banco.now();
  sql.exec(`INSERT INTO suppliers(id,legal_name,trade_name,cnpj,city,state,created_at,updated_at) VALUES('sup1','Fornecedor Ficticio Ltda','Fornecedor Ficticio','12345678000199','Cidade A','MG','${ts}','${ts}');
    INSERT INTO locations(id,city,state) VALUES('loc1','Cidade A','MG');
    INSERT INTO agreements(id,number,supplier_id,status,start_date,created_at,updated_at) VALUES('ag1','LF-900','sup1','active','2026-01-01','${ts}','${ts}');
    INSERT INTO agreement_locations(agreement_id,location_id) VALUES('ag1','loc1');`);
  const pedir = async url => {
    const r = await rota.GET(new NextRequest(`http://fixture/api/${url}`, { headers: { cookie: `acordos_session=${String(admin)}`, 'x-portal-build': PORTAL_BUILD } }));
    return { status: r.status, data: await r.json() };
  };
  const todas = await pedir('agreements/options');
  assert.equal(todas.status, 200, JSON.stringify(todas.data));
  assert.deepEqual(todas.data.options.supplier, [{ id: 'sup1', name: 'Fornecedor Ficticio' }]);
  assert.deepEqual(todas.data.options.location, [{ id: 'loc1', name: 'Cidade A' }]);
  assert.deepEqual(todas.data.options.state, [{ id: 'MG', name: 'MG' }]);
  const filtrada = await pedir('agreements/options?state=MG&supplier=sup1');
  assert.equal(filtrada.status, 200);
  assert.equal((await pedir('agreements?state=SP')).data.agreements.length, 0);
});
