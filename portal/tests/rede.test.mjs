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
import { chaveTexto, distanciaKm, filtrarRede, localizarMunicipio, municipios, validarSnapshotRede } from '../lib/rede.ts';

const hooks = registerHooks({ resolve(s, c, next) {
  if (s === 'next/server') return next('vinext/shims/server', c);
  if (s.startsWith('@/')) return next(new URL(`../${s.slice(2)}.ts`, import.meta.url).href, c);
  if (s === './database') return next(new URL('../lib/database.ts', import.meta.url).href, c);
  return next(s, c);
} });
const banco = await import('../lib/database.ts'), rota = await import('../app/api/[...path]/route.ts');
hooks.deregister();

// Fornecedores ficticios em cidades reais (so as coordenadas importam).
const fornecedor = (codigo, extra) => ({ codigo, nomeFantasia: `Oficina ${codigo}`, razaoSocial: `Oficina ${codigo} Ltda`, cidade: 'Belo Horizonte',
  uf: 'MG', cnpj: null, telefone: '(31) 0000-0000', email: null, ultimoPedido: '2026-10-28', segmentos: ['Mecânica Automotiva'], ...extra });
const lista = () => [
  fornecedor('1'),
  fornecedor('2', { nomeFantasia: 'Auto Elétrica Acordo', cnpj: '11222333000181', segmentos: ['Auto Elétrica'] }),
  fornecedor('3', { cidade: 'Contagem', segmentos: ['Mecânica Automotiva', 'Auto Peças'] }),
  fornecedor('4', { cidade: 'Betim' }),
  fornecedor('5', { cidade: 'Uberlândia' }),
  fornecedor('6', { nomeFantasia: 'Banco Exemplo', cidade: 'Belo Horizonte', segmentos: ['Instituição Financeira'] }),
  fornecedor('7', { cidade: 'Cidade Inexistente', uf: 'MG', segmentos: [] }),
];

void test('rede: normalizacao, municipios, distancia e validacao', () => {
  assert.equal(chaveTexto("Olhos-D'Água"), 'olhos d agua');
  assert.equal(localizarMunicipio('belo horizonte', 'mg')?.ibge, '3106200');
  assert.equal(localizarMunicipio('Belo Horizonte', 'PA'), null);
  assert.ok(municipios().opcoes.length > 5500);
  const bh = localizarMunicipio('Belo Horizonte', 'MG'), contagem = localizarMunicipio('Contagem', 'MG');
  const km = distanciaKm(bh, contagem);
  assert.ok(km > 10 && km < 25, String(km));
  assert.equal(validarSnapshotRede({ linhas: [fornecedor(662, { cnpj: '11.222.333/0001-81' })] }).linhas[0].cnpj, '11222333000181');
  assert.equal(validarSnapshotRede({ linhas: [fornecedor('1', { cnpj: '123' })] }).linhas[0].cnpj, null);
  assert.deepEqual(validarSnapshotRede({ linhas: [fornecedor('1', { segmentos: [' A ', 'A', ''] })] }).linhas[0].segmentos, ['A']);
  assert.throws(() => validarSnapshotRede({ linhas: [fornecedor('1'), fornecedor('1')] }), /repetido/);
  assert.throws(() => validarSnapshotRede({ linhas: [fornecedor('../x')] }));
  assert.equal(validarSnapshotRede({ linhas: [fornecedor('1', { uf: 'Minas' })] }).linhas[0].uf, null);
  assert.throws(() => validarSnapshotRede({ linhas: [fornecedor('1', { ultimoPedido: '28/10/2026' })] }));
  assert.throws(() => validarSnapshotRede({ linhas: [fornecedor('1', { nomeFantasia: '', razaoSocial: null })] }));
});

void test('rede: cidade primeiro, depois proximas por distancia; acordo antes na mesma cidade', () => {
  const bh = localizarMunicipio('Belo Horizonte', 'MG');
  const linha = (codigo, nome, cidade, acordos = []) => ({ codigo, nome, razaoSocial: null, cidade, uf: 'MG', ibge: localizarMunicipio(cidade, 'MG')?.ibge ?? null,
    cnpj: null, telefone: null, email: null, ultimoPedido: null, busca: chaveTexto(`${nome} ${cidade}`), segmentos: ['X'], acordos });
  const linhas = [linha('a', 'Zeta', 'Belo Horizonte'), linha('b', 'Alfa', 'Betim'), linha('c', 'Beta', 'Contagem'), linha('d', 'Omega', 'Belo Horizonte', ['AC-1']),
    linha('e', 'Longe', 'Uberlândia'), { ...linha('f', 'Sem lugar', 'Lugar nenhum'), ibge: null }];
  const r = filtrarRede(linhas, { centro: bh, raioKm: 100, segmentos: [], texto: '', soAcordo: false });
  assert.deepEqual(r.map(x => x.codigo), ['d', 'a', 'c', 'b']);
  assert.deepEqual(r.map(x => x.mesmaCidade), [true, true, false, false]);
  assert.ok(r[2].distanciaKm < r[3].distanciaKm);
  assert.deepEqual(filtrarRede(linhas, { centro: null, raioKm: 100, segmentos: [], texto: 'belo', soAcordo: false }).map(x => x.codigo), ['d', 'a']);
  assert.deepEqual(filtrarRede(linhas, { centro: null, raioKm: 100, segmentos: [], texto: '', soAcordo: true }).map(x => x.codigo), ['d']);
  assert.equal(filtrarRede(linhas, { centro: bh, raioKm: 50, segmentos: ['Y'], texto: '', soAcordo: false }).length, 0);
});

