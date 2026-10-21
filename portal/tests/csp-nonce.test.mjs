import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { NextRequest } from 'vinext/shims/server';
import { CABECALHOS_SEGURANCA } from '../lib/cabecalhos-seguranca.ts';

const hook = registerHooks({ resolve(s, c, next) {
  if (s === 'next/server') return next('vinext/shims/server', c);
  if (s === '@/lib/cabecalhos-seguranca') return next(new URL('../lib/cabecalhos-seguranca.ts', import.meta.url).href, c);
  return next(s, c);
} });
const { middleware } = await import('../middleware.ts');
hook.deregister();

void test('CSP usa nonce novo por requisicao e o transmite ao renderizador', () => {
  const a = middleware(new NextRequest('http://fixture/'));
  const b = middleware(new NextRequest('http://fixture/'));
  const csp = a.headers.get('content-security-policy');
  const script = csp.split(';').find(d => d.trim().startsWith('script-src'));
  assert.doesNotMatch(script, /unsafe-inline/);
  assert.match(script, /'nonce-[A-Za-z0-9+/=_-]+'/);
  assert.notEqual(csp, b.headers.get('content-security-policy'));
  assert.equal(a.headers.get('x-middleware-request-content-security-policy'), csp);
  assert.doesNotMatch(CABECALHOS_SEGURANCA['Content-Security-Policy'].split(';').find(d => d.trim().startsWith('script-src')), /unsafe-inline/);
});
