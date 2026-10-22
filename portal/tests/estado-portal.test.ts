import assert from 'node:assert/strict';
import test from 'node:test';
import { detectarEstadoPortal, ESTADO_INICIAL, proximoIntervalo } from '../lib/estado-portal.ts';
import { iniciarPollingDisponibilidade } from '../lib/polling-disponibilidade.ts';
import { setImmediate } from 'node:timers/promises';

void test('polling detecta indisponibilidade por rede/502/503 e primeira resposta boa recupera', () => {
  for (const falha of [{ falhaRede: true }, { status: 502 }, { status: 503 }]) {
    assert.deepEqual(detectarEstadoPortal(ESTADO_INICIAL, falha, 'a'), ESTADO_INICIAL);
    const fora = detectarEstadoPortal(ESTADO_INICIAL, { ...falha, polling: true }, 'a');
    assert.deepEqual(fora, { indisponivel: true, versaoNova: false });
    assert.equal(detectarEstadoPortal(fora, { status: 200 }, 'a').indisponivel, true);
    assert.equal(detectarEstadoPortal(fora, { polling: true, status: 401 }, 'a').indisponivel, true);
    assert.deepEqual(detectarEstadoPortal(fora, { polling: true, status: 200, build: 'a' }, 'a'), ESTADO_INICIAL);
  }
});
void test('qualquer resposta divergente e 409 de tela antiga exigem recarga permanente', () => {
  for (const sinal of [{ status: 200, build: 'b' }, { polling: true, status: 200, build: 'b' }, { status: 500, build: 'b' }, { status: 409, codigo: 'build_desatualizado' }]) {
    const novo = detectarEstadoPortal(ESTADO_INICIAL, sinal, 'a');
    assert.equal(novo.versaoNova, true);
    assert.equal(detectarEstadoPortal(novo, { polling: true, status: 200, build: 'a' }, 'a').versaoNova, true);
  }
  for (const sinal of [{status: 409}, {status: 409, codigo:'revisao_desatualizada'}, {status: 400, codigo:'build_desatualizado'}, {status: 200, build: 'a'}, {status: 200}]) {
    assert.equal(detectarEstadoPortal(ESTADO_INICIAL, sinal, 'a').versaoNova, false);
  }
});

void test('intervalo de disponibilidade respeita estado e visibilidade', () => {
  assert.equal(proximoIntervalo(ESTADO_INICIAL, false), 15000);
  assert.equal(proximoIntervalo(ESTADO_INICIAL, true), null);
  const indisponivel = {...ESTADO_INICIAL, indisponivel:true};
  assert.equal(proximoIntervalo(indisponivel, false), 5000);
  assert.equal(proximoIntervalo(indisponivel, true), 5000);
});

void test('polling usa 15s/5s, suspende aba oculta e consulta ao voltar a visibilidade', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const documento = Object.assign(new EventTarget(), {hidden:false});
  let estado = ESTADO_INICIAL, chamadas = 0, avisar = () => {};
  const parar = iniciarPollingDisponibilidade(async () => { chamadas++; }, documento, () => estado, ouvinte => {
    avisar = ouvinte; return () => { avisar = () => {}; };
  });
  t.after(parar);
  await setImmediate(); assert.equal(chamadas,1);
  t.mock.timers.tick(14999); assert.equal(chamadas,1);
  t.mock.timers.tick(1); await setImmediate(); assert.equal(chamadas,2);
  documento.hidden = true; documento.dispatchEvent(new Event('visibilitychange'));
  t.mock.timers.tick(30000); await setImmediate(); assert.equal(chamadas,2);
  estado = {...estado, indisponivel:true}; avisar();
  t.mock.timers.tick(4999); assert.equal(chamadas,2);
  t.mock.timers.tick(1); await setImmediate(); assert.equal(chamadas,3);
  t.mock.timers.tick(5000); await setImmediate(); assert.equal(chamadas,4);
  estado = ESTADO_INICIAL; avisar();
  t.mock.timers.tick(30000); await setImmediate(); assert.equal(chamadas,4);
  documento.hidden = false; documento.dispatchEvent(new Event('visibilitychange'));
  await setImmediate(); assert.equal(chamadas,5);
  parar(); documento.dispatchEvent(new Event('visibilitychange'));
  t.mock.timers.tick(30000); assert.equal(chamadas,5);
});

void test('voltar a visibilidade durante consulta lenta nao sobrepoe pedidos e parada cancela', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const documento = Object.assign(new EventTarget(), {hidden:false});
  let chamadas = 0, concluir = () => {}, signal: AbortSignal | undefined;
  const parar = iniciarPollingDisponibilidade(async s => {
    chamadas++; signal = s; await new Promise<void>(resolve => { concluir = resolve; });
  }, documento, () => ESTADO_INICIAL, () => () => {});
  t.after(parar);
  documento.hidden = true; documento.dispatchEvent(new Event('visibilitychange'));
  documento.hidden = false; documento.dispatchEvent(new Event('visibilitychange'));
  assert.equal(chamadas,1);
  concluir(); await setImmediate(); assert.equal(chamadas,2);
  parar(); assert.equal(signal?.aborted,true);
  concluir(); await setImmediate();
  t.mock.timers.tick(30000); assert.equal(chamadas,2);
});
