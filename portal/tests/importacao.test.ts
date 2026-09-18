import assert from 'node:assert/strict';
import test from 'node:test';
import {
  colunasAusentes,
  deduplicateImportRows,
  parseImportRow,
  resolveImportRows,
  summarizeImportErrors,
  uniqueIndex,
  type ImportReferences,
} from '../lib/importacao.ts';
import { suggestMatches } from '../lib/sugestoes.ts';

const source = {
  CIDADE: 'Almas',
  UF: 'TO',
  MODELO: 'Hilux',
  PECA_SERVICO: 'Bieleta',
  PRECO: 120,
  MEDIDA: 'UNIDADE',
  CNPJ: '11222333000181',
};
const refs: ImportReferences = {
  items: new Map([['BIELETA', { id: 'item', name: 'BIELETA' }]]),
  models: new Map([['HILUX', { id: 'model', name: 'HILUX' }]]),
  units: new Map([['UNIDADE', { id: 'unit', name: 'UNIDADE' }]]),
  locations: new Map([
    ['ALMAS/TO', { id: 'location', city: 'ALMAS', state: 'TO' }],
  ]),
  suppliers: new Map([['11222333000181', 'FORNECEDOR CADASTRADO']]),
};
const resolved = (changes = {}) => {
  const row = parseImportRow({ ...source, ...changes }, 2, true);
  resolveImportRows([row], refs, true);
  return row;
};

void test('carga inicial usa CNPJ sem exigir nome do fornecedor', () => {
  assert.deepEqual(colunasAusentes(source, true), []);
  const row = resolved();
  assert.equal(row.error, '');
  assert.equal(row.supplier, 'FORNECEDOR CADASTRADO');
});
void test('conferencia apresenta todos os campos desconhecidos de uma linha', () => {
  const row = resolved({
    CIDADE: 'Alms',
    UF: 'TI',
    MODELO: 'Hlux',
    PECA_SERVICO: 'Bileta',
    MEDIDA: 'UNT',
  });
  const report = summarizeImportErrors([row], 'Acordos');
  assert.equal(report.totalErros, 1);
  assert.equal(report.nomenclaturas.length, 4);
  assert.deepEqual(
    report.nomenclaturas.map((issue) => issue.tipo),
    ['locations', 'items', 'models', 'units'],
  );
});
void test('erros de preco e nomenclatura aparecem juntos', () => {
  const report = summarizeImportErrors(
    [resolved({ PRECO: '', MODELO: 'Hlux' })],
    'Acordos',
  );
  assert.equal(report.outrosErros.length, 1);
  assert.equal(report.nomenclaturas.length, 1);
  assert.equal(report.totalErros, 1);
});
void test('somente alias confirmado resolve cidade e UF digitadas incorretamente', () => {
  const row = parseImportRow({ ...source, CIDADE: 'Alms', UF: 'TI' }, 2, true);
  resolveImportRows(
    [row],
    {
      ...refs,
      locations: new Map([
        ...refs.locations,
        ['ALMS/TI', { id: 'location', city: 'ALMAS', state: 'TO' }],
      ]),
    },
    true,
  );
  assert.equal(row.error, '');
  assert.equal(row.city, 'ALMAS');
  assert.equal(row.state, 'TO');
});
void test('preco ausente nao vira cortesia e zero explicito continua valido', () => {
  for (const price of ['', null, undefined, 'a combinar', '12.34,56', -1])
    assert.ok(resolved({ PRECO: price }).error);
  assert.equal(resolved({ PRECO: 0 }).error, '');
});
void test('substituicao ignora CNPJ da planilha', () => {
  const row = parseImportRow({ ...source, CNPJ: 'errado' }, 2, false);
  resolveImportRows([row], refs, false);
  assert.equal(row.error, '');
  assert.equal(row.cnpj, '');
});
void test('chaves canonicas ambiguas exigem escolha explicita', () => {
  assert.equal(
    uniqueIndex([
      ['BELEM/PA', 'id1'],
      ['BELEM/PA', 'id2'],
    ]).get('BELEM/PA'),
    null,
  );
});
void test('deduplicacao preserva localidades e mantem o menor preco', () => {
  const first = resolved(),
    cheaper = { ...first, rowNumber: 3, price: 90 },
    elsewhere = { ...first, locationId: 'other', rowNumber: 4 };
  const result = deduplicateImportRows([first, cheaper, elsewhere], true);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].price, 90);
  assert.equal(result.summary.amostraDuplicatas[0].linhaDescartada, 2);
});
void test('medidas divergentes sao rejeitadas antes de publicar', () => {
  const row = resolved();
  assert.throws(
    () =>
      deduplicateImportRows(
        [row, { ...row, unitId: 'litro', rowNumber: 3 }],
        false,
      ),
    /Medidas diferentes/,
  );
});
void test('sugestoes aproximadas nao alteram nem resolvem as linhas', () => {
  const options = [
    { id: 'hilux', name: 'HILUX' },
    { id: 'uno', name: 'UNO' },
  ];
  assert.equal(suggestMatches('Hlux', options)[0]?.id, 'hilux');
  assert.ok(resolved({ MODELO: 'Hlux' }).error);
  assert.deepEqual(suggestMatches('ZZZZ', options), []);
});
