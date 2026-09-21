import assert from 'node:assert/strict';
import test from 'node:test';
import { api } from '../lib/api.ts';

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
