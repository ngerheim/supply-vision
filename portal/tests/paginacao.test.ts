import assert from 'node:assert/strict';
import test from 'node:test';
import { paginaSolicitada } from '../lib/paginacao.ts';

void test('paginacao nunca produz LIMIT/OFFSET fracionario ou nao finito', () => {
  for (const value of ['1.5','Infinity','NaN','-2','0','9007199254740992']) {
    assert.deepEqual(paginaSolicitada(new URLSearchParams({page:value,pageSize:value})),{page:1,pageSize:50});
  }
  assert.deepEqual(paginaSolicitada(new URLSearchParams({page:'3',pageSize:'999'})),{page:3,pageSize:200});
  assert.deepEqual(paginaSolicitada(new URLSearchParams({pageSize:'1'})),{page:1,pageSize:10});
});
