import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isIsoDate,
  isValidCnpj,
  isValidState,
  isValidDateRange,
  normalizeCnpj,
  normalizeImportText,
  normalizeText,
  safeFilename,
  toNonNegativeMoney,
  MIN_PASSWORD_LENGTH,
  validatePassword,
} from '../lib/domain.ts';

void test('UF deve existir no Brasil, inclusive em cadastros manuais', () => {
  for (const value of ['GO', 'TO', 'DF', ' sp ']) assert.equal(isValidState(value), true);
  for (const value of ['TI', 'XX', 'G', 'GOIAS', '', null, 12]) assert.equal(isValidState(value), false);
});

void test('normaliza texto sem converter objetos acidentalmente', () => {
  assert.equal(normalizeText('  óleo   do motor '), 'ÓLEO DO MOTOR');
  assert.equal(normalizeText(42), '42');
  assert.equal(normalizeText({ value: 'texto' }), '');
});

void test('normaliza texto de importação removendo acentos e caracteres invisíveis', () => {
  assert.equal(normalizeImportText('  óleo\u00a0 de  direção\t'), 'OLEO DE DIRECAO');
  assert.equal(normalizeImportText('Revisão 10.000 km'), 'REVISAO 10.000 KM');
});

void test('normaliza e valida CNPJ pelo tamanho e pelos dígitos verificadores', () => {
  assert.equal(normalizeCnpj('11.222.333/0001-81'), '11222333000181');
  assert.equal(normalizeCnpj('123'), '123');
  assert.equal(isValidCnpj('11.222.333/0001-81'), true);
  assert.equal(isValidCnpj('11.222.333/0001-82'), false);
  assert.equal(isValidCnpj('00.000.000/0000-00'), false);
});

void test('valida datas reais e intervalos de vigência', () => {
  assert.equal(isIsoDate('2028-02-29'), true);
  assert.equal(isIsoDate('2027-02-29'), false);
  assert.equal(isIsoDate('31/08/2026'), false);
  assert.equal(isValidDateRange('2026-08-01', '2026-08-31'), true);
  assert.equal(isValidDateRange('2026-09-01', '2026-08-31'), false);
});

void test('aceita apenas valores monetários finitos e não negativos', () => {
  assert.equal(toNonNegativeMoney('12.345'), 12.35);
  assert.equal(toNonNegativeMoney(0), 0);
  assert.equal(toNonNegativeMoney(-1), null);
  assert.equal(toNonNegativeMoney('não é preço'), null);
});

void test('preço inválido não vira zero, um ou infinito por coerção', () => {
  for (const value of [false, true, [], [10], {}, ' ', '\t', null, undefined, NaN, Infinity, 1e308]) {
    assert.equal(toNonNegativeMoney(value), null);
  }
  assert.equal(toNonNegativeMoney(' 0 '), 0);
  assert.equal(toNonNegativeMoney(' 12.50 '), 12.5);
});

void test('aplica os limites de senha inicial', () => {
  assert.equal(MIN_PASSWORD_LENGTH, 5);
  for (const value of ['1234', '', null, 12345]) {
    assert.equal(validatePassword(value), 'A senha deve ter pelo menos 5 caracteres.');
  }
  assert.equal(validatePassword('12345'), null);
  assert.equal(validatePassword('x'.repeat(200)), null);
  assert.equal(validatePassword('x'.repeat(201)), 'A senha deve ter no máximo 200 caracteres.');
});

void test('remove caracteres perigosos do nome exportado pela importação', () => {
  assert.equal(safeFilename('../../tabela<script>.xlsx'), '.._.._tabela_script_.xlsx');
  assert.equal(safeFilename(null), 'arquivo.xlsx');
});
