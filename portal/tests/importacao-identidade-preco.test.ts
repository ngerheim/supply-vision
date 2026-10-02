import assert from 'node:assert/strict';
import test from 'node:test';
import {parseImportRow,validarFornecedorImportacao} from '../lib/importacao.ts';
const linha={CIDADE:'X',UF:'SP',MODELO:'M',PECA_SERVICO:'I',MEDIDA:'UNIDADE',PRECO:10};
void test('precos ambiguos sao recusados e centavos seguem cadastro manual',()=>{
 for(const PRECO of ['1.500','R$ 2.350'])assert.match(parseImportRow({...linha,PRECO},2).error,/ambíguo/);
 assert.equal(parseImportRow({...linha,PRECO:'1.500,00'},2).price,1500);
 for(const PRECO of [10.555,'10,555'])assert.equal(parseImportRow({...linha,PRECO},2).price,10.56);
 assert.ok(parseImportRow({...linha,PRECO:1e30},2).error);
});
void test('identidade do fornecedor opcional deve coincidir quando informada',()=>{
 const destino={cnpj:'11222333000181',tradeName:'Oficina',legalName:'Oficina Ltda'};
 for(const extra of [{},{CNPJ:'11.222.333/0001-81'},{FORNECEDOR:'oficina ltda'},{CNPJ:destino.cnpj,FORNECEDOR:'Nome alternativo'}]){
 const row=parseImportRow({...linha,...extra},2);validarFornecedorImportacao([row],destino);assert.equal(row.error,'');}
 for(const extra of [{CNPJ:''},{CNPJ:'04252011000110'},{FORNECEDOR:'Outra'},{FORNECEDOR:''}]){
 const row=parseImportRow({...linha,...extra},2);validarFornecedorImportacao([row],destino);assert.ok(row.error);}
});
