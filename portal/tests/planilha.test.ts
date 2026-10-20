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

void test('aceita 999 dados com cabecalho e recusa a linha 1001', async () => {
  assert.equal((await lerPlanilha(arquivoDe(Array.from({length:999},()=>LINHA_BOA)))).ok, true);
  const excessivo=await lerPlanilha(arquivoDe(Array.from({length:1000},()=>LINHA_BOA)));
  assert.equal(excessivo.ok,false);
});
void test('recusa arquivo maior que 2 MB antes de analisar conteudo', async () => {
  const result=await lerPlanilha(new File([new Uint8Array(2*1024*1024+1)],'grande.xlsx'));
  assert.equal(result.ok,false);
});

void test('dimensao XLSX adulterada nao oculta linhas reais', async () => {
  const w = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(w, XLSX.utils.json_to_sheet(Array.from({ length: 1000 }, () => LINHA_BOA)), 'Dados');
  const c = XLSX.CFB.read(XLSX.write(w, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
  const i = c.FullPaths.findIndex((p: string) => p.endsWith('/xl/worksheets/sheet1.xml'));
  const entrada = c.FileIndex[i];
  entrada.content = Buffer.from(Buffer.from(entrada.content).toString().replace(/<dimension ref="[^"]+"/, '<dimension ref="A1:J2"'));
  entrada.size = entrada.content.length;
  const bytes = XLSX.CFB.write(c, { type: 'buffer', fileType: 'zip' });
  assert.equal((await lerPlanilha(new File([bytes], 'dimensao.xlsx'))).ok, false);
});
void test('limite de linhas tambem se aplica ao XLS binario', async () => {
  const w = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(w, XLSX.utils.json_to_sheet(Array.from({ length: 1000 }, () => LINHA_BOA)), 'Dados');
  const bytes = XLSX.write(w, { type: 'array', bookType: 'xls' });
  assert.equal((await lerPlanilha(new File([bytes], 'excessivo.xls'))).ok, false);
});

for (const ref of ['A1:J1001', 'A1:CW2', 'A1:CW1001']) {
  void test(`recusa area declarada excessiva mesmo com poucas celulas: ${ref}`, async () => {
    const w = XLSX.utils.book_new(), aba = XLSX.utils.json_to_sheet([LINHA_BOA]);
    aba['!ref'] = ref;
    XLSX.utils.book_append_sheet(w, aba, 'Dados');
    const bytes = XLSX.write(w, { type: 'array', bookType: 'xlsx' });
    assert.equal((await lerPlanilha(new File([bytes], 'area.xlsx'))).ok, false);
  });
}

void test('comentario ZIP com assinatura falsa nao muda o diretorio lido pelo parser', async () => {
  const original = new Uint8Array(await arquivoDe([LINHA_BOA]).arrayBuffer());
  const comentario = new Uint8Array(30);
  new DataView(comentario.buffer).setUint32(0, 0x06054b50, true);
  const bytes = new Uint8Array(original.length + comentario.length);
  bytes.set(original);
  bytes.set(comentario, original.length);
  new DataView(bytes.buffer).setUint16(original.length - 2, comentario.length, true);
  const resultado = await lerPlanilha(new File([bytes], 'comentario.xlsx'));
  assert.equal(resultado.ok, true);
  if (resultado.ok) assert.equal(resultado.linhas[0].CIDADE, LINHA_BOA.CIDADE);
});

void test('erro do parser XLS nao expoe detalhes internos', async () => {
  const bytes = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const resultado = await lerPlanilha(new File([bytes], 'corrompido.xls'));
  assert.deepEqual(resultado, { ok: false, erro: 'Não foi possível abrir a planilha. Salve como .xlsx e tente de novo.' });
});
