import assert from 'node:assert/strict';
import test from 'node:test';
import { dataBrasileiraParaIso, exibirDataBrasileira, mascararDataBrasileira } from '../lib/data-brasileira.ts';
void test('datas brasileiras não trocam dia e mês', () => {
  assert.equal(dataBrasileiraParaIso('06/10/2026'), '2026-10-06');
  assert.equal(exibirDataBrasileira('2026-10-06'), '06/10/2026');
  assert.equal(mascararDataBrasileira('06102026'), '06/10/2026');
  assert.equal(dataBrasileiraParaIso('29/02/2024'), '2024-02-29');
  for (const data of ['10/31/2026', '31/02/2026', '29/02/2026', '6/10/2026', '2026-10-06'])
    assert.throws(() => dataBrasileiraParaIso(data));
});
