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
import { lerFiltros, mediana, pareto, variacaoPorCidade } from '../lib/analise.ts';
import { conciliar } from '../lib/analise-acoes.ts';

const hooks = registerHooks({ resolve(s, c, next) {
  if (s === 'next/server') return next('vinext/shims/server', c);
  if (s.startsWith('@/')) return next(new URL(`../${s.slice(2)}.ts`, import.meta.url).href, c);
  if (s === './database') return next(new URL('../lib/database.ts', import.meta.url).href, c);
  return next(s, c);
} });
const banco = await import('../lib/database.ts'), rota = await import('../app/api/[...path]/route.ts');
hooks.deregister();

void test('analise: mediana, pareto 20/80, variacao sem lancamento isolado e corte no periodo padrao', () => {
  assert.equal(mediana([3, 1, 1000]), 3);
  assert.equal(mediana([1, 2, 3, 4]), 2.5);
  assert.equal(mediana([]), null);
  const p = pareto([50, 20, 10, 5, 5, 4, 3, 1, 1, 1]);
  assert.deepEqual([p.total, p.top20.quantidade, p.top20.participacao, p.ate80.quantidade], [10, 2, 0.7, 3]);
  const linhas = [];
  for (const preco of [30, 31, 32, 880]) linhas.push({ item: 'Vela', modelo: 'M', cidade: 'A', preco });
  for (const preco of [40, 41, 42]) linhas.push({ item: 'Vela', modelo: 'M', cidade: 'B', preco });
  linhas.push({ item: 'Vela', modelo: 'M', cidade: 'C', preco: 999 }); // uma compra so: fora
  const [v] = variacaoPorCidade(linhas);
  assert.deepEqual([v.menor.cidade, v.menor.preco, v.maior.cidade, v.maior.preco, v.cidades], ['A', 31.5, 'B', 41, 2]);
  const sem = new URLSearchParams();
  assert.equal(lerFiltros(sem, '2026-10-31', '2026-09-18').de, '2026-09-18');
  assert.equal(lerFiltros(sem, '2026-10-31', '2026-01-01').de, '2026-08-03');
  assert.equal(lerFiltros(new URLSearchParams('de=2026-01-01'), '2026-10-31', '2026-09-18').de, '2026-01-01');
});

void test('analise: conciliacao das sugestoes', () => {
  const c = (chave) => ({ chave, tipo: 'cobrar', titulo: chave, detalhe: '', impacto: 1, filtro: {} });
  const atuais = [
    { id: '1', chave: 'pendente-some', status: 'pendente', adiada_ate: null, resolvida_em: null },
    { id: '2', chave: 'pulada-venceu', status: 'pulada', adiada_ate: '2026-10-01', resolvida_em: null },
    { id: '3', chave: 'pulada-ainda', status: 'pulada', adiada_ate: '2026-12-01', resolvida_em: null },
    { id: '4', chave: 'rejeitada', status: 'rejeitada', adiada_ate: null, resolvida_em: '2026-01-01T00:00:00Z' },
    { id: '5', chave: 'feita-velha', status: 'feita', adiada_ate: null, resolvida_em: '2026-08-01T00:00:00Z' },
    { id: '6', chave: 'feita-nova', status: 'feita', adiada_ate: null, resolvida_em: '2026-10-20T00:00:00Z' },
    { id: '7', chave: 'encerrada', status: 'encerrada', adiada_ate: null, resolvida_em: null },
  ];
  const plano = conciliar(atuais, ['pulada-venceu', 'pulada-ainda', 'rejeitada', 'feita-velha', 'feita-nova', 'encerrada', 'nova'].map(c), '2026-11-03');
  assert.deepEqual(plano.inserir.map(x => x.chave), ['nova']);
  assert.deepEqual(plano.encerrar.map(x => x.id), ['1']);
  assert.deepEqual(plano.atualizar.map(u => [u.id, u.para ?? null]), [['2', 'pendente'], ['3', null], ['4', null], ['5', 'pendente'], ['6', null], ['7', 'pendente']]);
});

