import assert from 'node:assert/strict';
import test from 'node:test';
import { api, ApiError } from '../lib/api.ts';

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
