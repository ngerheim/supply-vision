import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { conexao, ipConexao } from '../scripts/ip-conexao.mjs';
void test('IP pertence ao contexto da conexao e nao vaza entre requisicoes', async () => {
  const valores=await Promise.all(['::1','127.0.0.1'].map(ip=>conexao.run(ip,async()=>{
    await setImmediate();return ipConexao();
  })));
  assert.deepEqual(valores,['::1','127.0.0.1']);assert.equal(ipConexao(),'local');
});
