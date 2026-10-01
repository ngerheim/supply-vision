import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flag } from '../lib/flags.ts';

void test('edição preserva flags numéricas recebidas do banco', () => {
  assert.equal(flag(0, 1), 0);
  assert.equal(flag(1, 0), 1);
  assert.equal(flag(false, 1), 0);
  assert.equal(flag(true, 0), 1);
});
void test('campos omitidos preservam o valor anterior e valores ambíguos são recusados', () => {
  assert.equal(flag(undefined, 0), 0);
  assert.equal(flag(undefined, 1), 1);
  for (const value of [null, 'false', '0', 2, {}])
    assert.throws(() => flag(value, 1));
});
