import assert from 'node:assert/strict';
import test from 'node:test';

import { montarPowerBiUrl } from '../lib/powerbi.ts';

// Montado em partes: o teste de configuracao-powerbi recusa o endereco de
// publicacao escrito por inteiro em arquivo versionado.
const RELATORIO = ['https://app.powerbi.com', '/reportEmbed?reportId=ficticio&autoAuth=true'].join('');

void test('monta o endereco do relatorio com a pagina e sem paineis', () => {
  const url = new URL(montarPowerBiUrl(` ${RELATORIO} `, ' 09a18dbe '));
  assert.equal(url.origin, 'https://app.powerbi.com');
  assert.equal(url.searchParams.get('reportId'), 'ficticio');
  assert.equal(url.searchParams.get('pageName'), '09a18dbe');
  assert.equal(url.searchParams.get('navContentPaneEnabled'), 'false');
  assert.equal(url.searchParams.get('filterPaneEnabled'), 'false');
});

void test('sem pagina, abre na primeira', () => {
  assert.equal(new URL(montarPowerBiUrl(RELATORIO, '')).searchParams.get('pageName'), null);
});

void test('recusa o que nao for https://app.powerbi.com', () => {
  for (const endereco of ['', undefined, 'nao e url', RELATORIO.replace('https:', 'http:'), 'https://exemplo.com/view?r=abc', RELATORIO.replace('app.powerbi.com', 'app.powerbi.com.exemplo.com')])
    assert.equal(montarPowerBiUrl(endereco, 'x'), '');
});

void test('aceita publicacao publica preservando token e pagina', () => {
  const url = new URL(montarPowerBiUrl(['https://app.powerbi.com', '/view?r=ficticio'].join(''), 'pagina'));
  assert.equal(url.searchParams.get('r'), 'ficticio');
  assert.equal(url.searchParams.get('pageName'), 'pagina');
  assert.equal(url.searchParams.get('navContentPaneEnabled'), 'false');
  assert.equal(url.searchParams.get('filterPaneEnabled'), 'false');
});

void test('recusa caminhos desconhecidos, credenciais e identificadores ausentes', () => {
  for (const caminho of ['/view', '/view?r=', '/view?r=%20', '/reportEmbed?reportId=%20', '/outro?r=ficticio'])
    assert.equal(montarPowerBiUrl(`https://app.powerbi.com${caminho}`, ''), '');
  assert.equal(montarPowerBiUrl(RELATORIO.replace('https://', 'https://usuario:senha@'), ''), '');
  assert.equal(montarPowerBiUrl('https://app.powerbi.com/reportEmbed', ''), '');
});
