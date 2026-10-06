import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { CABECALHO_ATUALIZACAO_AUTOMATICA, iniciarAtualizacaoPeriodica, registraAtividade } from '../lib/atualizacao-periodica.ts';
import { api } from '../lib/api.ts';

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

void test('consulta automática valida a sessão sem renovar a atividade', () => {
  const agora = Date.parse('2026-10-06T12:00:00Z');
  const automatica = new Request('http://portal/api/reports', { headers: CABECALHO_ATUALIZACAO_AUTOMATICA });
  const manual = new Request('http://portal/api/reports');
  assert.equal(registraAtividade(automatica, agora - 10 * 60000, agora), false);
  assert.equal(registraAtividade(automatica, 0, agora), false);
  assert.equal(registraAtividade(manual, agora - 10 * 60000, agora), true);
  // Continua gravando no máximo uma vez por minuto.
  assert.equal(registraAtividade(manual, agora - 30000, agora), false);
  assert.equal(registraAtividade(manual, 0, agora), true);
});

void test('cliente envia o cabeçalho de consulta automática só quando pedido', async t => {
  const recebidos: (string | null)[] = [];
  t.mock.method(globalThis, 'fetch', async (_path: string, init?: RequestInit) => {
    recebidos.push(new Headers(init?.headers).get('x-portal-poll'));
    return new Response('{}', { headers: { 'content-type': 'application/json' } });
  });
  await api('/api/reports', { headers: CABECALHO_ATUALIZACAO_AUTOMATICA });
  await api('/api/reports');
  assert.deepEqual(recebidos, ['1', null]);
});
