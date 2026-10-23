import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { NextRequest } from 'vinext/shims/server';

void test('logo publico: arquivo privado, ausencia, seguranca e limite de 512 KiB, sem banco nem sessao', async t => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-marca-'));
  const anterior = process.env.SUPPLY_VISION_PRIVADO;
  process.env.SUPPLY_VISION_PRIVADO = pasta;
  const hooks = registerHooks({ resolve(s, c, next) {
    if (s === 'next/server') return next('vinext/shims/server', c);
    if (s.startsWith('@/')) return next(new URL(`../${s.slice(2)}.ts`, import.meta.url).href, c);
    if (s === './database') return next(new URL('../lib/database.ts', import.meta.url).href, c);
    return next(s, c);
  } });
  t.after(() => {
    hooks.deregister();
    if (anterior === undefined) delete process.env.SUPPLY_VISION_PRIVADO;
    else process.env.SUPPLY_VISION_PRIVADO = anterior;
    fs.rmSync(pasta, { recursive: true, force: true });
  });
  const { GET } = await import('../app/api/[...path]/route.ts');
  const { middleware } = await import('../middleware.ts');
  const request = () => new NextRequest('http://localhost/api/marca/logo');
  const headers = resposta => {
    assert.equal(resposta.headers.get('content-type'), 'image/svg+xml');
    assert.equal(resposta.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(resposta.headers.get('content-security-policy'), "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    assert.equal(resposta.headers.get('cache-control'), 'public, max-age=60');
  };
  const ausente = await GET(request());
  assert.equal(ausente.status, 404); headers(ausente);
  headers(middleware(request()));
  const destino = path.join(pasta, 'portal', 'marca', 'logo.svg');
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  // Arbitrary bytes exercise transport; no company or example logo is stored.
  const conteudo = Buffer.from('conteudo ficticio para testar transporte');
  fs.writeFileSync(destino, conteudo);
  const presente = await GET(request());
  assert.equal(presente.status, 200); headers(presente);
  assert.deepEqual(Buffer.from(await presente.arrayBuffer()), conteudo);
  fs.writeFileSync(destino, Buffer.alloc(512 * 1024, 32));
  const limite = await GET(request());
  assert.equal(limite.status, 200);
  assert.equal((await limite.arrayBuffer()).byteLength, 512 * 1024);
  fs.appendFileSync(destino, 'x');
  const excessivo = await GET(request());
  assert.equal(excessivo.status, 413); headers(excessivo);
  assert.equal((await excessivo.arrayBuffer()).byteLength, 0);
  assert.equal(fs.existsSync(path.join(pasta, 'portal', 'banco')), false);
});
