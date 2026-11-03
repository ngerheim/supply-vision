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

void test('catalogo: unidade de item com historico no estoque nao muda; sem historico, muda', async t => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-unidade-fixture-'));
  const db = bancoSqliteLocal({ pastaPrivada: pasta, criar: true }), sql = new DatabaseSync(db.arquivo);
  const chave = Symbol.for('supply-vision:banco'), anterior = globalThis[chave], senha = env.INITIAL_ADMIN_PASSWORD;
  globalThis[chave] = db; env.INITIAL_ADMIN_PASSWORD = 'senha-ficticia-unidade';
  t.after(() => { sql.close(); db.fechar(); globalThis[chave] = anterior; env.INITIAL_ADMIN_PASSWORD = senha; fs.rmSync(pasta, { recursive: true, force: true }); });
  await banco.ensureDatabase();
  const admin = (await db.prepare('SELECT id FROM users LIMIT 1').first()).id;
  await db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES(?,?,?,?)').bind(await banco.tokenHash(admin), admin, new Date(Date.now() + 3600000).toISOString(), banco.now()).run();
  const ts = String(banco.now());
  sql.exec(`INSERT INTO catalog_items(id,name,active,unidade_estoque) VALUES('oleo','OLEO FICTICIO',1,'L'),('livre','ITEM SEM USO',1,'un');
    INSERT INTO estoques(id,nome,nome_chave,ativo) VALUES('e1','Estoque ficticio','estoque ficticio',1);
    INSERT INTO movimentos_estoque(id,estoque_id,item_id,tipo,quantidade_centesimos,data_movimento,criado_em) VALUES('m1','e1','oleo','entrada',1000,'${ts}','${ts}');`);
  const editar = async (id, unidadeEstoque) => {
    const atual = sql.prepare('SELECT name,revision FROM catalog_items WHERE id=?').get(id);
    const r = await rota.PUT(new NextRequest(`http://fixture/api/catalogs/items/${id}`, { method: 'PUT',
      headers: { cookie: `acordos_session=${String(admin)}`, 'x-portal-build': PORTAL_BUILD, 'content-type': 'application/json' },
      body: JSON.stringify({ name: atual.name, unidadeEstoque, expectedRevision: atual.revision }) }));
    return r.status;
  };
  assert.equal(await editar('oleo', 'kg'), 409);
  assert.equal(sql.prepare("SELECT unidade_estoque u FROM catalog_items WHERE id='oleo'").get().u, 'L');
  // Mesmo nome, mesma unidade: continua editavel.
  assert.equal(await editar('oleo', 'L'), 200);
  assert.equal(await editar('livre', 'kg'), 200);
  assert.equal(sql.prepare("SELECT unidade_estoque u FROM catalog_items WHERE id='livre'").get().u, 'kg');
});
