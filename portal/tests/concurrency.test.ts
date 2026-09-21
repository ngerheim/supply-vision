import assert from 'node:assert/strict';
import test from 'node:test';
import { ConcurrencyGate } from '../lib/concurrency.ts';

void test('limita execução e fila; devolve capacidade sem liberação dupla', async () => {
  const gate = new ConcurrencyGate(2, 1);
  const first = await gate.acquire();
  const second = await gate.acquire();
  assert.ok(first && second);
  let entered = false;
  const queued = gate.acquire().then(release => { entered = true; return release; });
  assert.equal(await gate.acquire(), null);
  assert.equal(entered, false);
  first(); first();
  const third = await queued;
  assert.ok(third);
  const waiting = gate.acquire();
  assert.equal(await gate.acquire(), null);
  second();
  const fourth = await waiting;
  assert.ok(fourth);
  third(); fourth();
  const recovered = await gate.acquire();
  assert.ok(recovered);
  recovered();
});

void test('recusa configuração inválida', () => {
  assert.throws(() => new ConcurrencyGate(0, 1));
  assert.throws(() => new ConcurrencyGate(1, -1));
});
