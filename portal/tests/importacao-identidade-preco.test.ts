import assert from 'node:assert/strict';
import test from 'node:test';
import {parseImportRow,validarFornecedorImportacao} from '../lib/importacao.ts';
const linha={CIDADE:'X',UF:'SP',MODELO:'M',PECA_SERVICO:'I',MEDIDA:'UNIDADE',PRECO:10};
void test('precos ambiguos sao recusados e centavos seguem cadastro manual',()=>{
 for(const PRECO of ['1.500','R$ 2.350'])assert.match(parseImportRow({...linha,PRECO},2).error,/ambíguo/);
 assert.equal(parseImportRow({...linha,PRECO:'1.500,00'},2).price,1500);
 assert.equal(parseImportRow({...linha,PRECO:10.555},2).price,10.56);
 for(const PRECO of ['10,555','10.555','R$ 7,125'])assert.match(parseImportRow({...linha,PRECO},2).error,/duas casas|ambíguo/);
 for(const [PRECO,esperado] of [['10,5',10.5],['10,50',10.5],['1.50',1.5],['0,99',0.99]] as const)assert.equal(parseImportRow({...linha,PRECO},2).price,esperado);
 assert.ok(parseImportRow({...linha,PRECO:1e30},2).error);
});
void test('identidade do fornecedor opcional deve coincidir quando informada',()=>{
 const destino={cnpj:'11222333000181',tradeName:'Oficina',legalName:'Oficina Ltda'};
 for(const extra of [{},{CNPJ:'11.222.333/0001-81'},{FORNECEDOR:'oficina ltda'},{CNPJ:destino.cnpj,FORNECEDOR:'Nome alternativo'}]){
 const row=parseImportRow({...linha,...extra},2);validarFornecedorImportacao([row],destino);assert.equal(row.error,'');}
 for(const extra of [{CNPJ:''},{CNPJ:'04252011000110'},{FORNECEDOR:'Outra'},{FORNECEDOR:''}]){
 const row=parseImportRow({...linha,...extra},2);validarFornecedorImportacao([row],destino);assert.ok(row.error);}
});

void test('CNPJ numerico recupera zero inicial e celulas vazias tem motivo proprio',()=>{
 const destino={cnpj:'01234567000195',tradeName:'Oficina',legalName:'Oficina Ltda'};
 for(const CNPJ of ['01234567000195','01.234.567/0001-95',1234567000195,'1234567000195']){const row=parseImportRow({...linha,CNPJ},2);validarFornecedorImportacao([row],destino);assert.equal(row.error,'')}
 for(const CNPJ of ['',1234567000196]){const row=parseImportRow({...linha,CNPJ},2);validarFornecedorImportacao([row],destino);assert.match(row.error,CNPJ===''?/CNPJ não informado/:/não corresponde/);if(CNPJ==='')assert.equal(row.issues.at(-1)?.valor,'(vazio)')}
});
