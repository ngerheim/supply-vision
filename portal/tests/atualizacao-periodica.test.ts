import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { iniciarAtualizacaoPeriodica } from '../lib/atualizacao-periodica.ts';

void test('consulta lenta não sobrepõe pedidos e a parada cancela o pedido ativo', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let chamadas = 0, concluir: (() => void) | undefined, signal: AbortSignal | undefined;
  const parar = iniciarAtualizacaoPeriodica(async s => {
    chamadas++; signal = s;
    await new Promise<void>(resolve => { concluir = resolve; });
  }, () => assert.fail('Sem falha esperada'));
  t.after(parar);
  t.mock.timers.tick(30000);
  assert.equal(chamadas, 1);
  concluir!(); await setImmediate();
  t.mock.timers.tick(4999); assert.equal(chamadas, 1);
  t.mock.timers.tick(1); assert.equal(chamadas, 2);
  parar(); assert.equal(signal!.aborted, true);
  concluir!(); await setImmediate();
  t.mock.timers.tick(30000); assert.equal(chamadas, 2);
});

void test('falha temporária permite a próxima atualização e cancelamento não exibe erro', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let chamadas = 0, erros = 0;
  const parar = iniciarAtualizacaoPeriodica(async signal => {
    chamadas++;
    if (chamadas === 1) throw new Error('Conexão interrompida');
    await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new Error('Cancelado')), { once: true }));
  }, () => erros++);
  t.after(parar);
  await setImmediate(); assert.equal(erros, 1);
  t.mock.timers.tick(5000); assert.equal(chamadas, 2);
  parar(); await setImmediate(); assert.equal(erros, 1);
});

void test('aba oculta não consulta e atualização retorna quando fica visível', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let visivel = false, chamadas = 0;
  const parar = iniciarAtualizacaoPeriodica(async () => { chamadas++; }, () => assert.fail('Sem falha esperada'), () => visivel);
  t.after(parar);
  assert.equal(chamadas, 0);
  visivel = true; t.mock.timers.tick(5000);
  assert.equal(chamadas, 1);
  await setImmediate(); parar(); t.mock.timers.tick(5000);
  assert.equal(chamadas, 1);
});
