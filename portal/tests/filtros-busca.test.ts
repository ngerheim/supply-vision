import assert from 'node:assert/strict';
import test from 'node:test';
import { condicoesBusca, filtrosVazios, parametrosBusca } from '../lib/filtros-busca.ts';

void test('múltiplas opções usam OR no campo e AND entre campos, com parâmetros vinculados', () => {
  const filters = { ...filtrosVazios(), item: ['freio', 'pneu'], state: ['sp', 'RJ'], supplier: ["x' OR 1=1 --"] };
  const params = parametrosBusca(filters);
  assert.deepEqual(params.getAll('item'), ['freio', 'pneu']);
  const result = condicoesBusca(params);
  assert.equal(result.conditions.join(' AND '), 'l.state IN (?,?) AND ci.id IN (?,?) AND s.id IN (?)');
  assert.deepEqual(result.values, ['SP', 'RJ', 'freio', 'pneu', "x' OR 1=1 --"]);
});
void test('busca mantém compatibilidade com filtro único e ignora valores vazios e duplicados', () => {
  assert.deepEqual(condicoesBusca(new URLSearchParams('item=a&item=a&item=&model=b')), {
    conditions: ['ci.id IN (?)', 'vm.id IN (?)'], values: ['a', 'b'],
  });
  assert.deepEqual(condicoesBusca(parametrosBusca(filtrosVazios())), { conditions: [], values: [] });
});
void test('limita parâmetros totais e tamanho sem truncar silenciosamente', () => {
  const filters = { ...filtrosVazios(), item: Array.from({ length: 80 }, (_, i) => String(i)) };
  assert.equal(condicoesBusca(parametrosBusca(filters)).values.length, 80);
  filters.model = ['extra'];
  assert.throws(() => condicoesBusca(parametrosBusca(filters)), /no máximo 80/);
  assert.throws(() => condicoesBusca(new URLSearchParams({ item: 'a'.repeat(201) })), /muito longo/);
});
