import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isAgreementEffective,
  isIsoDate,
  isValidCnpj,
  isValidDateRange,
  normalizeCnpj,
  normalizeImportCnpj,
  normalizeImportText,
  normalizeText,
  resolveImportMapping,
  resolveImportUnit,
  safeFilename,
  toNonNegativeMoney,
  validatePassword,
} from '../lib/domain.ts';

void test('normaliza texto sem converter objetos acidentalmente', () => {
  assert.equal(normalizeText('  óleo   do motor '), 'ÓLEO DO MOTOR');
  assert.equal(normalizeText(42), '42');
  assert.equal(normalizeText({ value: 'texto' }), '');
});

void test('normaliza texto de importação removendo acentos e caracteres invisíveis', () => {
  assert.equal(normalizeImportText('  óleo\u00a0 de  direção\t'), 'OLEO DE DIRECAO');
  assert.equal(normalizeImportText('Revisão 10.000 km'), 'REVISAO 10.000 KM');
});

void test('resolve De/Para pela forma normalizada e recusa origem desconhecida', () => {
  const mappings = new Map([['OLEO DE MOTOR', 'OLEO MOTOR 5W30']]);
  assert.equal(resolveImportMapping('Óleo  de motor', mappings), 'OLEO MOTOR 5W30');
  assert.equal(resolveImportMapping('ITEM SEM DE PARA', mappings), null);
});

void test('aceita código ou nome de unidade e recusa erro de digitação', () => {
  const units = [{ code: 'L', name: 'Litro' }, { code: 'UNIDADE', name: 'Unidade' }];
  assert.equal(resolveImportUnit('litro', units), 'L');
  assert.equal(resolveImportUnit(' l ', units), 'L');
  assert.equal(resolveImportUnit('lirto', units), null);
  assert.equal(resolveImportUnit('litro', [...units, { code: 'L2', name: 'Litro' }]), null);
});

void test('normaliza e valida CNPJ pelo tamanho e pelos dígitos verificadores', () => {
  assert.equal(normalizeCnpj('11.222.333/0001-81'), '11222333000181');
  assert.equal(normalizeCnpj('123'), '123');
  assert.equal(isValidCnpj('11.222.333/0001-81'), true);
  assert.equal(isValidCnpj('11.222.333/0001-82'), false);
  assert.equal(isValidCnpj('00.000.000/0000-00'), false);
});

void test('recupera zero à esquerda perdido pelo Excel sem inventar CNPJ curto', () => {
  // Casos reais da base de acordos: o Excel gravou a célula como número.
  assert.equal(normalizeImportCnpj(2252621000198), '02252621000198');
  assert.equal(normalizeImportCnpj(209995000103), '00209995000103');
  assert.equal(isValidCnpj(normalizeImportCnpj(2252621000198)), true);
  assert.equal(isValidCnpj(normalizeImportCnpj(209995000103)), true);
  // O mesmo valor chegando como texto também é recuperado.
  assert.equal(normalizeImportCnpj('7238647000103'), '07238647000103');
  assert.equal(isValidCnpj(normalizeImportCnpj('7238647000103')), true);
  // Quem já tem 14 dígitos passa intacto, com ou sem pontuação.
  assert.equal(normalizeImportCnpj('11.222.333/0001-81'), '11222333000181');
  assert.equal(normalizeImportCnpj('20357708000101'), '20357708000101');
  // Abaixo de 12 dígitos não há recuperação: continua curto e inválido.
  assert.equal(normalizeImportCnpj('20999500010'), '20999500010');
  assert.equal(normalizeImportCnpj('123'), '123');
  assert.equal(isValidCnpj(normalizeImportCnpj('123')), false);
  assert.equal(normalizeImportCnpj(''), '');
  // Controle negativo: dígito verificador errado não vira válido por completar
  // 14 dígitos; a correção do dado é que resolve.
  assert.equal(isValidCnpj(normalizeImportCnpj('50377296000130')), false);
  assert.equal(isValidCnpj(normalizeImportCnpj('50377296000132')), true);
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
