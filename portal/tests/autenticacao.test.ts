import assert from 'node:assert/strict';
import { randomUUID, pbkdf2Sync, createHash } from 'node:crypto';
import test from 'node:test';
import { passwordHash as pbkdf2, tokenHash as sha256, PBKDF2_ITERACOES_ATUAL as ITERACOES_ATUAL, PBKDF2_ITERACOES_LEGADO as ITERACOES_LEGADO } from '../lib/criptografia.ts';

void test('senha gravada com o custo atual valida com o custo atual', async () => {
  const hash = await pbkdf2('senha-de-teste', 'sal', ITERACOES_ATUAL);
  assert.equal(await pbkdf2('senha-de-teste', 'sal', ITERACOES_ATUAL), hash);
});

void test('conferir com o custo errado reprova a senha correta', async () => {
  // Este é exatamente o bug do admin inicial: o hash foi calculado com 600 mil
  // e a coluna dizia 120 mil, então o primeiro login nunca funcionava.
  const hash = await pbkdf2('senha-de-teste', 'sal', ITERACOES_ATUAL);
  assert.notEqual(await pbkdf2('senha-de-teste', 'sal', ITERACOES_LEGADO), hash);
});

void test('senha antiga continua validando com o custo que foi gravado', async () => {
  const hashAntigo = await pbkdf2('senha-antiga', 'sal-antigo', ITERACOES_LEGADO);
  assert.equal(await pbkdf2('senha-antiga', 'sal-antigo', ITERACOES_LEGADO), hashAntigo);
});

void test('migração de custo produz hash diferente para a mesma senha', async () => {
  const antigo = await pbkdf2('mesma-senha', 'sal-a', ITERACOES_LEGADO);
  const novo = await pbkdf2('mesma-senha', 'sal-b', ITERACOES_ATUAL);
  assert.notEqual(antigo, novo);
  assert.equal(novo.length, 64);
});

void test('token de sessão vira hash de 64 hex e não é reversível', async () => {
  const token = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
  const guardado = await sha256(token);
  assert.equal(guardado.length, 64);
  assert.match(guardado, /^[0-9a-f]{64}$/);
  // O que vai para o banco não pode ser o que vai no cookie.
  assert.notEqual(guardado, token);
  // Um token copiado do banco não valida: viraria o hash do hash.
  assert.notEqual(await sha256(guardado), guardado);
});

void test('tokens diferentes produzem hashes diferentes', async () => {
  const a = await sha256('token-a');
  const b = await sha256('token-b');
  assert.notEqual(a, b);
});

void test('funções de produção correspondem à referência criptográfica independente', async () => {
  const hex = (bytes: Uint8Array) => Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  assert.equal(await pbkdf2('senha', 'sal'), hex(new Uint8Array(pbkdf2Sync('senha', 'sal', ITERACOES_ATUAL, 32, 'sha256'))));
  assert.equal(await sha256('token'), hex(new Uint8Array(createHash('sha256').update('token').digest())));
});
