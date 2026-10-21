import assert from 'node:assert/strict';
import test from 'node:test';
import { portasOperacao } from '../scripts/portas-operacao.mjs';

void test('porta de relatorios exige inteiro entre 1024 e 65535', () => {
  for (const porta of ['1', '80', '1023', '65536', '1.5', 'x']) {
    assert.throws(() => portasOperacao({ RELATORIOS_PORTA: porta }), /porta/i);
  }
  for (const porta of [1024, 65535]) assert.equal(portasOperacao({ RELATORIOS_PORTA: porta }).relatorios, porta);
});