void test('analise: sugestoes geradas no fim do envio, resolvidas com historico e painel do fornecedor', async t => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-acoes-fixture-'));
  const db = bancoSqliteLocal({ pastaPrivada: pasta, criar: true }), sql = new DatabaseSync(db.arquivo);
  const chave = Symbol.for('supply-vision:banco'), anterior = globalThis[chave], senha = env.INITIAL_ADMIN_PASSWORD, token = env.PORTAL_API_TOKEN;
  globalThis[chave] = db; env.INITIAL_ADMIN_PASSWORD = 'senha-ficticia-acoes'; env.PORTAL_API_TOKEN = 'token-ficticio-acoes-0123456789';
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
  const pedir = async (method, url, user, body) => {
    const headers = { cookie: `acordos_session=${user}`, 'x-portal-build': PORTAL_BUILD, ...(body ? { 'content-type': 'application/json' } : {}) };
    const r = await rota[method](new NextRequest(`http://fixture/api/${url}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }));
    return { status: r.status, data: await r.json() };
  };
  const interno = async (url, corpo, credencial = env.PORTAL_API_TOKEN) => {
    const r = await rota.POST(new NextRequest(`http://fixture/api/internal/${url}`, { method: 'POST', headers: { authorization: `Bearer ${credencial}`, 'content-type': 'application/json' }, body: JSON.stringify(corpo) }));
    return { status: r.status, data: await r.json() };
  };
  const linha = (extra) => ({ grupo: 'G', os: 'OS', cidade: 'Cidade A', fornecedor: 'Oficina X', cnpj: '1', modelo: 'M1', item: 'Filtro',
    qtd: 1, precoOs: 100, precoAcordo: 100, totalOs: 100, totalAcordo: 100, difTotal: 0, status: 'CONFORME', motivo: null, tinhaAcordo: 'SIM',
    menorPreco: 100, fornecedorAcordo: 'Oficina X', difMenor: 0, ...extra });
  const dia = '2026-10-30', linhas = [];
  for (let i = 0; i < 20; i++) linhas.push(linha({}));
  for (let i = 0; i < 10; i++) linhas.push(linha({ fornecedor: 'Pneus Sem Acordo', status: 'SEM ACORDO', motivo: 'Fornecedor', tinhaAcordo: 'NAO', totalOs: 500, precoAcordo: null, totalAcordo: null, difTotal: null, menorPreco: null, fornecedorAcordo: null, difMenor: null }));
  for (let i = 0; i < 5; i++) linhas.push(linha({ status: 'ACIMA DO ACORDO', precoOs: 200, totalOs: 200, difTotal: 100 }));
  for (let i = 0; i < 4; i++) linhas.push(linha({ fornecedor: 'Oficina Y', status: 'SEM ACORDO', motivo: 'Fornecedor', tinhaAcordo: 'SIM', totalOs: 400, difMenor: 300, fornecedorAcordo: 'Oficina X' }));
  linhas.push(linha({ status: 'SEM ACORDO', motivo: 'Modelo', modelo: 'Modelo Raro', totalOs: 10 })); // irrelevante: fica de fora
  assert.equal((await interno('compras', { data: dia, linhas })).status, 200);

  assert.equal((await interno('analise/concluir', { corteVigencia: '2026-09-18' }, 'errado')).status, 401);
  assert.equal((await interno('analise/concluir', { corteVigencia: '18/09/2026' })).status, 400);
  const fim = await interno('analise/concluir', { corteVigencia: '2026-09-18' });
  assert.equal(fim.status, 200, JSON.stringify(fim.data));
  assert.equal(fim.data.novas, 3);

  assert.equal((await pedir('GET', 'analise/acoes', 'viewer')).status, 403);
  const lista = await pedir('GET', 'analise/acoes', 'editor');
  assert.equal(lista.data.podeResolver, true);
  assert.deepEqual(lista.data.acoes.map(a => a.titulo), [
    'Fechar acordo com Pneus Sem Acordo', 'Direcionar compras de Cidade A para Oficina X', 'Cobrar e renegociar com Oficina X',
  ]);
  const [fechar, direcionar, cobrar] = lista.data.acoes;
  assert.match(fechar.detalhe, /5\.000 em 10 compras/);

  // Rejeitar exige motivo; feito, pular e reabrir ficam no historico.
  assert.equal((await pedir('POST', `analise/acoes/${fechar.id}`, 'editor', { de: 'pendente', para: 'rejeitada' })).status, 400);
  assert.equal((await pedir('POST', `analise/acoes/${fechar.id}`, 'editor', { de: 'pendente', para: 'rejeitada', motivo: 'Fornecedor não aceita acordo' })).status, 200);
  assert.equal((await pedir('POST', `analise/acoes/${fechar.id}`, 'editor', { de: 'pendente', para: 'feita' })).status, 409);
  assert.equal((await pedir('POST', `analise/acoes/${direcionar.id}`, 'editor', { de: 'pendente', para: 'pulada', dias: 30 })).data.status, 'pulada');
  assert.equal((await pedir('POST', `analise/acoes/${cobrar.id}`, admin, { de: 'pendente', para: 'feita' })).status, 200);
  assert.equal((await pedir('GET', 'analise/acoes?lista=pulada', 'editor')).data.acoes[0].id, direcionar.id);
  const historico = await pedir('GET', 'analise/acoes?lista=historico', 'editor');
  assert.ok(historico.data.eventos.some(e => e.para === 'rejeitada' && e.motivo === 'Fornecedor não aceita acordo' && e.usuario === 'Pessoa editor'));
  assert.match(sql.prepare("SELECT details FROM audit_logs WHERE entity='analise_acao' AND entity_id=?").get(direcionar.id).details, /Adiada por 30 dias/);

  // Novo envio: rejeitada nao volta, pulada segue adiada, feita recente fica feita.
  await interno('analise/concluir', {});
  assert.deepEqual((await pedir('GET', 'analise/acoes', 'editor')).data.acoes, []);
  assert.equal(sql.prepare("SELECT status FROM analise_acoes WHERE id=?").get(fechar.id).status, 'rejeitada');
  assert.equal((await pedir('POST', `analise/acoes/${fechar.id}`, 'editor', { de: 'rejeitada', para: 'pendente' })).status, 200);
  assert.equal((await pedir('GET', 'analise/acoes', 'editor')).data.contagem.pendentes, 1);

  // Consulta le, mas nao resolve.
  sql.prepare("INSERT INTO permissoes_usuario(user_id,area,nivel,atualizado_em) VALUES('viewer','analise','leitura',?)").run(banco.now());
  await db.prepare('INSERT OR REPLACE INTO sessions(token,user_id,expires_at,last_seen_at) VALUES(?,?,?,?)')
    .bind(await banco.tokenHash('viewer'), 'viewer', new Date(Date.now() + 3600000).toISOString(), banco.now()).run();
  assert.equal((await pedir('GET', 'analise/acoes', 'viewer')).data.podeResolver, false);
  assert.equal((await pedir('POST', `analise/acoes/${fechar.id}`, 'viewer', { de: 'pendente', para: 'feita' })).status, 403);

  // Painel: corte, meses anteriores marcados, pareto e fornecedor.
  const painel = await pedir('GET', 'analise?de=2026-08-01&ate=2026-10-31', 'editor');
  assert.equal(painel.data.corteVigencia, '2026-09-18');
  assert.equal(painel.data.pareto.fornecedores.total, 3);
  assert.equal(painel.data.abc.fornecedores[0].fornecedor, 'Pneus Sem Acordo');
  assert.equal((await pedir('GET', 'analise', 'editor')).data.filtros.de, '2026-09-18');
  const f = await pedir('GET', 'analise/fornecedor?nome=Oficina%20X&de=2026-10-01&ate=2026-10-31', 'editor');
  assert.equal(f.status, 200, JSON.stringify(f.data));
  assert.equal(f.data.indicadores.pagoAcima, 500);
  assert.equal(f.data.itens.find(i => i.modelo === 'M1').medianaPreco, 100);
});
