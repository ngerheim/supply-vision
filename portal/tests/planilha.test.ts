// Testes da leitura de planilhas.
//
// Cobrem as defesas de lib/planilha.ts contra arquivos maliciosos ou
// malformados, e existem principalmente para proteger a troca de biblioteca:
// se um dia o xlsx for substituído de novo, estes testes dizem na hora se o
// comportamento mudou.
//
// As planilhas são geradas aqui mesmo, para o teste não depender de arquivos
// externos nem carregar dados reais da empresa para o repositório.

import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';

import { lerPlanilha } from '../lib/planilha.ts';

const LINHA_BOA = {
  CIDADE: 'GOIANIA', UF: 'GO', MODELO: 'STRADA', PECA_SERVICO: 'PNEU DIANTEIRO',
  PRECO: 'R$ 450,00', MEDIDA: 'UN', MARCAS: 'PIRELLI/GOODYEAR',
  CNPJ: '11.222.333/0001-81', FORNECEDOR: 'AUTO PECAS TESTE',
};

function arquivoDe(linhas: Record<string, unknown>[], nomeAba = 'Dados'): File {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), nomeAba);
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new File([bytes], 'teste.xlsx');
}

void test('lê uma planilha válida', async () => {
  const r = await lerPlanilha(arquivoDe([LINHA_BOA, { ...LINHA_BOA, PRECO: 480.5 }]));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.linhas.length, 2);
    assert.equal(r.aba, 'Dados');
    assert.equal(r.linhas[0].CIDADE, 'GOIANIA');
  }
});

void test('lê apenas a primeira aba', async () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([LINHA_BOA]), 'Primeira');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([LINHA_BOA, LINHA_BOA]), 'Segunda');
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const r = await lerPlanilha(new File([bytes], 'multi.xlsx'));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.aba, 'Primeira');
    assert.equal(r.linhas.length, 1);
  }
});

void test('preserva linha física com cabeçalho deslocado e linhas vazias', async () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[], [], ['ITEM', 'UNIDADE'], ['Óleo', 'LITRO'], [], ['Óleo', 'lirto']]), 'Dados');
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const result = await lerPlanilha(new File([bytes], 'linhas.xlsx'));
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.numerosLinhas, [4, 6]);
});

void test('recusa cabeçalhos duplicados após normalização ou equivalência', async () => {
  const result = await lerPlanilha(arquivoDe([{ ...LINHA_BOA, ' Peça/Serviço ': 'OUTRA PEÇA' }]));
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.erro, /Cabeçalho duplicado.*PECA_SERVICO/);
});

void test('recusa arquivo que não é planilha', async () => {
  const r = await lerPlanilha(new File([new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 1, 2, 3, 4])], 'falso.xlsx'));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.erro, /não é uma planilha/i);
});

void test('recusa arquivo vazio', async () => {
  const r = await lerPlanilha(new File([], 'vazio.xlsx'));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.erro, /vazio/i);
});

void test('recusa ZIP truncado sem lançar exceção', async () => {
  const inteiro = new Uint8Array(await arquivoDe([LINHA_BOA]).arrayBuffer());
  const cortado = inteiro.slice(0, Math.floor(inteiro.length / 2));
  const r = await lerPlanilha(new File([cortado], 'corrompido.xlsx'));
  assert.equal(r.ok, false);
});

void test('recusa planilha com colunas demais', async () => {
  const larga: Record<string, unknown> = { ...LINHA_BOA };
  for (let i = 0; i < 150; i++) larga[`COL${i}`] = 'x';
  const r = await lerPlanilha(arquivoDe([larga]));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.erro, /colunas/i);
});

void test('descarta chaves que poluiriam o protótipo', async () => {
  // A chave precisa ser criada como uma coluna de verdade. Num literal JS,
  // `{ __proto__: 'x' }` define o protótipo em vez de criar a chave, e o teste
  // passaria sem exercitar a defesa — foi assim que a primeira versão deste
  // teste deixou passar a remoção do filtro.
  const linha: Record<string, unknown> = { ...LINHA_BOA };
  for (const perigosa of ['__proto__', 'constructor', 'prototype']) {
    Object.defineProperty(linha, perigosa, { value: 'poluido', enumerable: true, configurable: true, writable: true });
  }
  assert.ok(Object.keys(linha).includes('__proto__'), 'a planilha de teste precisa ter a coluna perigosa');

  const r = await lerPlanilha(arquivoDe([linha]));
  assert.equal(r.ok, true);
  if (r.ok) {
    const chaves = Object.keys(r.linhas[0]);
    for (const perigosa of ['__proto__', 'constructor', 'prototype']) {
      assert.equal(chaves.includes(perigosa), false, `${perigosa} deveria ter sido descartada`);
    }
  }
  assert.equal(({} as Record<string, unknown>).poluido, undefined);
});

void test('trunca valores de célula muito longos', async () => {
  const r = await lerPlanilha(arquivoDe([{ ...LINHA_BOA, MARCAS: 'A'.repeat(30000) }]));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(String(r.linhas[0].MARCAS).length, 5000);
});
