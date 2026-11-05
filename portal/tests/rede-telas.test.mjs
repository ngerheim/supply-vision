import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { mount } from './apoio/telas.mjs';
import * as cliente from '../lib/solicitacoes-cliente.ts';

const modulos = { '@/lib/solicitacoes-cliente': cliente };
const flush = async h => { await setImmediate(); h.render(); };
const texto = n => Array.isArray(n) ? n.map(texto).join('') : typeof n === 'string' || typeof n === 'number' ? String(n) : n?.props ? texto(n.props.children) : '';
const linha = (codigo, mesmaCidade, extra) => ({ codigo, nome: `Oficina ${codigo}`, razaoSocial: null, cidade: 'Cidade', uf: 'MG', distanciaKm: mesmaCidade ? 0 : 18,
  mesmaCidade, segmentos: ['Mecânica Automotiva'], telefone: null, email: null, cnpj: null, ultimoPedido: '2026-10-28', acordos: [], ...extra });
const resposta = (extra) => ({ linhas: [linha('1', true, { acordos: ['AC-1'] }), linha('2', false)], total: 2, pagina: 1, paginas: 1, raio: 100,
  cidade: { id: '3106200', nome: 'Belo Horizonte/MG' }, naCidade: 1, proximas: 1, segmentos: [{ nome: 'Mecânica Automotiva', total: 2 }],
  atualizacao: { recebidaEm: '2026-11-05T11:00:00Z', linhas: 2 }, ...extra });

void test('Rede: cidade escolhida pede raio, separa cidade e proximas e destaca acordo', async t => {
  const execucoes = [];
  const run = async (acao, mensagem) => { execucoes.push(mensagem); await acao(); };
  const tela = await mount('portal-rede', 'Rede', { podeGerenciar: true, busy: false, run }, modulos,
    { window: { prompt: () => 'Uso do financeiro' } });
  t.after(() => tela.unmount());
  assert.deepEqual(tela.requests.map(r => r.path), ['/api/rede/cidades', '/api/rede?pagina=1']);
  tela.requests[0].resolve({ cidades: [{ id: '3106200', name: 'Belo Horizonte/MG' }] });
  tela.requests[1].resolve(resposta({ cidade: null, naCidade: 0, proximas: 0 }));
  await flush(tela);
  assert.equal(tela.one('SearchSelect').options.length, 1);

  tela.one('SearchSelect').onChange('3106200');
  tela.render();
  assert.equal(tela.requests.at(-1).path, '/api/rede?pagina=1&cidade=3106200&raio=100');
  tela.requests.at(-1).resolve(resposta());
  await flush(tela);
  const corpo = texto(tela.find(n => n.type === 'TableBody'));
  assert.ok(corpo.indexOf('Em Belo Horizonte/MG') < corpo.indexOf('Oficina 1'));
  assert.ok(corpo.indexOf('Oficina 1') < corpo.indexOf('Cidades próximas · até 100 km'));
  assert.ok(corpo.includes('~18 km'));
  assert.deepEqual(tela.find(n => n.props?.acordos?.length).map(n => n.props.acordos), [['AC-1']]);
  assert.match(tela.one('TabelaPadrao').contador, /1 fornecedor em Belo Horizonte\/MG · 1 em cidade próxima \(até 100 km\)/);

  tela.one('Button', p => p['aria-label'] === 'Desconsiderar Oficina 2').onClick();
  await setImmediate();
  const pedido = tela.requests.find(r => r.path === '/api/rede/exclusoes/fornecedores');
  assert.deepEqual(JSON.parse(pedido.options.body), { codigo: '2', motivo: 'Uso do financeiro' });
  pedido.resolve({ success: true });
  await flush(tela);
  assert.deepEqual(execucoes, ['Fornecedor desconsiderado na Rede.']);
  assert.equal(tela.requests.at(-1).path, '/api/rede?pagina=1&cidade=3106200&raio=100');
});

void test('Rede: sem permissao de gestao nao mostra o botao; sem copia avisa', async t => {
  const tela = await mount('portal-rede', 'Rede', { podeGerenciar: false, busy: false, run: () => {} }, modulos);
  t.after(() => tela.unmount());
  tela.requests[1].resolve(resposta());
  await flush(tela);
  assert.equal(tela.find(n => n.type === 'Button' && String(n.props['aria-label']).startsWith('Desconsiderar')).length, 0);
  tela.one('Button', p => p['aria-label'] === 'Atualizar').onClick();
  tela.render();
  tela.requests.at(-1).resolve(resposta({ atualizacao: null, linhas: [] }));
  await flush(tela);
  assert.match(texto(tela.find(n => n.type === 'p')), /ainda não foi carregada/);
});
