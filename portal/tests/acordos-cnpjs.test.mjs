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
import { compararCondicoes, validarCnpjsAcordo } from '../lib/acordos-cnpjs.ts';

const hooks = registerHooks({ resolve(s, c, next) {
  if (s === 'next/server') return next('vinext/shims/server', c);
  if (s.startsWith('@/')) return next(new URL(`../${s.slice(2)}.ts`, import.meta.url).href, c);
  if (s === './database') return next(new URL('../lib/database.ts', import.meta.url).href, c);
  return next(s, c);
} });
const banco = await import('../lib/database.ts'), rota = await import('../app/api/[...path]/route.ts');
hooks.deregister();

void test('outros CNPJs: entrada validada e comparacao de condicoes', () => {
  assert.deepEqual(validarCnpjsAcordo(undefined, 'p', ['l1']), {});
  assert.deepEqual(validarCnpjsAcordo([{ supplierId: 'f2' }], 'p', ['l1']).value, [{ supplierId: 'f2', todasCidades: true, locationIds: [] }]);
  assert.match(validarCnpjsAcordo([{ supplierId: 'p' }], 'p', ['l1']).error, /principal/);
  assert.match(validarCnpjsAcordo([{ supplierId: 'f2' }, { supplierId: 'f2' }], 'p', ['l1']).error, /duas vezes/);
  assert.match(validarCnpjsAcordo([{ supplierId: 'f2', todasCidades: false, locationIds: [] }], 'p', ['l1']).error, /pelo menos uma cidade/);
  assert.match(validarCnpjsAcordo([{ supplierId: 'f2', todasCidades: false, locationIds: ['l9'] }], 'p', ['l1']).error, /não pertence/);
  const item = (price, brands = 'X', modelId = 'm') => ({ locationId: 'l', catalogItemId: 'i', modelId, unitId: 'u', price, brands, item: 'I', model: 'M', city: 'C', state: 'MG', unit: 'UN' });
  assert.deepEqual(compararCondicoes([item(10, ' x ')], [item(10.001, 'X')]), []);
  assert.deepEqual(compararCondicoes([item(10)], [item(11)]).map(d => d.tipo), ['preco']);
  assert.deepEqual(compararCondicoes([item(10)], [item(10, 'Y')]).map(d => d.tipo), ['marcas']);
  assert.deepEqual(compararCondicoes([item(10)], [item(10, 'X', 'n')]).map(d => d.tipo).sort(), ['so_neste', 'so_no_outro']);
});

