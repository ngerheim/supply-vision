import assert from 'node:assert/strict';
import test from 'node:test';
import { enderecoServidor } from '../scripts/iniciar-portal.mjs';
import { configuracaoServidor } from '../scripts/configuracao-servidor.mjs';

void test('host e porta de operacao preservados', () => {
  assert.deepEqual(enderecoServidor('local'), {host:'127.0.0.1',port:3000});
  assert.deepEqual(enderecoServidor('lan',{PORTAL_PORTA:'3210'}), {host:'0.0.0.0',port:3210});
  assert.throws(()=>enderecoServidor('outro'),/invalido/);
  assert.throws(()=>enderecoServidor('local',{PORTAL_PORTA:'3001'}),/invalidas/);
});
void test('configuracao tem lista fechada, preserva caracteres e rejeita quebra de linha', () => {
  const senha = `aspas'" cifrao$ barra\\n`;
  assert.equal(configuracaoServidor({INITIAL_ADMIN_PASSWORD:senha}).INITIAL_ADMIN_PASSWORD,senha);
  assert.equal(configuracaoServidor({SMTP_PASSWORD:'segredo'}).SMTP_PASSWORD,undefined);
  assert.throws(()=>configuracaoServidor({PORTAL_API_TOKEN:'a\nb'}),/quebra de linha/);
});
