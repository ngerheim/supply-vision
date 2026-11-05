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
import { calcularItem, calcularTotais, lerCalculadoraHtml, validarCalculo, valorMtbf } from '../lib/reembolso.ts';

const hooks = registerHooks({ resolve(s, c, next) {
  if (s === 'next/server') return next('vinext/shims/server', c);
  if (s.startsWith('@/')) return next(new URL(`../${s.slice(2)}.ts`, import.meta.url).href, c);
  if (s === './database') return next(new URL('../lib/database.ts', import.meta.url).href, c);
  return next(s, c);
} });
const banco = await import('../lib/database.ts'), rota = await import('../app/api/[...path]/route.ts');
hooks.deregister();

// Calculadora antiga ficticia: so as constantes que a importacao le.
const cats = { HATCH_SEDAN: 10000, PICKUP_LEVE: 10000, SUV: 10000, PICKUP_4X4: 10000, VAN: 20000 };
const htmlFicticio = [
  '<html><script>',
  `const CLIENTES = ${JSON.stringify([
    { nome: 'Cliente Alfa Exemplo', taxa: 0.25, pneuKm: 40000, obs: 'SEM OBSERVAÇÂO', executivo: 'ANA' },
    { nome: 'Cliente Beta Exemplo', taxa: 0.1, pneuKm: 30000, obs: 'CONSULTAR TABELA EM ANEXO', executivo: 'BRUNO' },
    { nome: 'Cliente Beta Exemplo', taxa: 0.5, pneuKm: 1, obs: '', executivo: '' },
    { nome: 'Cliente Sem Taxa Exemplo', taxa: null, pneuKm: null, obs: '', executivo: null },
  ])};`,
  `const CLIENT_MTBF_MAP = ${JSON.stringify({ 'Cliente Beta Exemplo': 'BETA' })};`,
  `const MTBF_ESPECIFICO = ${JSON.stringify({ BETA: [{ desc: 'Filtro ar', tipo: 'PRO-RATA', km: { ...cats, VAN: 'Conforme manual' } }] })};`,
  `const MTBF_PADRAO = ${JSON.stringify(Object.fromEntries(Object.keys(cats).map(c => [c, [
    { desc: 'Filtro de ar', km: cats[c], tipo: 'INTEGRAL', starred: false },
    { desc: 'Pastilha de freio', km: c === 'VAN' ? '24 MESES' : 30000, tipo: 'PROPORCIONAL', starred: false },
  ]])))};`,
  `const MTBF_ORIGEM_LABELS = ${JSON.stringify({ BETA: 'Tabela Beta Exemplo' })};`,
  '</script></html>',
].join('\n');

void test('reembolso: formulas iguais a planilha, inclusive negativo vira zero', () => {
  const prop = calcularItem({ tipo: 'PROPORCIONAL', kmTroca: 40000, ultimaTroca: 10000, qtd: 4, valorUnit: 500, diferencaPneu: 0 }, 30000, 0.25);
  assert.deepEqual([prop.valorTotal, prop.kmRestante, prop.avaria, prop.valorTaxa, prop.reembolso], [2000, 20000, 1000, 250, 1250]);
  const integral = calcularItem({ tipo: 'INTEGRAL', kmTroca: 10000, ultimaTroca: 0, qtd: 1, valorUnit: 80, diferencaPneu: 20 }, 50000, 0.1);
  assert.equal(Math.round(integral.reembolso * 100) / 100, 110);
  const vencido = calcularItem({ tipo: 'PROPORCIONAL', kmTroca: 10000, ultimaTroca: 0, qtd: 1, valorUnit: 100, diferencaPneu: 0 }, 30000, 0.25);
  assert.deepEqual([vencido.avaria, vencido.reembolso, vencido.valorTaxa], [-200, 0, 0]);
  assert.equal(calcularItem({ tipo: 'PROPORCIONAL', kmTroca: 0, ultimaTroca: 0, qtd: 1, valorUnit: 100, diferencaPneu: 0 }, 1000, 0.25).reembolso, 0);
  assert.equal(calcularTotais([{ tipo: 'INTEGRAL', kmTroca: 0, ultimaTroca: 0, qtd: 2, valorUnit: 10, diferencaPneu: 0 }], 0, 0).reembolso, 20);
  assert.deepEqual([valorMtbf('10.000'), valorMtbf('24 MESES'), valorMtbf(' '), valorMtbf(null)], [10000, '24 MESES', null, null]);
  assert.throws(() => validarCalculo({ categoria: 'CAMINHAO', itens: [{}] }));
  assert.throws(() => validarCalculo({ categoria: 'SUV', itens: [] }));
  assert.equal(validarCalculo({ categoria: 'SUV', placa: 'abc-1d23', taxa: 0.25, itens: [{ qtd: '2', valorUnit: '10.5' }] }).placa, 'ABC1D23');
});