void test('acordo com varios CNPJs: cadastro, Alertas, busca, abrangencia, exclusao e uniao', async t => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-acordos-cnpjs-'));
  const db = bancoSqliteLocal({ pastaPrivada: pasta, criar: true }), sql = new DatabaseSync(db.arquivo);
  const chave = Symbol.for('supply-vision:banco'), anterior = globalThis[chave], senha = env.INITIAL_ADMIN_PASSWORD;
  const tokenAnterior = env.PORTAL_API_TOKEN;
  globalThis[chave] = db; env.INITIAL_ADMIN_PASSWORD = 'senha-ficticia-cnpjs'; env.PORTAL_API_TOKEN = 'token-ficticio-cnpjs';
  t.after(() => { sql.close(); db.fechar(); globalThis[chave] = anterior; env.INITIAL_ADMIN_PASSWORD = senha; env.PORTAL_API_TOKEN = tokenAnterior; fs.rmSync(pasta, { recursive: true, force: true }); });
  await banco.ensureDatabase();
  const admin = String((await db.prepare('SELECT id FROM users LIMIT 1').first()).id);
  await db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES(?,?,?,?)').bind(await banco.tokenHash(admin), admin, new Date(Date.now() + 3600000).toISOString(), banco.now()).run();
  const ts = banco.now();
  sql.exec(`INSERT INTO suppliers(id,legal_name,trade_name,cnpj,created_at,updated_at) VALUES
      ('f1','Matriz Ficticia Ltda','Matriz Ficticia','11222333000181','${ts}','${ts}'),
      ('f2','Filial Ficticia Ltda','Filial Ficticia','11222333000262','${ts}','${ts}'),
      ('f3','Terceira Ficticia Ltda','Terceira Ficticia','11222333000343','${ts}','${ts}');
    INSERT INTO locations(id,city,state) VALUES('l1','Cidade A','MG'),('l2','Cidade B','MG');
    INSERT INTO catalog_items(id,name) VALUES('i1','ITEM FICTICIO');
    INSERT INTO vehicle_models(id,name) VALUES('m1','MODELO FICTICIO');
    INSERT INTO units(id,code,name) VALUES('u1','UNFICT','Unidade ficticia');`);
  const pedir = async (method, url, body) => {
    const headers = { cookie: `acordos_session=${admin}`, 'x-portal-build': PORTAL_BUILD, ...(body ? { 'content-type': 'application/json' } : {}) };
    const r = await rota[method](new NextRequest(`http://fixture/api/${url}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }));
    return { status: r.status, data: r.headers.get('content-type')?.includes('json') ? await r.json() : null };
  };
  const condicao = (versao, local, preco) => sql.prepare(`INSERT INTO agreement_items(id,version_id,location_id,catalog_item_id,vehicle_model_id,unit_id,price,created_at,updated_at)
    VALUES(?,?,?,'i1','m1','u1',?,?,?)`).run(`it-${versao}-${local}`, versao, local, preco, ts, ts);
  const versaoDe = idAcordo => sql.prepare('SELECT current_version_id v FROM agreements WHERE id=?').get(idAcordo).v;
  const revisao = idAcordo => sql.prepare('SELECT revision r FROM agreements WHERE id=?').get(idAcordo).r;

  // Criacao com um CNPJ adicional que so atende a Cidade A.
  const base = { number: 'LF-1', supplierId: 'f1', status: 'active', startDate: '2026-01-01', locationIds: ['l1', 'l2'] };
  assert.equal((await pedir('POST', 'agreements', { ...base, cnpjs: [{ supplierId: 'f1' }] })).status, 400);
  const criado = await pedir('POST', 'agreements', { ...base, cnpjs: [{ supplierId: 'f2', todasCidades: false, locationIds: ['l1'] }] });
  assert.equal(criado.status, 201, JSON.stringify(criado.data));
  const a = criado.data.id;
  condicao(versaoDe(a), 'l1', 100); condicao(versaoDe(a), 'l2', 120);

  // Alertas: a linha de cada condicao sai para cada CNPJ que atende a cidade.
  const pedidoInterno = new NextRequest('http://fixture/api/internal/agreements', { headers: { authorization: 'Bearer token-ficticio-cnpjs', 'x-portal-build': PORTAL_BUILD } });
  const internas = await (await rota.GET(pedidoInterno)).json();
  assert.deepEqual(internas.agreements.map(r => `${r.CNPJ}|${r.CIDADE}|${r.PRECO}`).sort(),
    ['11222333000181|Cidade A|100', '11222333000181|Cidade B|120', '11222333000262|Cidade A|100']);

  // Detalhe, lista e busca encontram o acordo pelo outro CNPJ.
  const detalhe = (await pedir('GET', `agreements/${a}`)).data;
  assert.deepEqual(detalhe.cnpjs.map(c => [c.supplierId, c.todasCidades, c.locationIds, c.cidades]), [['f2', false, ['l1'], ['Cidade A/MG']]]);
  assert.deepEqual((await pedir('GET', 'agreements?supplier=f2')).data.agreements.map(r => [r.id, r.extraCnpjs]), [[a, 1]]);
  const busca = (await pedir('GET', 'search?supplier=f2')).data;
  assert.equal(busca.rows.length, 2);
  assert.ok(busca.rows.every(r => r.extraCnpjs === 1 && r.supplier === 'Matriz Ficticia'));
  assert.ok((await pedir('GET', 'search/options')).data.options.supplier.some(o => o.id === 'f2'));
  assert.ok((await pedir('GET', 'agreements/options')).data.options.supplier.some(o => o.id === 'f2'));

  // Tirar a unica cidade do CNPJ adicional e recusado; a tela antiga (sem a lista) tambem.
  const editar = (corpo) => pedir('PUT', `agreements/${a}`, { ...base, expectedRevision: revisao(a), ...corpo });
  sql.prepare('DELETE FROM agreement_items WHERE location_id=?').run('l1');
  assert.equal((await editar({ locationIds: ['l2'] })).status, 409);
  assert.equal((await editar({ locationIds: ['l2'], cnpjs: [{ supplierId: 'f2', todasCidades: false, locationIds: ['l1'] }] })).status, 400);
  const todas = await editar({ cnpjs: [{ supplierId: 'f2', todasCidades: true }] });
  assert.equal(todas.status, 200, JSON.stringify(todas.data));
  assert.equal(sql.prepare('SELECT todas_cidades t FROM agreement_cnpjs WHERE agreement_id=?').get(a).t, 1);
  assert.match(sql.prepare("SELECT details FROM audit_logs WHERE entity='agreement' AND entity_id=? AND action='UPDATE' ORDER BY created_at DESC").get(a).details, /Filial Ficticia/);
  condicao(versaoDe(a), 'l1', 100);

  // Cadastro do outro CNPJ nao pode ser apagado enquanto estiver no acordo.
  const exclusao = await pedir('DELETE', `catalogs/suppliers/f2?expectedRevision=${String(sql.prepare("SELECT revision r FROM suppliers WHERE id='f2'").get().r)}`);
  assert.equal(exclusao.status, 409);
  assert.match(exclusao.data.error, /outro CNPJ/);

  // Uniao: acordo B (terceiro CNPJ, so na Cidade A). Preco diferente bloqueia.
  const b = (await pedir('POST', 'agreements', { ...base, number: 'LF-2', supplierId: 'f3', locationIds: ['l1'] })).data.id;
  condicao(versaoDe(b), 'l1', 99);
  const comDiferenca = (await pedir('POST', `agreements/${a}/unir`, { outroId: b, expectedRevision: revisao(a) })).data;
  assert.equal(comDiferenca.podeUnir, false);
  assert.ok(comDiferenca.diferencas.some(d => d.tipo === 'preco'));
  assert.ok(comDiferenca.diferencas.some(d => d.tipo === 'so_neste' && d.city === 'Cidade B'));
  // B passa a ter as mesmas condicoes de A (as duas cidades).
  sql.prepare('UPDATE agreement_items SET price=100 WHERE version_id=?').run(versaoDe(b));
  sql.prepare("INSERT INTO agreement_locations(agreement_id,location_id) VALUES(?,'l2')").run(b);
  condicao(versaoDe(b), 'l2', 120);
  sql.prepare("DELETE FROM agreement_locations WHERE agreement_id=? AND location_id='l2'").run(b);
  const previa = (await pedir('POST', `agreements/${a}/unir`, { outroId: b, expectedRevision: revisao(a) })).data;
  assert.equal(previa.podeUnir, true, JSON.stringify(previa));
  assert.deepEqual(previa.cnpjsQueEntram, [{ supplier: 'Terceira Ficticia', cnpj: '11222333000343', todasCidades: false, cidades: ['Cidade A/MG'] }]);
  assert.equal((await pedir('POST', `agreements/${a}/unir`, { outroId: b, expectedRevision: revisao(a), outroRevision: previa.outro.revision - 1, confirmar: true })).status, 409);
  const unido = await pedir('POST', `agreements/${a}/unir`, { outroId: b, expectedRevision: revisao(a), outroRevision: previa.outro.revision, confirmar: true });
  assert.equal(unido.status, 200, JSON.stringify(unido.data));
  assert.deepEqual(sql.prepare('SELECT supplier_id s,todas_cidades t FROM agreement_cnpjs WHERE agreement_id=? ORDER BY supplier_id').all(a).map(r => [r.s, r.t]), [['f2', 1], ['f3', 0]]);
  assert.deepEqual(sql.prepare('SELECT location_id l FROM agreement_cnpj_locations WHERE agreement_id=? AND supplier_id=?').all(a, 'f3').map(r => r.l), ['l1']);
  const suspenso = sql.prepare('SELECT status,notes FROM agreements WHERE id=?').get(b);
  assert.equal(suspenso.status, 'suspended');
  assert.match(suspenso.notes, /Unido ao acordo LF-1/);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM agreement_items WHERE version_id=?').get(versaoDe(b)).n, 2);
  // Excluir o acordo leva junto os outros CNPJs dele.
  assert.equal((await pedir('DELETE', `agreements/${a}?expectedRevision=${String(revisao(a))}`)).status, 200);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM agreement_cnpjs WHERE agreement_id=?').get(a).n, 0);
});
