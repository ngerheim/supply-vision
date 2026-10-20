import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { requisitar } from '../scripts/cliente-http.mjs';

void test('cliente HTTP decodifica UTF-8 entre blocos e conclui resposta interrompida', { timeout: 5000 }, async t => {
  const servidor = createServer((req, res) => {
    if (req.url === '/interrompida') {
      res.writeHead(200, { 'Content-Length': '100' });
      res.write('incompleta');
      setImmediate(() => res.destroy());
    } else {
      const bytes = Buffer.from('ação');
      res.write(bytes.subarray(0, 2));
      setImmediate(() => res.end(bytes.subarray(2)));
    }
  });
  await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    servidor.closeAllConnections();
    await new Promise(resolve => servidor.close(resolve));
  });
  const porta = servidor.address().port;
  assert.equal((await requisitar({ metodo: 'GET', caminho: '/', porta })).corpo, 'ação');
  const falha = await requisitar({ metodo: 'GET', caminho: '/interrompida', porta });
  assert.equal(falha.status, 0);
  assert.equal(falha.corpo, '');
  assert.equal(typeof falha.erro, 'string');
});
