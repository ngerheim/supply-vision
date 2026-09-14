import assert from 'node:assert/strict';
import test from 'node:test';
import { correspondeBusca } from '../lib/busca.ts';

void test('busca tolera acentos, caixa, espacos e Unicode decomposto', () => {
  assert(correspondeBusca('PEÇA / SERVIÇO', '  peca  / servico '));
  assert(correspondeBusca('Sa\u0303o Paulo', 'SÃO PAULO'));
  assert(!correspondeBusca('Freio dianteiro', 'traseiro'));
});
