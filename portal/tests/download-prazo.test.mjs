import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { env } from '../scripts/configuracao-servidor.mjs';

const hook = registerHooks({ resolve(specifier, context, next) {
  if (specifier === './database' || specifier === '@/lib/domain') return next(new URL(specifier === './database' ? '../lib/database.ts' : '../lib/domain.ts', import.meta.url).href, context);
  return next(specifier, context);
} });
const { consultarRelatorios } = await import('../lib/relatorios-api.ts');
hook.deregister();

void test('prazo de download inclui corpo parado depois dos cabecalhos', async t => {
  const chave = Symbol.for('supply-vision:banco'), antes = globalThis[chave], token = env.PORTAL_API_TOKEN;
  globalThis[chave] = { prepare() { return { bind() { return this; }, async first() { return { action: 'relatorio', artifactsJson: '[{"name":"fixture.xlsx"}]' }; } }; } };
  env.PORTAL_API_TOKEN = 'fixture';
  t.after(() => { globalThis[chave] = antes; env.PORTAL_API_TOKEN = token; });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let cancelado = false;
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => new Response(new ReadableStream({ start(c) {
    signal.addEventListener('abort', () => { cancelado = true; c.error(signal.reason); });
  } })));
  const pendente = consultarRelatorios('job', 'fixture.xlsx');
  await new Promise(setImmediate);
  t.mock.timers.tick(30_001);
  const resposta = await pendente;
  assert.equal(resposta.status, 503);
  assert.match((await resposta.json()).error, /tempo|prazo/i);
  assert.equal(cancelado, true);
});
