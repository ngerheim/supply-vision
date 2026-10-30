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
import { curvaAbc, validarDia } from '../lib/analise.ts';

const hooks = registerHooks({ resolve(s, c, next) {
  if (s === 'next/server') return next('vinext/shims/server', c);
  if (s.startsWith('@/')) return next(new URL(`../${s.slice(2)}.ts`, import.meta.url).href, c);
  if (s === './database') return next(new URL('../lib/database.ts', import.meta.url).href, c);
  return next(s, c);
} });
const banco = await import('../lib/database.ts'), rota = await import('../app/api/[...path]/route.ts');
hooks.deregister();

const linha = (extra) => ({
  grupo: 'Manutencao', os: 'OS-1', cidade: 'Cidade A', fornecedor: 'Oficina X', cnpj: '12345678000199', modelo: 'Modelo 1',
  item: 'Troca de oleo', qtd: 1, precoOs: 100, precoAcordo: 100, totalOs: 100, totalAcordo: 100, difTotal: 0,
  status: 'CONFORME', motivo: null, tinhaAcordo: 'SIM', menorPreco: 100, fornecedorAcordo: 'Oficina X', difMenor: 0, ...extra,
});

void test('analise: validacao do dia e curva ABC', () => {
  assert.throws(() => validarDia({ data: '2026-13-01', linhas: [] }));
  assert.throws(() => validarDia({ data: '2026-10-01', linhas: [{ status: '' }] }));
  assert.throws(() => validarDia({ data: '2026-10-01', linhas: [linha({ totalOs: 'cem' })] }));
  assert.equal(validarDia({ data: '2026-10-01', linhas: [linha({})] }).linhas[0].tinhaAcordo, true);
  const abc = curvaAbc([{ gasto: 70 }, { gasto: 15 }, { gasto: 10 }, { gasto: 5 }]);
  // Quem cruza a marca de 80% ainda é A; de 80% a 95%, B.
  assert.deepEqual(abc.map(l => l.classe), ['A', 'A', 'B', 'C']);
});

void test('analise: recebe dias pelo token, substitui a data e calcula os indicadores', async t => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-analise-fixture-'));
  const db = bancoSqliteLocal({ pastaPrivada: pasta, criar: true }), sql = new DatabaseSync(db.arquivo);
  const chave = Symbol.for('supply-vision:banco'), anterior = globalThis[chave], senha = env.INITIAL_ADMIN_PASSWORD, token = env.PORTAL_API_TOKEN;
  globalThis[chave] = db; env.INITIAL_ADMIN_PASSWORD = 'senha-ficticia-analise'; env.PORTAL_API_TOKEN = 'token-ficticio-analise-0123456789';
  t.after(() => { sql.close(); db.fechar(); globalThis[chave] = anterior; env.INITIAL_ADMIN_PASSWORD = senha; env.PORTAL_API_TOKEN = token; fs.rmSync(pasta, { recursive: true, force: true }); });
  await banco.ensureDatabase();
  const admin = (await db.prepare('SELECT id FROM users LIMIT 1').first()).id;
  sql.prepare('INSERT INTO users(id,name,email,password_salt,password_hash,role,active,created_at) VALUES(?,?,?,?,?,?,1,?)').run('viewer', 'Pessoa viewer', 'viewer@example.com', 's', 'h', 'viewer', banco.now());
  for (const user of [admin, 'viewer']) {
    await db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES(?,?,?,?)').bind(await banco.tokenHash(user), user, new Date(Date.now() + 3600000).toISOString(), banco.now()).run();
  }
  const enviar = async (corpo, credencial = env.PORTAL_API_TOKEN) => {
    const r = await rota.POST(new NextRequest('http://fixture/api/internal/compras', { method: 'POST', headers: { authorization: `Bearer ${credencial}`, 'content-type': 'application/json' }, body: JSON.stringify(corpo) }));
    return { status: r.status, data: await r.json() };
  };
  const consultar = async (user, query = '') => {
    const r = await rota.GET(new NextRequest(`http://fixture/api/analise${query}`, { headers: { cookie: `acordos_session=${user}`, 'x-portal-build': PORTAL_BUILD } }));
    return { status: r.status, data: await r.json() };
  };

  assert.equal((await enviar({ data: '2026-10-01', linhas: [] }, 'errado')).status, 401);
  assert.equal((await enviar({ data: 'ontem', linhas: [] })).status, 400);

  const dia1 = [
    linha({}),
    linha({ fornecedor: 'Oficina Y', status: 'ACIMA DO ACORDO', precoOs: 150, totalOs: 150, difTotal: 50, difMenor: 60, cidade: 'Cidade B' }),
    linha({ fornecedor: 'Oficina Z', status: 'SEM ACORDO', totalOs: 250, totalAcordo: null, difTotal: null, precoAcordo: null, motivo: 'Fornecedor', difMenor: 150 }),
    linha({ fornecedor: 'Oficina W', status: 'SEM ACORDO', totalOs: 500, tinhaAcordo: 'NAO', motivo: 'Item', item: 'Funilaria', menorPreco: null, difMenor: null }),
    linha({ status: 'ACORDO AMBÍGUO', totalOs: 9999 }),
  ];
  assert.equal((await enviar({ data: '2026-10-01', linhas: dia1 })).status, 200);
  // Reenvio do mesmo dia substitui, sem duplicar.
  assert.equal((await enviar({ data: '2026-10-01', linhas: dia1 })).status, 200);
  assert.equal((await enviar({ data: '2026-10-02', linhas: [linha({ totalOs: 0, qtd: 0 })] })).status, 200);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM compras_comparadas').get().n, 6);

  assert.equal((await consultar('viewer')).status, 403);
  const r = await consultar(admin, '?de=2026-10-01&ate=2026-10-31');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const i = r.data.indicadores;
  assert.equal(i.linhas, 5); // a linha ambigua (quarentena) fica de fora
  assert.equal(i.gasto, 1000);
  assert.equal(i.gastoComAcordo, 250);
  assert.equal(i.utilizacao, 0.25);
  assert.equal(i.conformidadeQtd, 2 / 3);
  assert.equal(i.pagoAcima, 50);
  assert.equal(i.gastoSemAcordo, 750);
  assert.equal(i.semAcordoComOpcao, 250);
  assert.equal(i.economiaPotencial, 210);
  assert.equal(i.gastoComMelhorAcordo, 790);
  assert.equal(r.data.acimaPorFornecedor[0].fornecedor, 'Oficina Y');
  assert.equal(r.data.semAcordoFornecedores[0].fornecedor, 'Oficina W');
  assert.deepEqual(r.data.mensal.map(m => m.mes), ['2026-10']);
  assert.ok(r.data.variacaoPreco.some(v => v.item === 'Troca de oleo' && v.cidades === 2));
  assert.deepEqual(r.data.opcoes.cidade, ['Cidade A', 'Cidade B']);

  const filtrado = await consultar(admin, '?de=2026-10-01&ate=2026-10-31&fornecedor=Oficina%20Y');
  assert.equal(filtrado.data.indicadores.gasto, 150);
  assert.equal((await consultar(admin, '?de=2026-10-31&ate=2026-10-01')).status, 400);
});
