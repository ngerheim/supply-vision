import assert from 'node:assert/strict';
import test from 'node:test';
import { correspondeBusca } from '../lib/busca.ts';

void test('busca tolera acentos, caixa, espacos e Unicode decomposto', () => {
  assert(correspondeBusca('PEÇA / SERVIÇO', '  peca  / servico '));
  assert(correspondeBusca('Sa\u0303o Paulo', 'SÃO PAULO'));
  assert(!correspondeBusca('Freio dianteiro', 'traseiro'));
});

void test('lista flutuante: a ancora converte a medida de tela para pixels CSS do html com zoom', async () => {
  const { ancoraComZoom } = await import('../lib/utils.ts');
  const anteriores = { document: globalThis.document, getComputedStyle: globalThis.getComputedStyle };
  const campo = { getBoundingClientRect: () => ({ x: 400, y: 448, width: 480, height: 32 }) };
  Object.assign(globalThis, { document: { documentElement: {} }, getComputedStyle: () => ({ zoom: '0.8' }) });
  try {
    const r = ancoraComZoom({ current: campo as unknown as Element }).getBoundingClientRect();
    assert.deepEqual([r.x, r.y, r.width, r.height, r.right, r.bottom], [500, 560, 600, 40, 1100, 600]);
  } finally { Object.assign(globalThis, anteriores); }
});
