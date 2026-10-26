import assert from 'node:assert/strict';
import test from 'node:test';
import * as datas from '../lib/data-brasileira.ts';
import { mount } from './apoio/telas.mjs';

void test('data mascarada valida calendario e conserva somente ISO no callback', async t => {
  const values = [];
  const props = {value:'2026-10-23',onChange:iso => values.push(iso)};
  const tela = await mount('campo-data','CampoData',props,{'@/lib/data-brasileira':datas});
  t.after(() => tela.unmount());
  assert.equal(tela.one('Input').type,'text');
  assert.equal(tela.one('Input').value,'23/10/2026');
  let validity = '';
  const change = value => {tela.one('Input').onChange({target:{value,setCustomValidity:error => {validity=error;}}});tela.render();};
  change('29022025');
  assert.equal(tela.one('Input').value,'29/02/2025');
  assert.equal(tela.one('Input')['aria-invalid'],true);
  assert.match(validity,/dd\/mm\/aaaa/);
  assert.deepEqual(values,[]);
  change('29022024');
  assert.equal(validity,'');
  assert.deepEqual(values,['2024-02-29']);
  tela.render({...props,value:values[0]});
  assert.equal(tela.one('Input').value,'29/02/2024');
  change('');
  assert.deepEqual(values,['2024-02-29','']);
  tela.render({...props,value:'2026-12-31'});
  assert.equal(tela.one('Input').value,'31/12/2026');
});

void test('data mascarada preserva obrigatoriedade e inicio minimo da vigencia', async t => {
  const values = [];
  const tela = await mount('campo-data','CampoData',{value:'',required:true,min:'2026-10-23',onChange:iso => values.push(iso)},{'@/lib/data-brasileira':datas});
  t.after(() => tela.unmount());
  let validity='';
  tela.one('Input').ref({setCustomValidity:error => {validity=error;}});
  assert.equal(validity,'Informe a data.');
  tela.one('Input').onChange({target:{value:'22102026',setCustomValidity:error => {validity=error;}}});
  assert.match(validity,/23\/10\/2026/);
  assert.deepEqual(values,[]);
  tela.render();
  tela.one('Input').onChange({target:{value:'23102026',setCustomValidity:error => {validity=error;}}});
  assert.equal(validity,'');
  assert.deepEqual(values,['2026-10-23']);
});
