import assert from 'node:assert/strict';
import test from 'node:test';
import net from 'node:net';
import { reservarPortaLoopback } from '../scripts/porta-teste.mjs';

void test('reserva de porta permanece ocupada ate liberacao explicita', async t => {
  const reserva = await reservarPortaLoopback();
  assert.equal(typeof reserva.liberar, 'function');
  t.after(() => reserva.liberar());
  const concorrente = net.createServer();
  const erro = await new Promise(resolve => concorrente.once('error', resolve).listen(reserva.porta, '127.0.0.1'));
  assert.equal(erro.code, 'EADDRINUSE');
});