void test('rede: copia pelo token, acordo por CNPJ, exclusoes e permissoes', async t => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-rede-fixture-'));
  const db = bancoSqliteLocal({ pastaPrivada: pasta, criar: true }), sql = new DatabaseSync(db.arquivo);
  const chave = Symbol.for('supply-vision:banco'), anterior = globalThis[chave], senha = env.INITIAL_ADMIN_PASSWORD, token = env.PORTAL_API_TOKEN;
  globalThis[chave] = db; env.INITIAL_ADMIN_PASSWORD = 'senha-ficticia-rede'; env.PORTAL_API_TOKEN = 'token-ficticio-rede-0123456789';
  t.after(() => { sql.close(); db.fechar(); globalThis[chave] = anterior; env.INITIAL_ADMIN_PASSWORD = senha; env.PORTAL_API_TOKEN = token; fs.rmSync(pasta, { recursive: true, force: true }); });
  await banco.ensureDatabase();
  const admin = (await db.prepare('SELECT id FROM users LIMIT 1').first()).id;
  for (const [id, role] of [['editor', 'editor'], ['viewer', 'viewer']]) {
    sql.prepare('INSERT INTO users(id,name,email,password_salt,password_hash,role,active,created_at) VALUES(?,?,?,?,?,?,1,?)')
      .run(id, `Pessoa ${id}`, `${id}@example.com`, 'salt', 'hash', role, banco.now());
  }
  for (const user of [admin, 'editor', 'viewer']) {
    await db.prepare('INSERT OR REPLACE INTO sessions(token,user_id,expires_at,last_seen_at) VALUES(?,?,?,?)')
      .bind(await banco.tokenHash(user), user, new Date(Date.now() + 3600000).toISOString(), banco.now()).run();
  }
  // Acordo vigente e acordo vencido para o mesmo CNPJ: so o vigente destaca.
  sql.prepare("INSERT INTO suppliers(id,legal_name,trade_name,cnpj,created_at,updated_at) VALUES('sup1','Auto Eletrica Ltda','Auto Eletrica','11222333000181',?,?)").run(banco.now(), banco.now());
  sql.prepare("INSERT INTO agreements(id,number,supplier_id,status,start_date,end_date,created_at,updated_at) VALUES('ag1','AC-VIGENTE','sup1','active','2020-01-01',NULL,?,?)").run(banco.now(), banco.now());
  sql.prepare("INSERT INTO agreements(id,number,supplier_id,status,start_date,end_date,created_at,updated_at) VALUES('ag2','AC-VENCIDO','sup1','active','2020-01-01','2021-01-01',?,?)").run(banco.now(), banco.now());

  const pedir = async (method, url, user, body) => {
    const headers = { cookie: `acordos_session=${user}`, 'x-portal-build': PORTAL_BUILD, ...(body ? { 'content-type': 'application/json' } : {}) };
    const r = await rota[method](new NextRequest(`http://fixture/api/${url}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }));
    return { status: r.status, data: await r.json() };
  };
  const publicar = async (corpo, credencial = env.PORTAL_API_TOKEN) => {
    const r = await rota.POST(new NextRequest('http://fixture/api/internal/rede', { method: 'POST', headers: { authorization: `Bearer ${credencial}`, 'content-type': 'application/json' }, body: JSON.stringify(corpo) }));
    return { status: r.status, data: await r.json() };
  };
  const bh = '3106200';

  assert.equal((await publicar({ linhas: lista() }, 'errado')).status, 401);
  assert.equal((await publicar({ linhas: [] })).status, 400);
  const vazia = await pedir('GET', 'rede', 'viewer');
  assert.equal(vazia.status, 200);
  assert.equal(vazia.data.atualizacao, null);

  const primeira = await publicar({ linhas: lista() });
  assert.equal(primeira.status, 200, JSON.stringify(primeira.data));
  assert.deepEqual([primeira.data.linhas, primeira.data.semCoordenada], [7, 1]);

  // Consulta le; com cidade, a propria cidade primeiro e o acordo na frente.
  const porCidade = await pedir('GET', `rede?cidade=${bh}&raio=100`, 'viewer');
  assert.equal(porCidade.status, 200);
  assert.deepEqual(porCidade.data.linhas.map(l => l.codigo), ['2', '6', '1', '3', '4']);
  assert.deepEqual(porCidade.data.linhas[0].acordos, ['AC-VIGENTE']);
  assert.deepEqual([porCidade.data.naCidade, porCidade.data.proximas, porCidade.data.cidade.nome], [3, 2, 'Belo Horizonte/MG']);
  assert.equal((await pedir('GET', 'rede?cidade=999', 'viewer')).status, 400);
  assert.equal((await pedir('GET', 'rede?acordo=1', 'viewer')).data.total, 1);
  assert.equal((await pedir('GET', 'rede?q=11222333', 'viewer')).data.total, 1);
  assert.equal((await pedir('GET', `rede?segmento=${encodeURIComponent('Auto Peças')}`, 'viewer')).data.total, 1);
  assert.ok((await pedir('GET', 'rede/cidades', 'viewer')).data.cidades.some(c => c.id === bh && c.name === 'Belo Horizonte/MG'));

  // So o admin (ou quem ganhar edicao na area) desconsidera.
  assert.equal((await pedir('GET', 'rede/exclusoes', 'editor')).status, 403);
  assert.equal((await pedir('POST', 'rede/exclusoes/fornecedores', 'editor', { codigo: '1' })).status, 403);
  assert.equal((await pedir('POST', 'rede/exclusoes/fornecedores', admin, { codigo: 'nao-existe' })).status, 404);
  assert.equal((await pedir('POST', 'rede/exclusoes/fornecedores', admin, { codigo: '1', motivo: 'Uso só do financeiro' })).status, 200);
  assert.equal((await pedir('POST', 'rede/exclusoes/fornecedores', admin, { codigo: '1' })).status, 409);
  assert.equal((await pedir('POST', 'rede/exclusoes/segmentos', admin, { segmento: 'Instituição Financeira' })).status, 200);
  assert.equal((await pedir('POST', 'rede/exclusoes/segmentos', admin, { segmento: 'Mecânica Automotiva' })).status, 200);
  const depois = await pedir('GET', `rede?cidade=${bh}`, 'viewer');
  // 6 so tinha o segmento excluido; 3 ainda tem Auto Pecas; 4 so tinha Mecanica.
  assert.deepEqual(depois.data.linhas.map(l => l.codigo), ['2', '3']);
  assert.deepEqual(depois.data.linhas[1].segmentos, ['Auto Peças']);
  assert.ok(!depois.data.segmentos.some(s => s.nome === 'Instituição Financeira'));
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity IN ('rede_exclusoes','rede_segmentos_excluidos')").get().n, 3);

  // Exclusoes sobrevivem a troca da copia; queda brusca mantem a copia atual.
  const queda = await publicar({ linhas: lista().slice(0, 2) });
  assert.equal(queda.status, 409);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM rede_fornecedores').get().n, 7);
  assert.equal((await publicar({ linhas: lista().slice(0, 2), aceitarQueda: true })).status, 200);
  assert.equal((await publicar({ linhas: lista() })).status, 200);
  const exclusoes = await pedir('GET', 'rede/exclusoes', admin);
  assert.equal(exclusoes.status, 200);
  assert.deepEqual(exclusoes.data.fornecedores.map(f => [f.codigo, f.motivo, f.presente]), [['1', 'Uso só do financeiro', 1]]);
  assert.deepEqual(exclusoes.data.semCoordenada, [{ cidade: 'Cidade Inexistente', uf: 'MG', total: 1 }]);

  // Edicao concedida no painel libera a gestao para o editor.
  sql.prepare("INSERT INTO permissoes_usuario(user_id,area,nivel,atualizado_em) VALUES('editor','rede','edicao',?)").run(banco.now());
  assert.equal((await pedir('DELETE', 'rede/exclusoes/fornecedores?codigo=1', 'editor')).status, 200);
  assert.equal((await pedir('DELETE', `rede/exclusoes/segmentos?segmento=${encodeURIComponent('Mecânica Automotiva')}`, 'editor')).status, 200);
  assert.equal((await pedir('DELETE', 'rede/exclusoes/fornecedores?codigo=1', 'editor')).status, 404);
  assert.deepEqual((await pedir('GET', `rede?cidade=${bh}`, 'viewer')).data.linhas.map(l => l.codigo), ['2', '1', '3', '4']);
  // Sem leitura na area, nem a consulta.
  sql.prepare("INSERT INTO permissoes_usuario(user_id,area,nivel,atualizado_em) VALUES('viewer','rede','sem',?)").run(banco.now());
  assert.equal((await pedir('GET', 'rede', 'viewer')).status, 403);
});
