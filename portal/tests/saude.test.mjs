import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { verificarSaude } from '../scripts/saude-completa.mjs';

for (const caso of ['normal', 'js-ausente', 'html-no-css', 'api-alheia']) {
  test(`saude completa: ${caso}`, async () => {
    const servidor = createServer((req, res) => {
      if (req.url === '/api/health') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ app: caso === 'api-alheia' ? 'outro' : 'portal-suprimentos', status: 'ok' }));
      } else if (req.url === '/') {
        res.setHeader('Content-Type', 'text/html');
        res.end('<link href="/estilo.css"><script src="/app.js"></script>');
      } else if (req.url === '/app.js') {
        res.statusCode = caso === 'js-ausente' ? 404 : 200;
        res.setHeader('Content-Type', 'application/javascript');
        res.end('console.log(1)');
      } else {
        res.setHeader('Content-Type', caso === 'html-no-css' ? 'text/html' : 'text/css');
        res.end('body {}');
      }
    });
    await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
    try {
      const base = `http://127.0.0.1:${servidor.address().port}`;
      if (caso === 'normal') assert.match(await verificarSaude(base), /2 arquivos/);
      else await assert.rejects(verificarSaude(base));
    } finally { servidor.closeAllConnections(); await new Promise(resolve => servidor.close(resolve)); }
  });
}
