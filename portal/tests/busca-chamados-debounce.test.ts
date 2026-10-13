import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { criarConsultaDebounced } from '../lib/atualizacao-periodica.ts';
import { api } from '../lib/api.ts';

void test('digitacao rapida faz uma requisicao apos 300 ms e preserva o texto acentuado', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pedidos: string[] = [], recebidos: unknown[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    pedidos.push(url);
    return Response.json({ tickets: ['resultado'] });
  });
  const consulta = criarConsultaDebounced(recebidos.push.bind(recebidos), () => assert.fail('Sem erro esperado'));
  t.after(consulta.cancelar);
  for (const q of ['Á', 'ÁG', 'ÁGUA São Paulo']) {
    consulta.executar(signal => api(`/api/tickets?q=${encodeURIComponent(q)}`, { signal }));
    t.mock.timers.tick(100);
  }
  assert.equal(pedidos.length, 0);
  t.mock.timers.tick(199); assert.equal(pedidos.length, 0);
  t.mock.timers.tick(1); await setImmediate();
  assert.equal(pedidos.length, 1);
  assert.equal(new URL(pedidos[0], 'http://portal').searchParams.get('q'), 'ÁGUA São Paulo');
  assert.deepEqual(recebidos, [{ tickets: ['resultado'] }]);
});

void test('aborta pedido anterior; resposta ou erro antigos nao substituem a consulta nova', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const recebidos: string[] = [], erros: unknown[] = [], sinais: AbortSignal[] = [];
  let antiga!: (valor: string) => void, falhaAntiga!: (erro: Error) => void;
  const consulta = criarConsultaDebounced<string>(valor => recebidos.push(valor), erro => erros.push(erro));
  t.after(consulta.cancelar);
  consulta.executar(signal => { sinais.push(signal); return new Promise(resolve => { antiga = resolve; }); }, 0);
  t.mock.timers.tick(0);
  consulta.executar(async () => 'nova', 0);
  assert.equal(sinais[0].aborted, true);
  t.mock.timers.tick(0); await setImmediate();
  antiga('antiga'); await setImmediate();
  assert.deepEqual(recebidos, ['nova']);
  consulta.executar(() => new Promise((_, reject) => { falhaAntiga = reject; }), 0);
  t.mock.timers.tick(0);
  consulta.executar(async () => 'mais nova', 0);
  t.mock.timers.tick(0); await setImmediate();
  falhaAntiga(new Error('falha antiga')); await setImmediate();
  assert.deepEqual(recebidos, ['nova', 'mais nova']);
  assert.deepEqual(erros, []);
});

void test('desmontagem cancela timer e pedido; falha vigente continua visivel', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let pedidos = 0;
  const erros: unknown[] = [];
  const consulta = criarConsultaDebounced(() => assert.fail('Nao recebe'), erro => erros.push(erro));
  t.after(consulta.cancelar);
  consulta.executar(async () => { pedidos++; });
  consulta.cancelar(); t.mock.timers.tick(300); assert.equal(pedidos, 0);
  consulta.executar(async () => { throw new Error('atual'); }, 0);
  t.mock.timers.tick(0); await setImmediate(); assert.equal(erros.length, 1);
  let sinal!: AbortSignal;
  consulta.executar(signal => { sinal = signal; return new Promise(() => {}); }, 0);
  t.mock.timers.tick(0); consulta.cancelar(); assert.equal(sinal.aborted, true);
});

void test('recarga manual so conclui depois da resposta; cancelamento libera quem aguarda', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let responder!: () => void, concluiu = false;
  const consulta = criarConsultaDebounced(() => {}, () => assert.fail('Sem erro esperado'));
  t.after(consulta.cancelar);
  const resposta = consulta.executar(() => new Promise<void>(resolve => { responder = resolve; }), 0).then(() => { concluiu = true; });
  t.mock.timers.tick(0); await setImmediate(); assert.equal(concluiu, false);
  responder(); await resposta; assert.equal(concluiu, true);
  const cancelada = consulta.executar(() => new Promise(() => {}));
  consulta.cancelar(); await cancelada;
});
