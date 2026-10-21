import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { NextRequest, NextResponse } from 'vinext/shims/server';
import { catalogosApi } from '../lib/catalogos-api.ts';
import { mapeamentosApi } from '../lib/mapeamentos-api.ts';
import { acordosApi } from '../lib/acordos-api.ts';
import { filtrosNotificacoes } from '../lib/notificacoes-api.ts';
import { EntradaInvalida, LIMITES_CAMPO } from '../lib/limites-entrada.ts';
import { VALIDACAO_ATIVA_SQL } from '../lib/operacao-validacao.ts';
import { normalizeText, normalizeCnpj } from '../lib/domain.ts';

// So a fronteira de persistencia e substituida. Roteador, handlers, validadores
// e respostas HTTP sao os de producao, sem servidor ou arquivos privados.
const estado = { user: null, consultas: [], travas: 0, db: null };
const chave = Symbol.for('sv-lote07:api-teste');
globalThis[chave] = estado;
const bancoUrl = `data:text/javascript,${encodeURIComponent(`
  const estado = globalThis[Symbol.for('sv-lote07:api-teste')];
  export const parseCookies = () => ({});
  export const currentUser = async () => estado.user;
  export const ensureDatabase = async () => {};
  export const id = () => crypto.randomUUID();
  export const now = () => '2026-10-20T12:00:00.000Z';
  export const audit = async (...dados) => { estado.auditoria = dados; };
  export const adquirirTrava = async () => { estado.travas++; return true; };
  export const liberarTrava = async () => {};
  export const rawDb = () => estado.db ?? { prepare(sql) {
    estado.consultas.push(sql);
    assertValidacao(sql);
    return { bind() { return this; }, async first() { return null; } };
  } };
  function assertValidacao(sql) {
    if (sql !== ${JSON.stringify(VALIDACAO_ATIVA_SQL)}) throw new Error('Acesso indevido ao banco: ' + sql);
  }
