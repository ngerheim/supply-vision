import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { mount } from './apoio/telas.mjs';
import * as navegacao from '../lib/navegacao.ts';
import * as historico from '../lib/navegacao-historico.ts';
import * as permissoes from '../lib/permissoes.ts';

const modulos = { '@/lib/navegacao':navegacao, '@/lib/navegacao-historico':historico, '@/lib/permissoes':permissoes,
  '@/lib/central-estado':{definirUsuarioCentral(){}} };
class Janela extends EventTarget {
  location;
  entradas;
  indice = 0;
  history = {pushState:(_state,_title,url) => { this.location=new URL(url,this.location);this.entradas.splice(++this.indice);this.entradas.push(this.location.href); }};
  constructor(query) { super();this.location=new URL(`http://portal.test/${query}`);this.entradas=[this.location.href]; }
  mover(deslocamento) {this.indice+=deslocamento;this.location=new URL(this.entradas[this.indice]);this.dispatchEvent(new Event('popstate'));}
}
async function abrir(t,role,query='') {
  const janela=new Janela(query);
  const tela=await mount('portal-app','default',{},modulos,{window:janela,URL});
  t.after(()=>tela.unmount());
  await setImmediate();
  tela.requests.find(r=>r.path==='/api/session').resolve({user:{id:'pessoa',name:'Pessoa',role}});
  await setImmediate();tela.render();await setImmediate();
  tela.requests.find(r=>r.path==='/api/bootstrap').resolve({user:{id:'pessoa',name:'Pessoa',role},catalogs:{}});
  await setImmediate();tela.render();await setImmediate();tela.render();
  return {tela,janela};
}
void test('Portal recarrega subaba do endereco; voltar e avancar mudam o conteudo e o menu',async t=>{
  const {tela,janela}=await abrir(t,'admin','?aba=cadastros&sub=catalogos');
  tela.one('Catalogs');assert.equal(tela.one('Sidebar').nav,'catalogs');
  assert.equal(tela.one('CabecalhoProvider').value.nav,'catalogs');
  tela.one('Sidebar').setNav('agreements');tela.render();
  assert.equal(janela.location.search,'?aba=acordos&sub=acordos');tela.one('Agreements');
  janela.mover(-1);tela.render();tela.one('Catalogs');
  janela.mover(1);tela.render();tela.one('Agreements');
});
void test('buscar abre acordo e importacao preserva acordo pre-selecionado; Central abre chamado',async t=>{
  const {tela,janela}=await abrir(t,'editor');
  tela.one('SearchPage').openAgreement('acordo-ficticio');tela.render();
  assert.equal(tela.one('AgreementDetail').id,'acordo-ficticio');
  assert.equal(janela.location.search,'?aba=acordos&sub=acordos');
  tela.one('AgreementDetail').onImport();tela.render();
  assert.equal(tela.one('Imports').initialAgreement,'acordo-ficticio');
  assert.equal(janela.location.search,'?aba=acordos&sub=importacoes');
  tela.one('Sidebar').navegarAviso('/?chamado=chamado-ficticio');tela.render();
  assert.equal(tela.one('Tickets').initialDetail,'chamado-ficticio');
  assert.equal(janela.location.search,'?aba=chamados&chamado=chamado-ficticio');
  tela.one('Sidebar').setNav('search');tela.render();
  assert.equal(janela.location.search,'?aba=buscar');tela.one('SearchPage');
});
void test('perfil consulta continua abrindo acordo pela busca, com acesso somente a consulta',async t=>{
  const {tela,janela}=await abrir(t,'viewer');
  tela.one('SearchPage').openAgreement('acordo-ficticio');tela.render();
  assert.equal(tela.one('AgreementDetail').id,'acordo-ficticio');
  assert.equal(tela.one('AgreementDetail').canWrite,false);
  assert.equal(janela.location.search,'?aba=buscar');
});
for(const [role,query,aviso] of [
  ['viewer','?aba=cadastros&sub=catalogos',navegacao.AVISO_AREA_RESTRITA],
  ['editor','?aba=administracao&sub=emails',navegacao.AVISO_AREA_RESTRITA],
  ['viewer','?chamado=ID',navegacao.AVISO_CHAMADO_RESTRITO],
]) void test(`Portal preserva aviso de acesso para ${String(role)} em ${String(query)}`,async t=>{
  const {tela}=await abrir(t,role,query);
  tela.one('SearchPage');assert.equal(tela.one('Sidebar').nav,'search');
  assert.ok(tela.find(n=>n.type==='output').some(n=>n.props.children.includes(aviso)));
});
void test('Portal abre detalhe pelo link legado sem alterar o endereco recebido',async t=>{
  const {tela,janela}=await abrir(t,'editor','?chamado=ID');
  assert.equal(tela.one('Tickets').initialDetail,'ID');assert.equal(janela.location.search,'?chamado=ID');
});

void test('subabas anunciam selecao e teclado percorre, retorna ao inicio e move o foco',async t=>{
  const navegadas=[], focadas=[];
  const tela=await mount('portal-subabas','Subabas',{nav:'suppliers',usuario:{role:'editor'},navegar:chave=>navegadas.push(chave)},modulos);
  t.after(()=>tela.unmount());
  tela.one('div',p=>p.role==='tablist');
  const tabs=()=>tela.find(n=>n.props?.role==='tab');
  assert.deepEqual(tabs().map(n=>n.props.children),['Fornecedores','Catálogos','De/Para']);
  assert.deepEqual(tabs().map(n=>n.props['aria-selected']),[true,false,false]);
  const elemento={parentElement:{querySelectorAll:()=>[0,1,2].map(indice=>({focus:()=>focadas.push(indice)}))}};
  const tecla=(indice,key)=>tabs()[indice].props.onKeyDown({key,preventDefault(){},currentTarget:elemento});
  tecla(0,'ArrowRight');tecla(0,'ArrowLeft');tecla(1,'Home');tecla(1,'End');tecla(2,'ArrowRight');
  assert.deepEqual(navegadas,['catalogs','mappings','suppliers','mappings','suppliers']);
  assert.deepEqual(focadas,[1,2,0,2,0]);
  tela.render({nav:'search',usuario:{role:'viewer'},navegar(){}});assert.equal(tela.find(()=>true).length,0);
});
