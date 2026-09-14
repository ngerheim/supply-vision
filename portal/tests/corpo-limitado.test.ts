import assert from 'node:assert/strict';
import test from 'node:test';

import { corpoBinarioLimitado, corpoLimitado } from '../lib/corpo-limitado.ts';

function requisicaoEmFluxo(pedacos: Array<string | Uint8Array>, contentLength?: string) {
  const codificador = new TextEncoder();
  let indice = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (indice >= pedacos.length) { controller.close(); return; }
      const pedaco = pedacos[indice++];
      controller.enqueue(typeof pedaco === 'string' ? codificador.encode(pedaco) : pedaco);
    },
  });
  const headers = new Headers();
  if (contentLength !== undefined) headers.set('content-length', contentLength);
  const request = new Request('http://portal.local/teste', {
    method: 'POST', headers, body: stream, duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  return { request };
}

void test('aceita corpo no limite exato', async () => {
  const { request } = requisicaoEmFluxo(['1234', '5678'], '8');
  assert.equal(await corpoLimitado(request, 8), '12345678');
});

void test('recusa quando Content-Length declarado passa do teto', async () => {
  const { request } = requisicaoEmFluxo(['x'], '999');
  assert.equal(await corpoBinarioLimitado(request, 8), null);
});

void test('Content-Length menor nao burla a contagem dos bytes reais', async () => {
  const { request } = requisicaoEmFluxo(['1234', '56789', 'descartado'], '1');
  assert.equal(await corpoBinarioLimitado(request, 8), null);
});

void test('corpo sem Content-Length continua limitado pelo fluxo', async () => {
  const { request } = requisicaoEmFluxo(['1234', '56789']);
  assert.equal(await corpoLimitado(request, 8), null);
});

void test('Content-Length invalido nao substitui a contagem real', async () => {
  const { request } = requisicaoEmFluxo(['1234'], 'nao-e-numero');
  assert.equal(await corpoLimitado(request, 8), '1234');
});

void test('preserva caracteres UTF-8 partidos entre pedacos', async () => {
  const cedilha = new TextEncoder().encode('ç');
  const { request } = requisicaoEmFluxo([cedilha.slice(0, 1), cedilha.slice(1)], '2');
  assert.equal(await corpoLimitado(request, 2), 'ç');
});
