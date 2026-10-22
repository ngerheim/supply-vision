import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ABAS_NAVEGACAO, GRUPOS_NAVEGACAO, AVISO_AREA_RESTRITA, AVISO_CHAMADO_RESTRITO,
  enderecoDaChave, enderecoParaBusca, lerEndereco, resolverEndereco, gruposVisiveis, type Nav,
} from '../lib/navegacao.ts';
import { iniciarNavegacao } from '../lib/navegacao-historico.ts';

// Inventario do contrato, independente da estrutura de producao.
const rotas: Array<[Nav, string, string | null]> = [
  ['search','buscar',null], ['maintenance','manutencao',null], ['tickets','chamados',null],
  ['agreements','acordos','acordos'], ['imports','acordos','importacoes'],
  ['suppliers','cadastros','fornecedores'], ['catalogs','cadastros','catalogos'], ['mappings','cadastros','de-para'],
  ['reports','administracao','relatorios'], ['history','administracao','historico'], ['emails','administracao','emails'], ['admin','administracao','usuarios'],
];
void test('todas as 12 chaves e seis abas fazem ida e volta com slugs estaveis', () => {
  assert.equal(ABAS_NAVEGACAO.length,6);
  assert.deepEqual(GRUPOS_NAVEGACAO.map(g => [g.nome,[...g.abas]]),[
    ['Consulta',['buscar','manutencao','chamados']],['Suprimentos',['acordos','cadastros']],['Administração',['administracao']],
  ]);
  for (const [chave,aba,subaba] of rotas) {
    const query = `?aba=${aba}${subaba ? `&sub=${subaba}` : ''}`;
    assert.deepEqual(enderecoDaChave(chave),{aba,subaba});
    assert.equal(enderecoParaBusca(enderecoDaChave(chave)),query);
    assert.deepEqual(lerEndereco(query),{aba,subaba});
    assert.equal(resolverEndereco({role:'admin'},query).nav,chave);
  }
  for (const aba of ABAS_NAVEGACAO) {
    assert.deepEqual(lerEndereco(`?aba=${aba.aba}`),{aba:aba.aba,subaba:null});
    assert.equal(resolverEndereco({role:'admin'},`?aba=${aba.aba}`).nav,aba.subabas[0].chave);
  }
});
void test('enderecos desconhecidos voltam para buscar sem erro', () => {
  for (const query of ['', '?aba=desconhecida', '?aba=ACORDOS', '?aba=cadastros&sub=errada', '?aba=buscar&sub=acordos', '?aba=acordos&sub=emails']) {
    assert.deepEqual(lerEndereco(query),{aba:'buscar',subaba:null});
    assert.equal(resolverEndereco({role:'viewer'},query).nav,'search');
    assert.equal(resolverEndereco({role:'viewer'},query).aviso,'');
  }
});
const visibilidade = {
  viewer: [['buscar',['search']],['manutencao',['maintenance']]],
  editor: [['buscar',['search']],['manutencao',['maintenance']],['chamados',['tickets']],['acordos',['agreements','imports']],['cadastros',['suppliers','catalogs','mappings']]],
  admin: [['buscar',['search']],['manutencao',['maintenance']],['chamados',['tickets']],['acordos',['agreements','imports']],['cadastros',['suppliers','catalogs','mappings']],['administracao',['reports','history','emails','admin']]],
};
for (const role of ['viewer','editor','admin'] as const) {
  void test(`${role}: exatamente as abas e subabas antigas, reagrupadas; acesso por endereco nao amplia permissoes`, () => {
    const grupos = gruposVisiveis({role});
    assert.deepEqual(grupos.flatMap(g => g.abas.map(aba => [aba.aba,aba.subabas.map(s => s.chave)])),visibilidade[role]);
    assert.deepEqual(grupos.map(g => g.nome),role === 'viewer' ? ['Consulta'] : role === 'editor' ? ['Consulta','Suprimentos'] : ['Consulta','Suprimentos','Administração']);
    const permitidas = new Set(grupos.flatMap(g => g.abas.flatMap(aba => aba.subabas.map(s => s.chave))));
    for (const [chave] of rotas) {
      const resolvido = resolverEndereco({role},enderecoParaBusca(enderecoDaChave(chave)));
      assert.equal(resolvido.nav,permitidas.has(chave) ? chave : 'search');
      assert.equal(resolvido.aviso,permitidas.has(chave) ? '' : AVISO_AREA_RESTRITA);
    }
    for (const aba of ABAS_NAVEGACAO) {
      const permitida = aba.subabas.find(sub => permitidas.has(sub.chave));
      const resolvido = resolverEndereco({role},`?aba=${aba.aba}`);
      assert.equal(resolvido.nav,permitida?.chave ?? 'search');
      assert.equal(resolvido.aviso,permitida ? '' : AVISO_AREA_RESTRITA);
    }
  });
}
void test('usuario inativo nao recebe grupos ou subabas', () => {
  assert.deepEqual(gruposVisiveis({role:'admin',active:0}),[]);
});
void test('link legado de chamado preserva o detalhe e o aviso anterior, inclusive junto de aba', () => {
  for (const role of ['editor','admin']) for (const query of ['?chamado=ID%2F1','?aba=buscar&chamado=ID%2F1']) {
    const rota = resolverEndereco({role},query);
    assert.equal(rota.nav,'tickets');assert.equal(rota.chamado,'ID/1');assert.equal(rota.aviso,'');
  }
  const negado = resolverEndereco({role:'viewer'},'?chamado=ID');
  assert.equal(negado.nav,'search');assert.equal(negado.chamado,null);assert.equal(negado.aviso,AVISO_CHAMADO_RESTRITO);
});

