import assert from 'node:assert/strict';
import test from 'node:test';
import { categorizar, contarLinhas, inventario } from '../../scripts/inventario-metricas.mjs';
void test('inventario: categorias exclusivas, exclusoes e linhas fisicas',()=>{
  for(const nome of ['privado/config.env','portal/vendor/lib.js','portal/package-lock.json','LICENSE','portal/public/favicon.svg'])assert.equal(categorizar(nome),null);
  assert.equal(categorizar('AGENTS.md'),'docs');assert.equal(categorizar('.github/CODEOWNERS'),'ci');
  for(const nome of ['portal/tests/a.ts','testes/fixtures/a.json','scripts/testar-a.ps1'])assert.equal(categorizar(nome),'testes');
  assert.equal(categorizar('portal/lib/a.ts'),'producao');
  for(const [texto,linhas] of [['',0],['a',1],['a\n',1],['a\r\nb\r\n',2],['a\n\n',2]])assert.equal(contarLinhas(texto),linhas);
});
void test('inventario: fronteira 30, binarios, total e desempate deterministico',()=>{
  const arquivos=[['a.ts','a\n'.repeat(29)],['b.ts','b\n'.repeat(30)],['portal/tests/a.ts','teste'],['z.ts','\0binario'],['portal/vendor/a.ts','ignorado']].map(([arquivo,texto])=>({arquivo,conteudo:Buffer.from(texto)}));
  const resultado=inventario(arquivos);
  assert.deepEqual(resultado.total,{arquivos:3,linhas:60});
  assert.deepEqual(resultado.pequenos.map(i=>i.arquivo),['a.ts']);assert.equal(resultado.maiores[0].arquivo,'b.ts');
});
