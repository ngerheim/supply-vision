import assert from 'node:assert/strict';
import test from 'node:test';
import { mensagemErroRestauracao } from '../scripts/restaurar-backup.mjs';
import { FalhaBackup } from '../scripts/backup-7z.mjs';

void test('restauracao explica a causa original sem expor credenciais ou saida nativa', () => {
  const isolamento = 'PREPARAR isolamento: porta nao pertence a fixture.';
  assert.match(mensagemErroRestauracao(new Error(isolamento), {}), /PREPARAR isolamento: porta nao pertence a fixture/);
  assert.match(mensagemErroRestauracao(Object.assign(new Error('acesso negado'), {code:'EACCES'}), {}), /EACCES.*acesso negado/);
  assert.equal(mensagemErroRestauracao(new FalhaBackup('Pare a operacao antes de restaurar.'), {}), 'Pare a operacao antes de restaurar.');
  const config = {PORTAL_API_TOKEN:'token-ficticio-sigiloso', SMTP_PASSWORD:'senha-ficticia-sigilosa'};
  const erro = new Error('falha token-ficticio-sigiloso senha-ficticia-sigilosa https://usuario:outra-senha@example.com Bearer outro-token password=segredo-adicional');
  const mensagem = mensagemErroRestauracao(erro, config);
  assert.match(mensagem,/falha/);
  for (const segredo of [...Object.values(config),'outra-senha','outro-token','segredo-adicional']) assert.ok(!mensagem.includes(segredo),mensagem);
  const nativo = Object.assign(new Error('Command failed: segredo-em-argumento'), {status:1, stdout:'segredo-stdout', stderr:'segredo-stderr'});
  assert.match(mensagemErroRestauracao(nativo, {}), /processo auxiliar.*1/);
  assert.doesNotMatch(mensagemErroRestauracao(nativo, {}), /segredo/);
});
