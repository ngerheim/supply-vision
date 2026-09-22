import assert from 'node:assert/strict';
import test from 'node:test';

import { VARIAVEIS_DO_WORKER, montarArgumentos, montarVars } from '../scripts/iniciar-portal.mjs';

test('entrega ao Worker as variaveis que ele le de env', () => {
  const args = montarVars({ INITIAL_ADMIN_PASSWORD: 'senha-bem-grande', TRUSTED_PROXY: 'true' });
  assert.deepEqual(args, [
    '--var', 'INITIAL_ADMIN_PASSWORD:senha-bem-grande',
    '--var', 'TRUSTED_PROXY:true',
  ]);
});

test('ignora variavel ausente ou vazia', () => {
  assert.deepEqual(montarVars({}), []);
  assert.deepEqual(montarVars({ TRUSTED_PROXY: '   ' }), []);
  assert.deepEqual(montarVars({ TRUSTED_PROXY: 'true' }), ['--var', 'TRUSTED_PROXY:true']);
});

test('nao repassa segredo que o Worker nao usa', () => {
  const args = montarVars({ SMTP_PASSWORD: 'nao-deve-vazar', PORTAL_API_TOKEN: 'nem-este' });
  assert.deepEqual(args, []);
  assert.ok(!VARIAVEIS_DO_WORKER.includes('SMTP_PASSWORD'));
});

test('mantem o banco persistido na area privada em todos os modos', () => {
  for (const modo of ['', 'local', 'lan']) {
    const args = montarArgumentos(modo, {});
    assert.equal(args[0], 'dev');
    const persist = args.indexOf('--persist-to');
    assert.ok(persist > 0);
    assert.equal(args[persist + 1], '../privado/portal/banco/estado/state');
  }
});

test('escolhe o endereco conforme o modo', () => {
  assert.ok(!montarArgumentos('', {}).includes('--ip'));
  assert.deepEqual(montarArgumentos('local', {}).slice(-4), ['--ip', '127.0.0.1', '--port', '3000']);
  assert.deepEqual(montarArgumentos('lan', {}).slice(-4), ['--ip', '0.0.0.0', '--port', '3000']);
});