class JanelaFixture extends EventTarget {
  location: URL;
  entradas: string[];
  indice = 0;
  history = { pushState: (_dados: unknown, _titulo: string, endereco?: string | URL | null) => {
    this.location = new URL(String(endereco),this.location);
    this.entradas.splice(++this.indice); this.entradas.push(this.location.href);
  } };
  constructor(query: string) { super();this.location=new URL(`http://portal.test/${query}`);this.entradas=[this.location.href]; }
  mover(deslocamento: number) { this.indice+=deslocamento;this.location=new URL(this.entradas[this.indice]);this.dispatchEvent(new Event('popstate')); }
}
void test('pushState, voltar, avancar e recarga resolvem as mesmas telas; parada remove popstate', () => {
  const janela = new JanelaFixture('?aba=cadastros&sub=catalogos'), vistas: Nav[] = [];
  const controlador = iniciarNavegacao({role:'admin'},rota => vistas.push(rota.nav),janela);
  assert.deepEqual(vistas,['catalogs']);
  controlador.navegar('imports');assert.equal(janela.location.search,'?aba=acordos&sub=importacoes');
  controlador.navegar('emails');assert.equal(janela.location.search,'?aba=administracao&sub=emails');
  controlador.navegar('emails');assert.equal(janela.entradas.length,3,'Mesmo endereco nao duplica historico');
  janela.mover(-1);assert.equal(vistas.at(-1),'imports');
  janela.mover(-1);assert.equal(vistas.at(-1),'catalogs');
  janela.mover(1);assert.equal(vistas.at(-1),'imports');
  const recarga: Nav[] = [];
  const nova = iniciarNavegacao({role:'admin'},rota => recarga.push(rota.nav),janela);
  assert.deepEqual(recarga,['imports']);nova.parar();
  controlador.navegar('tickets','ID/1');
  assert.equal(janela.location.search,'?aba=chamados&chamado=ID%2F1');
  controlador.navegar('search');assert.equal(janela.location.search,'?aba=buscar','Trocar de aba remove chamado antigo');
  controlador.parar();const quantidade=vistas.length;janela.mover(-1);assert.equal(vistas.length,quantidade);
});
