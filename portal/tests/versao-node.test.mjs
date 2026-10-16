import assert from 'node:assert/strict';
import test from 'node:test';
import { VERSAO_NODE, validarVersaoNode } from '../scripts/versao-node.mjs';

void test('instalacao e PREPARAR exigem major/minor da fonte, aceitando qualquer patch', () => {
  const [major, minor] = VERSAO_NODE.split('.').map(Number);
  for (const patch of [0, 1, 99]) validarVersaoNode({ versao: `${major}.${minor}.${patch}`, exata: true });
  for (const versao of [`${major - 1}.${minor}.0`, `${major + 1}.${minor}.0`, `${major}.${minor - 1}.99`, `${major}.${minor + 1}.0`, 'invalida']) {
    assert.throws(() => validarVersaoNode({ versao, exata: true }), /nao suportado/);
  }
});

void test('partida recusa major diferente ou minor anterior; avisa em diferenca aceita', () => {
  const [major, minor] = VERSAO_NODE.split('.').map(Number);
  const avisos = [];
  const avisar = texto => avisos.push(texto);
  validarVersaoNode({ versao: VERSAO_NODE, avisar });
  assert.equal(avisos.length, 0);
  for (const versao of [`${major}.${minor}.1`, `${major}.${minor + 1}.0`]) validarVersaoNode({ versao, avisar });
  assert.equal(avisos.length, 2);
  for (const versao of [`${major - 1}.99.0`, `${major + 1}.0.0`, `${major}.${minor - 1}.99`]) {
    assert.throws(() => validarVersaoNode({ versao, avisar }), /nao suportado/);
  }
});
