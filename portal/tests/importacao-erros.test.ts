import assert from 'node:assert/strict';
import test from 'node:test';
import { deduplicateImportRows, parseImportRow } from '../lib/importacao.ts';
import { EntradaInvalida } from '../lib/limites-entrada.ts';

void test('medidas conflitantes são erro de validação conhecido, com mensagem ao usuário', () => {
  const base = { CIDADE: 'X', UF: 'SP', MODELO: 'M', PECA_SERVICO: 'I', PRECO: 10 };
  const linhas = [parseImportRow({ ...base, MEDIDA: 'UNIDADE' }, 2), parseImportRow({ ...base, MEDIDA: 'LITRO' }, 3)];
  linhas[0].locationId = linhas[1].locationId = 'l'; linhas[0].itemId = linhas[1].itemId = 'i'; linhas[0].modelId = linhas[1].modelId = 'm';
  linhas[0].unitId = 'u1'; linhas[1].unitId = 'u2';
  assert.throws(() => deduplicateImportRows(linhas), (erro: unknown) => erro instanceof EntradaInvalida && /Medidas diferentes/.test(erro.message));
});
