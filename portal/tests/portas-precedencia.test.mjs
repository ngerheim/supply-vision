import assert from 'node:assert/strict';
import test from 'node:test';
import { verificarSaude } from '../scripts/saude-completa.mjs';

void test('saude segue porta do ambiente como a partida', async t => {
  const antes = process.env.PORTAL_PORTA;
  process.env.PORTAL_PORTA = '45678';
  t.after(() => { if (antes === undefined) delete process.env.PORTAL_PORTA; else process.env.PORTAL_PORTA = antes; });
  t.mock.method(globalThis, 'fetch', async url => {
    const u = new URL(url);
    assert.equal(u.port, '45678');
    if (u.pathname === '/api/health') return Response.json({ app: 'portal-suprimentos', status: 'ok' });
    if (u.pathname === '/api/login') return Response.json({ error: 'fixture' }, { status: 401 });
    if (u.pathname === '/') return new Response('<script src="/a.js"></script><link href="/a.css">', { headers: { 'content-type': 'text/html' } });
    return new Response('fixture', { headers: { 'content-type': u.pathname.endsWith('.css') ? 'text/css' : 'text/javascript' } });
  });
  await verificarSaude();
});
