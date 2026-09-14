// Testes dos limites de entrada.
//
// Existem porque as proteções desta rodada foram todas validadas à mão, e a
// experiência deste projeto já mostrou duas vezes que proteção sem teste
// desaparece em silêncio: o teste de poluição de protótipo que não testava
// nada, e o invariante de datas que nunca encontrava nada.
//
// Aqui ficam as regras puras (contagem, fronteiras, listas). O comportamento
// HTTP — 413, 400, 500 — é coberto por scripts/teste-instalacao-nova.ps1.

import assert from 'node:assert/strict';
import test from 'node:test';

// Importa os valores REAIS de produção. Antes eles eram copiados à mão aqui,
// e a cópia batia consigo mesma: mudar o limite de verdade não quebrava teste
// nenhum. Agora quebra, que é o comportamento desejado.
import {
  CORPO_MAX_JSON, CORPO_MAX_LOGIN, CORPO_MAX_UPLOAD, EntradaInvalida,
  LIMITES_CAMPO, LIMITE_LISTA, exigeLista, exigeTexto,
} from '../lib/limites-entrada.ts';

const cabe = (texto: string, maximo: number) => {
  try { exigeTexto(texto, maximo, 'campo'); return true; }
  catch { return false; }
};

void test('texto exatamente no limite é aceito', () => {
  assert.equal(cabe('A'.repeat(LIMITES_CAMPO.nome), LIMITES_CAMPO.nome), true);
});

void test('um caractere acima do limite é recusado', () => {
  assert.equal(cabe('A'.repeat(LIMITES_CAMPO.nome + 1), LIMITES_CAMPO.nome), false);
});

void test('acento conta como um caractere, não como dois bytes', () => {
  // 'ç' ocupa 2 bytes em UTF-8. Contar bytes recusaria texto legítimo em
  // português; contamos caracteres justamente para não penalizar acentuação.
  const texto = 'ç'.repeat(LIMITES_CAMPO.nome);
  assert.equal(texto.length, LIMITES_CAMPO.nome);
  assert.equal(new TextEncoder().encode(texto).length, LIMITES_CAMPO.nome * 2);
  assert.equal(cabe(texto, LIMITES_CAMPO.nome), true);
});

void test('espaços em volta não consomem o limite', () => {
  assert.equal(cabe('  ' + 'A'.repeat(LIMITES_CAMPO.nome) + '  ', LIMITES_CAMPO.nome), true);
});

void test('lista no limite passa e acima não', () => {
  const lista = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);
  assert.equal(lista(LIMITE_LISTA).length <= LIMITE_LISTA, true);
  assert.equal(lista(LIMITE_LISTA + 1).length <= LIMITE_LISTA, false);
});

void test('limite de lista cabe no teto de parâmetros do D1', () => {
  // O D1 aceita no máximo 100 parâmetros por consulta, e cada item da lista
  // vira um "?" no IN. Um teto de 500 passaria aqui e seria recusado pelo
  // banco em produção.
  assert.ok(LIMITE_LISTA < 100, 'a lista precisa caber em IN (?,?,...) do D1');
  assert.ok(LIMITE_LISTA <= 100 - 20, 'deixe folga para os demais parâmetros da consulta');
});

void test('login tem teto menor que o das demais rotas JSON', () => {
  // O login é o único caminho que gasta CPU pesada (PBKDF2) antes de validar.
  assert.ok(CORPO_MAX_LOGIN < CORPO_MAX_JSON);
});

void test('teto de upload comporta o arquivo de 15 MB mais o multipart', () => {
  const arquivo = 15 * 1024 * 1024;
  assert.ok(CORPO_MAX_UPLOAD > arquivo, 'precisa de folga para os metadados do multipart');
  assert.ok(CORPO_MAX_UPLOAD < arquivo * 2, 'a folga não pode virar espaço livre');
});

void test('todo limite declarado é positivo e coerente', () => {
  for (const [campo, valor] of Object.entries(LIMITES_CAMPO)) {
    assert.ok(valor > 0, `${campo} precisa de um limite positivo`);
    assert.ok(valor <= CORPO_MAX_JSON, `${campo} não pode passar do teto do corpo`);
  }
  assert.ok(LIMITES_CAMPO.observacoes > LIMITES_CAMPO.nome, 'observação é texto longo, nome não');
});

void test('exigeTexto lança EntradaInvalida, que a API traduz em 400', () => {
  assert.throws(
    () => exigeTexto('A'.repeat(LIMITES_CAMPO.nome + 1), LIMITES_CAMPO.nome, 'nome'),
    EntradaInvalida,
  );
});

void test('mensagem de erro diz qual campo e qual limite', () => {
  try {
    exigeTexto('A'.repeat(200), LIMITES_CAMPO.nome, 'fornecedor');
    assert.fail('deveria ter recusado');
  } catch (erro) {
    assert.ok(erro instanceof EntradaInvalida);
    assert.match(erro.message, /fornecedor/);
    assert.match(erro.message, new RegExp(String(LIMITES_CAMPO.nome)));
  }
});

void test('exigeLista aceita no limite e recusa acima', () => {
  const lista = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);
  assert.equal(exigeLista(lista(LIMITE_LISTA), 'modelos').length, LIMITE_LISTA);
  assert.throws(() => exigeLista(lista(LIMITE_LISTA + 1), 'modelos'), EntradaInvalida);
});

void test('valor que não é lista vira lista vazia, não erro', () => {
  assert.deepEqual(exigeLista(undefined, 'modelos'), []);
  assert.deepEqual(exigeLista('texto', 'modelos'), []);
});
