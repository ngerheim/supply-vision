import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { consultarDisponibilidade, iniciarPollingDisponibilidade } from '../lib/polling-disponibilidade.ts';
import { assinarCentral, definirUsuarioCentral, obterCentral } from '../lib/central-estado.ts';
import { obterEstadoPortal, sinalizarPortal } from '../lib/estado-portal.ts';
import { PORTAL_BUILD } from '../lib/portal-build.ts';

void test('consulta unica troca health por contagem; recupera disponibilidade e 401 retorna ao login sem laco', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const original = Object.getOwnPropertyDescriptor(globalThis,'window');
  const janela = new EventTarget();
  Object.defineProperty(globalThis,'window',{configurable:true,value:janela});
  t.after(() => { definirUsuarioCentral(null); if (original) Object.defineProperty(globalThis,'window',original); else Reflect.deleteProperty(globalThis,'window'); });
  const chamadas: string[] = [];
  let expirar = false, expiracoes = 0;
  t.mock.method(globalThis,'fetch',async (path: string, opcoes?: RequestInit) => {
    chamadas.push(path);
    assert.equal(new Headers(opcoes?.headers).get('x-portal-poll'),'1');
    assert.equal(opcoes?.method,undefined);
    return Response.json(path === '/api/health' ? {status:'ok'} : expirar ? {error:'Sessao expirada'} : {naoLidas:103}, {
      status:expirar && path !== '/api/health' ? 401 : 200, headers:{'x-portal-build':PORTAL_BUILD},
    });
  });
  const documento = Object.assign(new EventTarget(),{hidden:false});
  let parar = () => {};
  let usuarioAtual: string | null = null;
  const iniciar = () => { parar(); usuarioAtual = obterCentral().usuario; const usuario = usuarioAtual; parar = iniciarPollingDisponibilidade(signal => consultarDisponibilidade(usuario,signal),documento); };
  const desassinar = assinarCentral(() => { if (obterCentral().usuario !== usuarioAtual) iniciar(); });
  janela.addEventListener('portal:session-expired',() => { expiracoes++; definirUsuarioCentral(null); });
  t.after(() => { parar(); desassinar(); });
  iniciar(); await setImmediate();
  assert.equal(chamadas.at(-1),'/api/health');
  definirUsuarioCentral('a'); await setImmediate();
  assert.equal(chamadas.at(-1),'/api/central/nao-lidas');
  assert.equal(obterCentral().naoLidas,103);
  sinalizarPortal({polling:true,status:503});
  assert.equal(obterEstadoPortal().indisponivel,true);
  t.mock.timers.tick(5000); await setImmediate();
  assert.equal(obterEstadoPortal().indisponivel,false);
  expirar = true;
  t.mock.timers.tick(15000); await setImmediate();
  assert.equal(expiracoes,1); assert.equal(obterCentral().usuario,null);
  t.mock.timers.tick(15000); await setImmediate();
  assert.equal(chamadas.at(-1),'/api/health'); assert.equal(expiracoes,1);
  definirUsuarioCentral('b');
  assert.equal(obterCentral().naoLidas,0);
});
