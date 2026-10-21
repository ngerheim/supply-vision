import assert from 'node:assert/strict';
import test from 'node:test';
import { ferramenta7z } from './apoio/backup.mjs';

void test('integracao Windows explicita falha se 7zip estiver indisponivel', t => {
  const flag = process.env.SV_TESTES_INTEGRACAO_WINDOWS, exe = process.env.SV_TEST_7ZIP;
  t.after(() => {
    for (const [nome, valor] of [['SV_TESTES_INTEGRACAO_WINDOWS', flag], ['SV_TEST_7ZIP', exe]]) {
      if (valor === undefined) delete process.env[nome]; else process.env[nome] = valor;
    }
  });
  process.env.SV_TESTES_INTEGRACAO_WINDOWS = '1';
  process.env.SV_TEST_7ZIP = '7zip-fixture-inexistente';
  let pulou = false;
  assert.throws(() => ferramenta7z({ skip() { pulou = true; } }), /7-Zip ausente/);
  assert.equal(pulou, false);
  delete process.env.SV_TESTES_INTEGRACAO_WINDOWS;
  assert.equal(ferramenta7z({ skip() { pulou = true; } }), null);
  assert.equal(pulou, true);
});
