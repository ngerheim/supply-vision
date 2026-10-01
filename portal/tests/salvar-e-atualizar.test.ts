import assert from 'node:assert/strict';
import test from 'node:test';
import { salvarEAtualizar } from '../lib/salvar-e-atualizar.ts';

void test('falha na recarga após salvar preserva confirmação e não repete escrita', async () => {
  const events: string[] = [];
  const result = await salvarEAtualizar(async () => { events.push('save'); return 42; },
    async () => { events.push('refresh'); throw new Error('offline'); },
    () => events.push('saved'), () => events.push('refresh-error'));
  assert.equal(result, 42);
  assert.deepEqual(events, ['save', 'saved', 'refresh', 'refresh-error']);
});
void test('falha ao salvar não confirma sucesso nem recarrega', async () => {
  const unexpected = () => { assert.fail('não deve ser executado'); };
  await assert.rejects(salvarEAtualizar(async () => { throw new Error('save-error'); }, unexpected, unexpected, unexpected), /save-error/);
});