void test('reembolso: importacao le a calculadora HTML sem executar nada', () => {
  const r = lerCalculadoraHtml(htmlFicticio);
  assert.deepEqual(r.tabelas.map(t => [t.chave, t.nome, t.padrao, t.itens.length]), [['PADRAO', 'MTBF padrão', true, 2], ['BETA', 'Tabela Beta Exemplo', false, 1]]);
  assert.deepEqual(r.tabelas[0].itens[1].valores, { HATCH_SEDAN: 30000, PICKUP_LEVE: 30000, SUV: 30000, PICKUP_4X4: 30000, VAN: '24 MESES' });
  assert.equal(r.tabelas[1].itens[0].tipo, 'PROPORCIONAL');
  assert.deepEqual(r.clientes.map(c => [c.nome, c.taxa, c.observacao, c.tabela]), [
    ['Cliente Alfa Exemplo', 0.25, null, null], ['Cliente Beta Exemplo', 0.1, 'CONSULTAR TABELA EM ANEXO', 'BETA'], ['Cliente Sem Taxa Exemplo', null, null, null],
  ]);
  assert.throws(() => lerCalculadoraHtml('<html>nada</html>'), /CLIENTES/);
});

void test('reembolso: importacao, configuracao com historico, calculos e permissoes', async t => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-reembolso-fixture-'));
  const db = bancoSqliteLocal({ pastaPrivada: pasta, criar: true }), sql = new DatabaseSync(db.arquivo);
  const chave = Symbol.for('supply-vision:banco'), anterior = globalThis[chave], senha = env.INITIAL_ADMIN_PASSWORD;
  globalThis[chave] = db; env.INITIAL_ADMIN_PASSWORD = 'senha-ficticia-reembolso';
  t.after(() => { sql.close(); db.fechar(); globalThis[chave] = anterior; env.INITIAL_ADMIN_PASSWORD = senha; fs.rmSync(pasta, { recursive: true, force: true }); });
  await banco.ensureDatabase();
  const admin = (await db.prepare('SELECT id FROM users LIMIT 1').first()).id;
  for (const [id, role] of [['editor', 'editor'], ['viewer', 'viewer'], ['viewer2', 'viewer']]) {
    sql.prepare('INSERT INTO users(id,name,email,password_salt,password_hash,role,active,created_at) VALUES(?,?,?,?,?,?,1,?)')
      .run(id, `Pessoa ${id}`, `${id}@example.com`, 'salt', 'hash', role, banco.now());
  }
  for (const user of [admin, 'editor', 'viewer', 'viewer2']) {
    await db.prepare('INSERT OR REPLACE INTO sessions(token,user_id,expires_at,last_seen_at) VALUES(?,?,?,?)')
      .bind(await banco.tokenHash(user), user, new Date(Date.now() + 3600000).toISOString(), banco.now()).run();
  }
  const pedir = async (method, url, user, body) => {
    const headers = { cookie: `acordos_session=${user}`, 'x-portal-build': PORTAL_BUILD, ...(body ? { 'content-type': 'application/json' } : {}) };
    const r = await rota[method](new NextRequest(`http://fixture/api/${url}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }));
    return { status: r.status, data: await r.json() };
  };

  // Consulta usa, mas nao configura nem importa.
  assert.equal((await pedir('GET', 'reembolso/config', 'viewer')).status, 200);
  assert.equal((await pedir('POST', 'reembolso/importar', 'viewer', { html: htmlFicticio })).status, 403);
  assert.equal((await pedir('POST', 'reembolso/importar', 'editor', { html: htmlFicticio })).status, 200);
  assert.equal((await pedir('POST', 'reembolso/importar', 'editor', { html: htmlFicticio })).status, 409);
  assert.equal((await pedir('POST', 'reembolso/importar', 'editor', { html: htmlFicticio, substituir: true })).status, 200);
  const config = (await pedir('GET', 'reembolso/config', 'viewer')).data;
  assert.equal(config.podeConfigurar, false);
  assert.deepEqual(config.tabelas.map(t => [t.nome, t.padrao, t.itens.length]), [['MTBF padrão', true, 2], ['Tabela Beta Exemplo', false, 1]]);
  const beta = config.clientes.find(c => c.nome === 'Cliente Beta Exemplo');
  assert.equal(beta.tabelaId, config.tabelas[1].id);

  // Taxa muda para todos na hora e fica no Historico; revisao velha e recusada.
  assert.equal((await pedir('PUT', `reembolso/clientes/${beta.id}`, 'viewer', { ...beta, taxa: 0.2 })).status, 403);
  assert.equal((await pedir('PUT', `reembolso/clientes/${beta.id}`, 'editor', { ...beta, taxa: 0.2, expectedRevision: beta.revision })).status, 200);
  assert.equal((await pedir('PUT', `reembolso/clientes/${beta.id}`, 'editor', { ...beta, taxa: 0.3, expectedRevision: beta.revision })).status, 409);
  assert.match(sql.prepare("SELECT details FROM audit_logs WHERE entity='reembolso_cliente' ORDER BY rowid DESC LIMIT 1").get().details, /Cliente Beta Exemplo: taxa: 10% → 20%/);
  assert.equal((await pedir('GET', 'reembolso/config', 'viewer')).data.clientes.find(c => c.id === beta.id).taxa, 0.2);
  assert.equal((await pedir('POST', 'reembolso/clientes', 'editor', { nome: 'cliente alfa exemplo', taxa: 0.1 })).status, 409);
  const novo = await pedir('POST', 'reembolso/clientes', 'editor', { nome: 'Cliente Gama Exemplo', taxa: 0.15, ativo: false });
  assert.equal(novo.status, 201);
  assert.equal((await pedir('GET', 'reembolso/config', 'viewer')).data.clientes.some(c => c.id === novo.data.id), false);
  assert.equal((await pedir('GET', 'reembolso/config', 'editor')).data.clientes.some(c => c.id === novo.data.id), true);

  // Tabela: salva inteira com revisao; vinculada ou padrao nao sai.
  const tabela = config.tabelas[1];
  const itens = [{ descricao: 'Filtro ar', tipo: 'INTEGRAL', valores: { SUV: '15000', VAN: 'Conforme manual' } }, { descricao: 'Correia', tipo: 'PROPORCIONAL', valores: { SUV: 50000 } }];
  assert.equal((await pedir('PUT', `reembolso/tabelas/${tabela.id}`, 'editor', { nome: 'Tabela Beta Exemplo', itens, expectedRevision: tabela.revision })).status, 200);
  assert.equal((await pedir('PUT', `reembolso/tabelas/${tabela.id}`, 'editor', { nome: 'Tabela Beta Exemplo', itens: [], expectedRevision: tabela.revision })).status, 409);
  const salva = (await pedir('GET', 'reembolso/config', 'viewer')).data.tabelas.find(t => t.id === tabela.id);
  assert.deepEqual(salva.itens.map(i => [i.descricao, i.valores.SUV, i.valores.VAN ?? null]), [['Filtro ar', 15000, 'Conforme manual'], ['Correia', 50000, null]]);
  assert.equal((await pedir('DELETE', `reembolso/tabelas/${tabela.id}`, 'editor')).status, 409);
  assert.equal((await pedir('DELETE', `reembolso/tabelas/${config.tabelas[0].id}`, 'editor')).status, 409);

  // Calculo salvo por qualquer perfil, totais refeitos no servidor; taxa do dia fica gravada.
  const calculo = { placa: 'abc1d23', cliente: 'Cliente Beta Exemplo', taxa: 0.2, categoria: 'SUV', modelo: 'Modelo X', kmAtual: 30000,
    itens: [{ peca: 'Pastilha', referencia: 'Correia', tipo: 'PROPORCIONAL', kmTroca: 40000, ultimaTroca: 10000, qtd: 4, valorUnit: 500 }], totalReembolso: 999999 };
  const salvo = await pedir('POST', 'reembolso/calculos', 'viewer', calculo);
  assert.equal(salvo.status, 201);
  assert.equal(salvo.data.totalReembolso, 1200);
  assert.equal((await pedir('PUT', `reembolso/clientes/${beta.id}`, 'editor', { ...beta, taxa: 0.5, expectedRevision: beta.revision + 1 })).status, 200);
  const detalhe = (await pedir('GET', `reembolso/calculos/${salvo.data.id}`, 'viewer2')).data.calculo;
  assert.deepEqual([detalhe.placa, detalhe.taxa, detalhe.totalReembolso, detalhe.itens[0].reembolso], ['ABC1D23', 0.2, 1200, 1200]);
  assert.equal((await pedir('GET', 'reembolso/calculos?q=abc', 'viewer2')).data.total, 1);
  assert.equal((await pedir('GET', 'reembolso/calculos?q=zzz', 'viewer2')).data.total, 0);
  // So o autor ou Suprimentos exclui.
  assert.equal((await pedir('DELETE', `reembolso/calculos/${salvo.data.id}`, 'viewer2')).status, 403);
  assert.equal((await pedir('DELETE', `reembolso/calculos/${salvo.data.id}`, 'viewer')).status, 200);
  assert.equal((await pedir('GET', `reembolso/calculos/${salvo.data.id}`, 'viewer')).status, 404);

  // Painel de permissoes: sem acesso bloqueia; edicao concedida libera configurar.
  sql.prepare("INSERT INTO permissoes_usuario(user_id,area,nivel,atualizado_em) VALUES('viewer2','reembolso','sem',?)").run(banco.now());
  assert.equal((await pedir('GET', 'reembolso/config', 'viewer2')).status, 403);
  sql.prepare("INSERT INTO permissoes_usuario(user_id,area,nivel,atualizado_em) VALUES('viewer','reembolso','edicao',?)").run(banco.now());
  assert.equal((await pedir('DELETE', `reembolso/clientes/${novo.data.id}`, 'viewer')).status, 200);
});
