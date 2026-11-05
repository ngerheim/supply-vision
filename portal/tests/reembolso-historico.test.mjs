// Banco proprio: ensureDatabase memoriza a primeira base do processo.
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

void test('reembolso: historico de OS troca dias inteiros e so abre para quem usa a aba', async t => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-reembolso-hist-fixture-'));
  const db = bancoSqliteLocal({ pastaPrivada: pasta, criar: true }), sql = new DatabaseSync(db.arquivo);
  const chave = Symbol.for('supply-vision:banco'), anterior = globalThis[chave], senha = env.INITIAL_ADMIN_PASSWORD, token = env.PORTAL_API_TOKEN;
  globalThis[chave] = db; env.INITIAL_ADMIN_PASSWORD = 'senha-ficticia-reembolso'; env.PORTAL_API_TOKEN = 'token-ficticio-historico-0123456789';
  t.after(() => { sql.close(); db.fechar(); globalThis[chave] = anterior; env.INITIAL_ADMIN_PASSWORD = senha; env.PORTAL_API_TOKEN = token; fs.rmSync(pasta, { recursive: true, force: true }); });
  await banco.ensureDatabase();
  for (const [id, role] of [['viewer', 'viewer'], ['bloqueado', 'viewer'], ['editor', 'editor']]) {
    sql.prepare('INSERT INTO users(id,name,email,password_salt,password_hash,role,active,created_at) VALUES(?,?,?,?,?,?,1,?)')
      .run(id, `Pessoa ${id}`, `${id}@example.com`, 'salt', 'hash', role, banco.now());
    await db.prepare('INSERT OR REPLACE INTO sessions(token,user_id,expires_at,last_seen_at) VALUES(?,?,?,?)')
      .bind(await banco.tokenHash(id), id, new Date(Date.now() + 3600000).toISOString(), banco.now()).run();
  }
  sql.prepare("INSERT INTO permissoes_usuario(user_id,area,nivel,atualizado_em) VALUES('bloqueado','reembolso','sem',?)").run(banco.now());
  const enviar = async (corpo, credencial = env.PORTAL_API_TOKEN) => {
    const r = await rota.POST(new NextRequest('http://fixture/api/internal/reembolso-historico', { method: 'POST',
      headers: { authorization: `Bearer ${credencial}`, 'content-type': 'application/json' }, body: JSON.stringify(corpo) }));
    return { status: r.status, data: await r.json() };
  };
  const consultar = async (placa, user = 'viewer') => {
    const r = await rota.GET(new NextRequest(`http://fixture/api/reembolso/historico?placa=${placa}`, { headers: { cookie: `acordos_session=${user}`, 'x-portal-build': PORTAL_BUILD } }));
    return { status: r.status, data: await r.json() };
  };
  const pedir = async (method, url, user, body) => {
    const headers = { cookie: `acordos_session=${user}`, 'x-portal-build': PORTAL_BUILD, ...(body ? { 'content-type': 'application/json' } : {}) };
    const r = await rota[method](new NextRequest(`http://fixture/api/${url}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }));
    return { status: r.status, data: await r.json() };
  };
  const l = (data, os, produto, km, grupo = 'Manutenção') => ({ data, placa: 'EXE1A23', os, produto, qtd: 1, valorUnit: 50, total: 50, reembolso: 0, km, fornecedor: 'Oficina Exemplo', grupo, modelo: 'Picape', cliente: 'Cliente Exemplo' });
  assert.equal((await enviar({ datas: ['2026-10-01'], linhas: [] }, 'credencial-errada')).status, 401);
  assert.deepEqual((await consultar('EXE1A23')).data, { placa: 'EXE1A23', cobertura: null, linhas: [] });
  const primeiro = { datas: ['2026-10-01', '2026-10-02'], linhas: [l('2026-10-01', '10', 'FILTRO DE AR', 30000), l('2026-10-02', '11', 'PASTILHA', 31000)] };
  assert.equal((await enviar(primeiro)).status, 200);
  assert.equal((await enviar(primeiro)).status, 200);
  // Reenvio do dia 02 sem linhas apaga so aquele dia.
  assert.deepEqual((await enviar({ datas: ['2026-10-02'], linhas: [] })).data, { success: true, dias: 1, linhas: 0, filtradas: 0 });
  const r = (await consultar('exe-1a23')).data;
  assert.deepEqual(r.cobertura && [r.cobertura.de, r.cobertura.ate], ['2026-10-01', '2026-10-02']);
  assert.deepEqual(r.linhas.map(x => [x.data, x.os, x.produto, x.km]), [['2026-10-01', '10', 'FILTRO DE AR', 30000]]);
  assert.equal((await consultar('EXE1A23', 'bloqueado')).status, 403);
  assert.equal((await consultar('X')).status, 400);
  assert.equal((await enviar({ datas: ['2026-10-03'], linhas: [l('2026-10-01', '1', 'X', 1)] })).status, 400);

  // Filtro: so Suprimentos inclui; apaga o que ja estava gravado e barra os proximos envios.
  assert.equal((await enviar({ datas: ['2026-10-05'], linhas: [l('2026-10-05', '20', 'LAVAGEM', 32000, 'Lava Jato'), l('2026-10-05', '20', 'PALHETA', 32000)] })).data.filtradas, 0);
  assert.equal((await pedir('POST', 'reembolso/historico/filtros', 'viewer', { coluna: 'grupo', modo: 'igual', valor: 'lava jato' })).status, 403);
  assert.equal((await pedir('GET', 'reembolso/historico/filtros', 'viewer')).status, 403);
  const criado = await pedir('POST', 'reembolso/historico/filtros', 'editor', { coluna: 'grupo', modo: 'igual', valor: 'lava jato' });
  assert.deepEqual([criado.status, criado.data.removidos], [201, 1]);
  assert.equal((await pedir('POST', 'reembolso/historico/filtros', 'editor', { coluna: 'grupo', modo: 'igual', valor: 'LAVA JATO' })).status, 409);
  assert.deepEqual((await consultar('EXE1A23')).data.linhas.map(x => x.produto).sort(), ['FILTRO DE AR', 'PALHETA']);
  assert.equal((await enviar({ datas: ['2026-10-05'], linhas: [l('2026-10-05', '20', 'LAVAGEM', 32000, 'LAVA JATO'), l('2026-10-05', '20', 'PALHETA', 32000)] })).data.filtradas, 1);
  const tela = (await pedir('GET', 'reembolso/historico/filtros', 'editor')).data;
  assert.deepEqual(tela.filtros.map(f => [f.coluna, f.modo, f.valor, f.removidos]), [['grupo', 'igual', 'lava jato', 1]]);
  assert.deepEqual(tela.grupos, [{ valor: 'Manutenção', n: 2 }]);
  assert.deepEqual((await pedir('GET', 'reembolso/historico/valores?coluna=grupo&q=manu', 'editor')).data.valores, [{ valor: 'Manutenção', n: 2 }]);
  assert.equal((await pedir('GET', 'reembolso/historico/valores?coluna=placa', 'editor')).status, 400);
  assert.match(sql.prepare("SELECT details FROM audit_logs WHERE entity='reembolso_historico_filtro' ORDER BY rowid DESC LIMIT 1").get().details, /lava jato.*1 itens apagados/);
  assert.equal((await pedir('DELETE', `reembolso/historico/filtros/${criado.data.id}`, 'viewer')).status, 403);
  assert.equal((await pedir('DELETE', `reembolso/historico/filtros/${criado.data.id}`, 'editor')).status, 200);
  assert.equal((await enviar({ datas: ['2026-10-05'], linhas: [l('2026-10-05', '20', 'LAVAGEM', 32000, 'Lava Jato')] })).data.filtradas, 0);
});
