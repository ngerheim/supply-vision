import assert from 'node:assert/strict';
import test from 'node:test';
import { executarBackup } from '../scripts/backup.mjs';
void test('pre-atualizacao continua somente se copia local validada e rede falhar', async () => {
  const passos = [];
  const opcoes = { ensaio: false, preAtualizacao: true, copiar: () => passos.push('local'), rede: () => { passos.push('rede'); throw new Error('rede'); }, email: () => assert.fail('nao envia banco apos falha de rede'), registrar: () => passos.push('aviso') };
  assert.equal(await executarBackup(opcoes), 3);
  assert.deepEqual(passos, ['local', 'rede', 'aviso']);
  await assert.rejects(executarBackup({ ...opcoes, copiar: () => { throw new Error('local'); } }), /local/);
  await assert.rejects(executarBackup({ ...opcoes, preAtualizacao: false }), /rede/);
});
void test('ensaio continua sem rede; SMTP sem redundancia ainda bloqueia', async () => {
  assert.equal(await executarBackup({ ensaio: true, copiar() {}, rede: () => assert.fail(), email: () => assert.fail() }), 0);
  await assert.rejects(executarBackup({ ensaio: false, preAtualizacao: true, copiar() {}, rede: () => null, email: () => { throw new Error('smtp'); } }), /smtp/);
});
