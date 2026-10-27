import assert from 'node:assert/strict';
import test from 'node:test';
import { api, ApiError } from '../lib/api.ts';
import { PORTAL_BUILD } from '../lib/portal-build.ts';
import { detectarEstadoPortal, obterEstadoPortal, ESTADO_INICIAL } from '../lib/estado-portal.ts';

void test('helper envia identificador em toda escrita preservando os demais cabecalhos', async t => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    t.mock.method(globalThis, 'fetch', async (_path: string, options?: RequestInit) => {
      const headers = new Headers(options?.headers);
      assert.equal(headers.get('x-portal-build'), PORTAL_BUILD);
      assert.equal(headers.get('content-type'), 'application/json');
      return new Response('{}', {headers:{'content-type':'application/json'}});
    });
    await api('/api/test', {method, headers:{'content-type':'application/json'}});
    t.mock.restoreAll();
  }
});

void test('falha de conexão em escrita não provoca reenvio e orienta conferir resultado', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', () => { calls++; return Promise.reject(new TypeError('Failed to fetch')); });
  await assert.rejects(api('/api/test', { method: 'POST' }), /Confira o resultado antes de repetir/);
  assert.equal(calls, 1);
});

void test('sobrecarga informa espera sem expor resposta HTML do servidor', async t => {
  t.mock.method(globalThis, 'fetch', () => Promise.resolve(new Response('<html>internal</html>', { status: 503, headers: { 'retry-after': '5' } })));
  await assert.rejects(api('/api/test'), /Tente novamente em 5 segundos/);
});
void test('consulta SOL preserva status 503 e revisao 409 para os estados da tela', async t => {
  for(const status of [400,409,503]) {
    t.mock.method(globalThis,'fetch',async()=>Response.json({error:'Mensagem fictícia da consulta'},{status}));
    await assert.rejects(api('/api/solicitacoes/cnpj/fixture'),e=>e instanceof ApiError&&e.details.status===status&&e.message==='Mensagem fictícia da consulta');
    t.mock.restoreAll();
  }
});

void test('cancelamento solicitado pelo chamador é preservado', async t => {
  const abort = new DOMException('cancelado', 'AbortError');
  const controller = new AbortController();
  controller.abort();
  t.mock.method(globalThis, 'fetch', () => Promise.reject(abort));
  await assert.rejects(api('/api/test', { signal: controller.signal }), error => error === abort);
});

for (const method of ['GET', 'POST']) {
  void test(`resposta interrompida em ${method} recebe orientação e não é reenviada`, async t => {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      calls++;
      return new Response(new ReadableStream({ start(c) { c.error(new TypeError('terminated')); } }),
        { headers: { 'content-type': 'application/json' } });
    });
    await assert.rejects(api('/api/test', { method }), error => error instanceof ApiError
      && error.message.includes(method === 'GET' ? 'Verifique sua conexão' : 'Confira o resultado antes de repetir'));
    assert.equal(calls, 1);
  });
}

void test('JSON truncado em escrita recebe orientação para conferir resultado', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{', { headers: { 'content-type': 'application/json' } }));
  await assert.rejects(api('/api/test', { method: 'PUT' }), /Confira o resultado antes de repetir/);
});

void test('cancelamento durante leitura do corpo é preservado', async t => {
  const controller = new AbortController();
  const abort = new DOMException('cancelado', 'AbortError');
  const response = new Response('{}', { headers: { 'content-type': 'application/json' } });
  t.mock.method(response, 'json', async () => { controller.abort(); throw abort; });
  t.mock.method(globalThis, 'fetch', async () => response);
  await assert.rejects(api('/api/test', { signal: controller.signal }), error => error === abort);
});

void test('401 sinaliza sessão vencida mesmo quando o corpo é inválido', async t => {
  const window = new EventTarget();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'window', original);
    else Reflect.deleteProperty(globalThis, 'window');
  });
  let expired = 0;
  window.addEventListener('portal:session-expired', () => expired++);
  t.mock.method(globalThis, 'fetch', async () => new Response('{', { status: 401, headers: { 'content-type': 'application/json' } }));
  await assert.rejects(api('/api/test'), ApiError);
  assert.equal(expired, 1);
});

