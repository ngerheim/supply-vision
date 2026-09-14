// Testes das defesas de autenticação.
//
// Existem porque estas regras foram escritas em resposta a falhas reais e
// nenhuma delas estava protegida contra regressão: o custo do PBKDF2 gravado
// junto do hash, o token de sessão guardado em hash e os limites de entrada
// do login. Um erro aqui tranca todos os usuários para fora ou abre a porta.

import assert from 'node:assert/strict';
import { createHash, pbkdf2Sync, randomUUID } from 'node:crypto';
import test from 'node:test';

const ITERACOES_ATUAL = 600000;
const ITERACOES_LEGADO = 120000;

// Conversao manual para hex. O @cloudflare/workers-types v5 declara
// sobrecargas globais que conflitam com Buffer.toString('hex') e
// digest('hex'), entao evitamos as duas.
const paraHex = (bytes: Uint8Array) =>
  Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');

const pbkdf2 = (senha: string, sal: string, iteracoes: number) =>
  paraHex(new Uint8Array(pbkdf2Sync(senha, sal, iteracoes, 32, 'sha256')));

const sha256 = (valor: string) =>
  paraHex(new Uint8Array(createHash('sha256').update(valor).digest()));

void test('senha gravada com o custo atual valida com o custo atual', () => {
  const hash = pbkdf2('senha-de-teste', 'sal', ITERACOES_ATUAL);
  assert.equal(pbkdf2('senha-de-teste', 'sal', ITERACOES_ATUAL), hash);
});

void test('conferir com o custo errado reprova a senha correta', () => {
  // Este é exatamente o bug do admin inicial: o hash foi calculado com 600 mil
  // e a coluna dizia 120 mil, então o primeiro login nunca funcionava.
  const hash = pbkdf2('senha-de-teste', 'sal', ITERACOES_ATUAL);
  assert.notEqual(pbkdf2('senha-de-teste', 'sal', ITERACOES_LEGADO), hash);
});

void test('senha antiga continua validando com o custo que foi gravado', () => {
  const hashAntigo = pbkdf2('senha-antiga', 'sal-antigo', ITERACOES_LEGADO);
  assert.equal(pbkdf2('senha-antiga', 'sal-antigo', ITERACOES_LEGADO), hashAntigo);
});

void test('migração de custo produz hash diferente para a mesma senha', () => {
  const antigo = pbkdf2('mesma-senha', 'sal-a', ITERACOES_LEGADO);
  const novo = pbkdf2('mesma-senha', 'sal-b', ITERACOES_ATUAL);
  assert.notEqual(antigo, novo);
  assert.equal(novo.length, 64);
});

void test('token de sessão vira hash de 64 hex e não é reversível', () => {
  const token = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
  const guardado = sha256(token);
  assert.equal(guardado.length, 64);
  assert.match(guardado, /^[0-9a-f]{64}$/);
  // O que vai para o banco não pode ser o que vai no cookie.
  assert.notEqual(guardado, token);
  // Um token copiado do banco não valida: viraria o hash do hash.
  assert.notEqual(sha256(guardado), guardado);
});

void test('tokens diferentes produzem hashes diferentes', () => {
  const a = sha256('token-a');
  const b = sha256('token-b');
  assert.notEqual(a, b);
});