`)}`;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'next/server') return nextResolve('vinext/shims/server', context);
    if (specifier.endsWith('/configuracao-servidor.mjs')) return { url: 'data:text/javascript,export const env = { PORTAL_API_TOKEN: "token-ficticio-api" };', shortCircuit: true };
    if (specifier === '@/lib/database' || /\/database(?:\.ts)?$/.test(specifier)) return { url: bancoUrl, shortCircuit: true };
    if (specifier.startsWith('@/')) return { url: new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const rota = await import('../app/api/[...path]/route.ts');
const { cancelarRelatorio } = await import('../lib/relatorios-api.ts');
hooks.deregister();
test.after(() => { delete globalThis[chave]; });

const usuario = role => ({ id: 'pessoa', name: 'Pessoa Ficticia', email: 'pessoa@example.com', role });
const contexto = extra => ({
  ok: (body, init) => NextResponse.json(body, init),
  fail: (error, status = 400) => NextResponse.json({ error }, { status }),
  jsonBody: request => request.json(),
  first: async () => { assert.fail('Entrada invalida chegou ao banco'); },
  rawDb: () => { assert.fail('Entrada invalida chegou ao banco'); },
  id: () => 'ficticio', now: () => '2026-10-20T12:00:00Z',
  normalizeText, normalizeCnpj,
  ...extra,
});
const pedido = (method, path, origin) => new NextRequest(`http://portal.test/api/${path}`, {
  method, headers: { host: 'portal.test', ...(origin ? { origin } : {}) },
  ...(['POST', 'PUT'].includes(method) ? { body: '{}' } : {}),
});
const leiturasProtegidas = [
  'bootstrap', 'search', 'search/options', 'agreements/outro', 'imports', 'imports/outro',
  'mappings', 'audit', 'audit/export', 'users', 'tickets', 'tickets/outro',
  'email-notifications', 'reports', 'reports/outro', 'reports/outro/arquivo.xlsx',
  'export', 'export/agreements',
];
const escritasProtegidas = [
  ['POST', 'agreements'], ['POST', 'agreements/outro/items'], ['POST', 'catalogs/items'],
  ['POST', 'users'], ['POST', 'tickets'], ['POST', 'tickets/outro/events'],
  ['POST', 'imports/agreement/outro'], ['POST', 'reports'], ['POST', 'mappings/items'],
  ['POST', 'email-notifications/outro/retry'], ['POST', 'daily-report-deliveries/outro/retry'],
  ['PUT', 'agreements/outro'], ['PUT', 'items/outro'], ['PUT', 'catalogs/items/outro'],
  ['PUT', 'users/outro'], ['PUT', 'tickets/outro'], ['PUT', 'mappings/items/outro'],
  ['DELETE', 'items/outro'], ['DELETE', 'agreements/outro'], ['DELETE', 'catalogs/items/outro'],
  ['DELETE', 'reports/outro'], ['DELETE', 'mappings/items/outro'],
];

void test('rotas protegidas recusam sessao ausente antes de consultar dados ou reservar trava', async () => {
  estado.user = null;
  estado.consultas = []; estado.travas = 0;
  for (const [method, path] of [...leiturasProtegidas.map(path => ['GET', path]), ...escritasProtegidas]) {
    const response = await rota[method](pedido(method, path));
    assert.equal(response.status, 401, `${method} ${path}`);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  }
  assert.deepEqual(estado.consultas, []);
  assert.equal(estado.travas, 0);
});

void test('viewer nao consulta areas de escrita nem altera registros de outro usuario', async () => {
  estado.user = usuario('viewer');
  estado.consultas = []; estado.travas = 0;
  const leituras = leiturasProtegidas.filter(path => !['bootstrap', 'search', 'search/options', 'agreements/outro'].includes(path));
  for (const [method, path] of [...leituras.map(path => ['GET', path]), ...escritasProtegidas]) {
    assert.equal((await rota[method](pedido(method, path))).status, 403, `${method} ${path}`);
  }
  assert.ok(estado.consultas.every(sql => sql === VALIDACAO_ATIVA_SQL));
  assert.equal(estado.travas, 0);
});

void test('editor nao acessa administracao, downloads restritos ou exclusao de acordo', async () => {
  estado.user = usuario('editor');
  estado.consultas = []; estado.travas = 0;
  const rotas = [
    ...['audit', 'audit/export', 'email-notifications', 'reports', 'reports/outro', 'reports/outro/arquivo.xlsx', 'export'].map(path => ['GET', path]),
    ['POST', 'users'], ['PUT', 'users/outro'], ['POST', 'reports'], ['DELETE', 'reports/outro'],
    ['POST', 'email-notifications/outro/retry'], ['POST', 'daily-report-deliveries/outro/retry'],
    ['DELETE', 'agreements/outro'],
  ];
  for (const [method, path] of rotas) assert.equal((await rota[method](pedido(method, path))).status, 403, `${method} ${path}`);
  assert.ok(estado.consultas.every(sql => sql === VALIDACAO_ATIVA_SQL));
  assert.equal(estado.travas, 0, 'Recusa administrativa precisa preceder a reserva do acordo');
});

void test('origem externa ou invalida e recusada antes de acessar dados', async () => {
  estado.user = usuario('admin');
  estado.consultas = []; estado.travas = 0;
  for (const origin of ['http://externo.test', 'null', 'origem-invalida']) {
    for (const method of ['POST', 'PUT', 'DELETE']) assert.equal((await rota[method](pedido(method, 'agreements/outro', origin))).status, 403);
  }
  assert.deepEqual(estado.consultas, []);
  assert.equal(estado.travas, 0);
});

void test('perfis autorizados continuam consultando e exportando pelas rotas de producao', async () => {
  const prepare = (sql, values = []) => ({
    sql, values, bind(...values) { return prepare(sql, values); },
    async first() { return { n: 0, total: 0 }; }, async all() { return { results: [] }; },
  });
  estado.db = { prepare, async batch(queries) { return Promise.all(queries.map(query => query.all())); } };
  try {
    for (const [role, paths] of [
      ['viewer', ['bootstrap', 'search', 'search/options']],
      ['editor', ['bootstrap', 'imports', 'mappings', 'users', 'tickets', 'export/agreements']],
      ['admin', ['audit', 'audit/export', 'email-notifications', 'reports', 'export']],
    ]) {
      estado.user = usuario(role);
      for (const path of paths) assert.equal((await rota.GET(pedido('GET', path))).status, 200, `${String(role)}: ${String(path)}`);
    }
    assert.equal(estado.auditoria.at(-1), 'Exportação de dados gerada para download');
    estado.user = null;
    for (const authorization of ['', 'Bearer errado', 'token-ficticio-api-invalido']) {
      const request = pedido('GET', 'internal/agreements');
      request.headers.set('authorization', authorization);
      assert.equal((await rota.GET(request)).status, 401);
    }
    const request = pedido('GET', 'internal/agreements');
    request.headers.set('authorization', 'Bearer token-ficticio-api');
    assert.equal((await rota.GET(request)).status, 200);
  } finally { estado.db = null; }
});

void test('cadastros e De/Para recusam chaves herdadas antes de consultar ou escrever', async () => {
  const catalogos = catalogosApi(contexto());
  const mappings = mapeamentosApi(contexto());
  for (const type of ['constructor', 'toString', '__proto__', 'inexistente']) {
    const request = () => new Request('http://portal.test', { method: 'POST', body: '{"city":"CIDADE FICTICIA","state":"SP","source":"FICTICIO","targetId":"outro"}' });
    for (const api of [catalogos, mappings]) {
      const prefix = api === catalogos ? 'Catalog' : 'Mapping';
      assert.equal((await api[`create${prefix}`](request(), usuario('editor'), type)).status, 400, type);
      assert.equal((await api[`update${prefix}`](request(), usuario('editor'), type, 'outro')).status, 400, type);
      assert.equal((await api[`delete${prefix}`](usuario('editor'), type, 'outro', 0)).status, 400, type);
    }
  }
});

void test('ordenacao de acordo usa somente colunas proprias da lista fechada', async () => {
  const consultas = [];
  const api = acordosApi(contexto({ rawDb: () => ({
    prepare(sql) { consultas.push(sql); return { bind() { return this; } }; },
    async batch() { return [{ results: [{ id: 'outro', totalItems: 0 }] }, ...Array.from({ length: 3 }, () => ({ results: [] }))]; },
  }) }));
  for (const sort of ['constructor', 'toString', '__proto__', 'inexistente', 'price']) {
    consultas.length = 0;
    const response = await api.agreementDetail('outro', usuario('viewer'), new URLSearchParams({ sort, direction: 'desc' }));
    assert.equal(response.status, 200);
    assert.ok(consultas.some(sql => sql.includes(`ORDER BY ${sort === 'price' ? 'ai.price' : 'ci.name'} DESC,ai.id ASC`)), sort);
  }
});

void test('busca de notificacoes recusa excesso antes de executar SQL e preserva o limite', () => {
  for (const q of ['A'.repeat(LIMITES_CAMPO.busca + 1), 'A' + ' '.repeat(LIMITES_CAMPO.busca)]) {
    assert.throws(() => filtrosNotificacoes(new URLSearchParams({ q })), EntradaInvalida);
  }
  assert.ok(filtrosNotificacoes(new URLSearchParams({ q: 'A'.repeat(LIMITES_CAMPO.busca) })).values.length > 0);
});

void test('cancelamentos no mesmo instante auditam somente a transicao efetiva', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE report_jobs(id TEXT,status TEXT,completed_at TEXT);
    CREATE TABLE audit_logs(id TEXT,user_id TEXT,action TEXT,entity TEXT,entity_id TEXT,details TEXT,created_at TEXT);
    INSERT INTO report_jobs VALUES('outro','queued',NULL)`);
  estado.db = {
    prepare: (sql, values = []) => ({ sql, values, bind(...values) { return estado.db.prepare(sql, values); } }),
    async batch(queries) {
      db.exec('BEGIN');
      try { const results = queries.map(({ sql, values }) => ({ meta: db.prepare(sql).run(...values) })); db.exec('COMMIT'); return results; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
  try {
    assert.equal((await cancelarRelatorio('outro', 'pessoa')).status, 200);
    assert.equal((await cancelarRelatorio('outro', 'pessoa')).status, 409);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n, 1);
    db.exec(`INSERT INTO report_jobs VALUES('reverter','review',NULL);
      CREATE TRIGGER falhar BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'falha ficticia'); END`);
    await assert.rejects(cancelarRelatorio('reverter', 'pessoa'), /falha ficticia/);
    assert.equal(db.prepare("SELECT status FROM report_jobs WHERE id='reverter'").get().status, 'review');
  } finally { estado.db = null; db.close(); }
});