void test('409 de importacao ou revisao continua erro normal sem exigir recarga', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {configurable:true, value:new EventTarget()});
  t.after(() => { if (original) Object.defineProperty(globalThis, 'window', original); else Reflect.deleteProperty(globalThis, 'window'); });
  for (const mensagem of [
    'A tela está desatualizada. Recarregue a página (Ctrl+F5) e confira a planilha novamente.',
    'A tela está desatualizada. Recarregue a página.',
    'Este acordo foi alterado ou a tela está desatualizada. Reabra o acordo antes de salvar.',
    'Esta condição foi alterada ou a tela está desatualizada. Reabra o acordo antes de salvar.',
    'Este chamado foi alterado ou a tela está desatualizada. Atualize o chamado antes de salvar novamente.',
  ]) {
    t.mock.method(globalThis, 'fetch', async () => Response.json({error:mensagem}, {status:409}));
    await assert.rejects(api('/api/test', {method:'POST'}), error => error instanceof ApiError && error.message === mensagem);
    assert.equal(obterEstadoPortal().versaoNova,false);
    t.mock.restoreAll();
  }
});

void test('409 com codigo de build sem cabecalho exige recarga e preserva sessao', async t => {
  const janela = new EventTarget();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {configurable:true, value:janela});
  t.after(() => { if (original) Object.defineProperty(globalThis, 'window', original); else Reflect.deleteProperty(globalThis, 'window'); });
  let expiradas = 0, chamadas = 0;
  janela.addEventListener('portal:session-expired', () => expiradas++);
  t.mock.method(globalThis, 'fetch', async () => {
    chamadas++;
    return Response.json({error:'Mensagem independente do protocolo.', codigo:'build_desatualizado'}, {status:409});
  });
  await assert.rejects(api('/api/test', {method:'POST'}), /Mensagem independente do protocolo/);
  await assert.rejects(api('/api/test', {method:'POST'}), /Recarregue para continuar/);
  assert.equal(chamadas,1);
  assert.equal(expiradas,0);
  t.mock.method(globalThis, 'fetch', async () => Response.json({error:'Sessão expirada.'}, {status:401, headers:{'x-portal-build':'outro-build'}}));
  await assert.rejects(api('/api/test'), ApiError);
  assert.equal(expiradas,0,'A recarga obrigatoria nao desmonta os formularios nem encerra a sessao');
});

void test('409 de cada codigo preserva a mensagem e so build pede recarga', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'window', original); else Reflect.deleteProperty(globalThis, 'window'); });
  for (const [codigo, mensagem] of [
    ['revisao', 'Registro alterado.'], ['situacao', 'Situação cadastral inválida.'],
    ['categoria_inativa', 'Categoria inativa.'], ['status_invalido', 'Status inválido.'],
    ['duplicado', 'Registro duplicado.'],
  ]) {
    const erro = new ApiError({ error: mensagem, codigo, status: 409 });
    assert.equal(erro.details.codigo, codigo);
    assert.equal(erro.message, mensagem);
    assert.equal(detectarEstadoPortal(ESTADO_INICIAL, { status: 409, codigo }, PORTAL_BUILD).versaoNova, false);
  }
  assert.equal(detectarEstadoPortal(ESTADO_INICIAL, { status: 409, codigo: 'build_desatualizado' }, PORTAL_BUILD).versaoNova, true);
});

void test('503 validacao preserva codigo e mensagem; 429 nao habilita modo manual', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Sistema em atualização, aguarde alguns instantes', codigo: 'validacao' }, { status: 503 }));
  await assert.rejects(api('/api/solicitacoes/cnpj/fixture'), error => error instanceof ApiError && error.details.codigo === 'validacao' && error.message === 'Sistema em atualização, aguarde alguns instantes');
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Limite de consultas.' }, { status: 429 }));
  await assert.rejects(api('/api/solicitacoes/cnpj/fixture'), error => error instanceof ApiError && error.details.status === 429 && !error.details.codigo);
});
