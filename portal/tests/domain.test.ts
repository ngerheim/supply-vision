import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isAgreementEffective,
  isIsoDate,
  isValidCnpj,
  isValidDateRange,
  normalizeCnpj,
  normalizeText,
  safeFilename,
  toNonNegativeMoney,
  validatePassword,
} from '../lib/domain.ts';

void test('normaliza texto sem converter objetos acidentalmente', () => {
  assert.equal(normalizeText('  óleo   do motor '), 'ÓLEO DO MOTOR');
  assert.equal(normalizeText(42), '42');
  assert.equal(normalizeText({ value: 'texto' }), '');
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

void test('aplica os limites de senha inicial', () => {
  assert.equal(validatePassword('123456789'), false);
  assert.equal(validatePassword('1234567890'), true);
  assert.equal(validatePassword('x'.repeat(201)), false);
});

void test('considera pesquisável somente o acordo vigente na data informada', () => {
  assert.equal(isAgreementEffective({ status: 'active', startDate: '2026-01-01', endDate: '2026-12-31' }, '2026-08-31'), true);
  assert.equal(isAgreementEffective({ status: 'active', startDate: '2026-09-01' }, '2026-08-31'), false);
  assert.equal(isAgreementEffective({ status: 'active', startDate: '2025-01-01', endDate: '2026-08-30' }, '2026-08-31'), false);
  assert.equal(isAgreementEffective({ status: 'draft', startDate: '2026-01-01' }, '2026-08-31'), false);
});

void test('remove caracteres perigosos do nome exportado pela importação', () => {
  assert.equal(safeFilename('../../tabela<script>.xlsx'), '.._.._tabela_script_.xlsx');
  assert.equal(safeFilename(null), 'arquivo.xlsx');
});
