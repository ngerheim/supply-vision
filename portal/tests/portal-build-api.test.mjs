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
import { PORTAL_BUILD, TELA_DESATUALIZADA } from '../lib/portal-build.ts';

const hooks = registerHooks({ resolve(s, c, next) {
  if (s === 'next/server') return next('vinext/shims/server', c);
  if (s.startsWith('@/')) return next(new URL(`../${s.slice(2)}.ts`, import.meta.url).href, c);
  if (s === './database') return next(new URL('../lib/database.ts', import.meta.url).href, c);
  return next(s, c);
} });
const banco = await import('../lib/database.ts');
const rota = await import('../app/api/[...path]/route.ts');
hooks.deregister();

void test('build na fronteira HTTP protege todas as escritas sem alterar banco ou sessao', async t => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-build-api-'));
  const db = bancoSqliteLocal({pastaPrivada:pasta, criar:true});
  const chave = Symbol.for('supply-vision:banco'), anterior = globalThis[chave], senha = env.INITIAL_ADMIN_PASSWORD;
  globalThis[chave] = db; env.INITIAL_ADMIN_PASSWORD = 'senha-ficticia-build';
  const leitura = new DatabaseSync(db.arquivo);
  t.after(() => { leitura.close(); db.fechar(); globalThis[chave] = anterior; env.INITIAL_ADMIN_PASSWORD = senha; fs.rmSync(pasta, {recursive:true, force:true}); });
  await banco.ensureDatabase();
  const user = await db.prepare('SELECT id FROM users LIMIT 1').first();
  const token = 'sessao-ficticia-build';
  await db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES(?,?,?,?)')
    .bind(await banco.tokenHash(token), user.id, new Date(Date.now()+3600000).toISOString(), new Date(Date.now()-120000).toISOString()).run();
  const pedido = (method, caminho, build, body) => new NextRequest(`http://fixture/api/${caminho}`, {
    method, headers: {cookie:`acordos_session=${token}`, 'content-type':'application/json', ...(build === undefined ? {} : {'x-portal-build':build})},
    ...(body ? {body:JSON.stringify(body)} : {}),
  });
  const snapshot = () => leitura.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name}) => [name, leitura.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`).all()]);
  const antes = snapshot();
  for (const [metodo, caminho] of [['POST','catalogs/items'], ['PUT','users/'+user.id], ['PATCH','users/'+user.id], ['DELETE','catalogs/items/qualquer'], ['POST','login'], ['POST','logout']]) {
    const resposta = await rota[metodo](pedido(metodo, caminho, 'outro-build', {name:'Item indevido'}));
    assert.equal(resposta.status, 409, `${metodo} ${caminho}`);
    assert.equal(resposta.headers.get('x-portal-build'), PORTAL_BUILD);
    assert.deepEqual(await resposta.json(), {error:TELA_DESATUALIZADA, codigo:'build_desatualizado'});
    assert.deepEqual(snapshot(), antes, 'Todas as tabelas, inclusive sessions e auditoria, permanecem iguais');
  }
  for (const build of [PORTAL_BUILD, undefined]) {
    const nome = build ? 'Item build igual' : 'Item sem cabecalho';
    const resposta = await rota.POST(pedido('POST', 'catalogs/items', build, {name:nome}));
    assert.equal(resposta.status, 201);
    assert.equal(resposta.headers.get('x-portal-build'), PORTAL_BUILD);
    assert.equal(await db.prepare('SELECT COUNT(*) n FROM catalog_items WHERE name=?').bind(nome).first('n'), 1);
  }
  for (const caminho of ['health', 'session', 'bootstrap', 'export/agreements', 'rota-ausente']) {
    const resposta = await rota.GET(pedido('GET', caminho, 'outro-build'));
    assert.equal(resposta.status, caminho === 'rota-ausente' ? 404 : 200);
    assert.equal(resposta.headers.get('x-portal-build'), PORTAL_BUILD);
    if (caminho === 'session') assert.equal((await resposta.json()).user.id, user.id, 'A sessao continua valida');
  }
  const semSessao = await rota.GET(new NextRequest('http://fixture/api/bootstrap'));
  assert.equal(semSessao.status,401);
  assert.equal(semSessao.headers.get('x-portal-build'),PORTAL_BUILD);
});
