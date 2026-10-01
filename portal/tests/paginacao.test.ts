import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paginacao, paginaEfetiva } from '../lib/paginacao.ts';
void test('paginação valida e calcula intervalos sem sobreposição', () => {
  assert.deepEqual(paginacao(new URLSearchParams()), {
    page: 1,
    pageSize: 25,
    offset: 0,
  });
  assert.deepEqual(paginacao(new URLSearchParams('page=3&pageSize=50')), {
    page: 3,
    pageSize: 50,
    offset: 100,
  });
  for (const query of [
    'page=0',
    'page=-1',
    'page=1.5',
    'page=Infinity',
    'page=1000001',
    'pageSize=1000',
  ])
    assert.throws(() => paginacao(new URLSearchParams(query)));
});
void test('remoção do último registro retorna a uma página existente', () => {
  assert.equal(paginaEfetiva(3, 25, 50), 2);
  assert.equal(paginaEfetiva(3, 25, 0), 1);
  assert.equal(paginaEfetiva(2, 25, 51), 2);
});
