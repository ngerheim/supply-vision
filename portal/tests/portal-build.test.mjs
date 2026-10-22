import assert from 'node:assert/strict';
import test from 'node:test';
import { identificarBuild } from '../scripts/identificador-build.mjs';

void test('identificador usa versao e SHA injetavel, sem relogio ou Git em runtime', () => {
  assert.equal(identificarBuild('2.9.0', {commit:'278380d', raiz:'inexistente'}), '2.9.0+278380d');
  assert.equal(identificarBuild('2.9.0', {commit:'278380d'}), '2.9.0+278380d');
  assert.throws(() => identificarBuild('2.9.0', {commit:'invalido'}), /invalido/);
});
