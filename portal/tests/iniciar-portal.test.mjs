import assert from 'node:assert/strict';
import test from 'node:test';

import { ARQUIVO_VARS, VARIAVEIS_DO_WORKER, montarArgumentos, montarArquivoVars } from '../scripts/iniciar-portal.mjs';

test('entrega ao Worker as variaveis que ele le de env', () => {
  const texto = montarArquivoVars({
    INITIAL_ADMIN_PASSWORD: 'senha-bem-grande',
    TRUSTED_PROXY: 'true',
    PORTAL_API_TOKEN: 'a'.repeat(64),
  });
  assert.equal(texto, `INITIAL_ADMIN_PASSWORD='senha-bem-grande'\nTRUSTED_PROXY='true'\nPORTAL_API_TOKEN='${'a'.repeat(64)}'\n`);
});

test('a credencial interna vai pelo ambiente, nao pelo bundle', () => {
  assert.ok(VARIAVEIS_DO_WORKER.includes('PORTAL_API_TOKEN'));
});

test('segredo nao aparece na linha de comando do wrangler', () => {
  const args = montarArgumentos('lan', ARQUIVO_VARS);
  assert.ok(!args.includes('--var'));
  assert.deepEqual(args.slice(args.indexOf('--env-file'), args.indexOf('--env-file') + 2), ['--env-file', ARQUIVO_VARS]);
  assert.ok(!args.some((arg) => arg.includes('senha') || arg.includes('PORTAL_API_TOKEN')));
});

test('sem variavel, nao passa arquivo', () => {
  assert.equal(montarArquivoVars({}), '');
  assert.equal(montarArquivoVars({ TRUSTED_PROXY: '   ' }), '');
  assert.ok(!montarArgumentos('lan', null).includes('--env-file'));
});

test('valor com aspas escolhe um delimitador que ele nao contem', () => {
  assert.equal(montarArquivoVars({ INITIAL_ADMIN_PASSWORD: "a'b#c" }), 'INITIAL_ADMIN_PASSWORD=`a\'b#c`\n');
  assert.equal(montarArquivoVars({ INITIAL_ADMIN_PASSWORD: "a'b`c" }), 'INITIAL_ADMIN_PASSWORD="a\'b`c"\n');
  assert.throws(() => montarArquivoVars({ INITIAL_ADMIN_PASSWORD: 'a\'b"c`d' }), /combinacao de aspas/);
  // Entre aspas duplas o dotenv transformaria \n em quebra de linha.
  assert.throws(() => montarArquivoVars({ INITIAL_ADMIN_PASSWORD: "a'b`c\\n" }), /combinacao de aspas/);
});

test('cifrao chega literal, sem virar referencia a outra variavel', () => {
  assert.equal(montarArquivoVars({ INITIAL_ADMIN_PASSWORD: 'Senha$HOME$$' }), "INITIAL_ADMIN_PASSWORD='Senha\\$HOME\\$\\$'\n");
});

test('nao repassa segredo que o Worker nao usa', () => {
  assert.equal(montarArquivoVars({ SMTP_PASSWORD: 'nao-deve-vazar', BACKUP_NETWORK_DIR: '\\\\rede\\backup' }), '');
  assert.ok(!VARIAVEIS_DO_WORKER.includes('SMTP_PASSWORD'));
});

test('mantem o banco persistido na area privada em todos os modos', () => {
  for (const modo of ['', 'local', 'lan']) {
    const args = montarArgumentos(modo);
    assert.equal(args[0], 'dev');
    const persist = args.indexOf('--persist-to');
    assert.ok(persist > 0);
    assert.equal(args[persist + 1], '../privado/portal/banco/estado/state');
  }
});

test('escolhe o endereco conforme o modo', () => {
  assert.ok(!montarArgumentos('').includes('--ip'));
  assert.deepEqual(montarArgumentos('local').slice(-4), ['--ip', '127.0.0.1', '--port', '3000']);
  assert.deepEqual(montarArgumentos('lan', ARQUIVO_VARS).slice(-4), ['--ip', '0.0.0.0', '--port', '3000']);
});
