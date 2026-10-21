import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidCnpj } from '../lib/domain.ts';
import { parseImportRow, validarFornecedorImportacao } from '../lib/importacao.ts';

const linha = { CIDADE: 'X', UF: 'SP', MODELO: 'M', PECA_SERVICO: 'I', MEDIDA: 'UNIDADE', PRECO: 10 };
// Bases ficticias geradas para esta fixture, com digitos verificadores validos.
const cnpjDestino = '06391842000106';
const cnpjOutro = '08517693000104';
const cnpjZeroInicial = '09364728000177';

void test('precos ambiguos sao recusados e centavos seguem cadastro manual', () => {
  for (const PRECO of ['1.500', 'R$ 2.350']) assert.match(parseImportRow({ ...linha, PRECO }, 2).error, /ambíguo/);
  assert.equal(parseImportRow({ ...linha, PRECO: '1.500,00' }, 2).price, 1500);
  assert.equal(parseImportRow({ ...linha, PRECO: 10.555 }, 2).price, 10.56);
  for (const PRECO of ['10,555', '10.555', 'R$ 7,125']) assert.match(parseImportRow({ ...linha, PRECO }, 2).error, /duas casas|ambíguo/);
  for (const [PRECO, esperado] of [['10,5', 10.5], ['10,50', 10.5], ['1.50', 1.5], ['0,99', 0.99]] as const) assert.equal(parseImportRow({ ...linha, PRECO }, 2).price, esperado);
  assert.ok(parseImportRow({ ...linha, PRECO: 1e30 }, 2).error);
});

void test('identidade do fornecedor opcional deve coincidir quando informada', () => {
  assert.ok(isValidCnpj(cnpjDestino));
  assert.ok(isValidCnpj(cnpjOutro));
  const destino = { cnpj: cnpjDestino, tradeName: 'Oficina Ficticia', legalName: 'Oficina Ficticia Ltda' };
  for (const extra of [{}, { CNPJ: '06.391.842/0001-06' }, { FORNECEDOR: 'oficina ficticia ltda' }, { CNPJ: destino.cnpj, FORNECEDOR: 'Nome alternativo ficticio' }]) {
    const row = parseImportRow({ ...linha, ...extra }, 2);
    validarFornecedorImportacao([row], destino);
    assert.equal(row.error, '');
  }
  for (const extra of [{ CNPJ: '' }, { CNPJ: cnpjOutro }, { FORNECEDOR: 'Outra Ficticia' }, { FORNECEDOR: '' }]) {
    const row = parseImportRow({ ...linha, ...extra }, 2);
    validarFornecedorImportacao([row], destino);
    assert.match(row.error, /não informado|não corresponde/);
  }
});

void test('CNPJ numerico recupera zero inicial e celulas vazias tem motivo proprio', () => {
  assert.ok(isValidCnpj(cnpjZeroInicial));
  assert.equal(cnpjZeroInicial[0], '0');
  assert.equal(String(Number(cnpjZeroInicial)).length, 13);
  const destino = { cnpj: cnpjZeroInicial, tradeName: 'Oficina Ficticia', legalName: 'Oficina Ficticia Ltda' };
  for (const CNPJ of [cnpjZeroInicial, '09.364.728/0001-77', Number(cnpjZeroInicial), String(Number(cnpjZeroInicial))]) {
    const row = parseImportRow({ ...linha, CNPJ }, 2);
    validarFornecedorImportacao([row], destino);
    assert.equal(row.error, '');
    assert.equal(row.cnpj.padStart(14, '0'), cnpjZeroInicial);
  }
  for (const CNPJ of ['', Number(cnpjOutro)]) {
    const row = parseImportRow({ ...linha, CNPJ }, 2);
    validarFornecedorImportacao([row], destino);
    assert.match(row.error, CNPJ === '' ? /CNPJ não informado/ : /não corresponde/);
    if (CNPJ === '') assert.equal(row.issues.at(-1)?.valor, '(vazio)');
  }
});
