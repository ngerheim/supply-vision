import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { iniciarServidorFixture } from '../scripts/porta-teste.mjs';
import { verificarSaude } from '../scripts/saude-completa.mjs';
import { cabecalhosComNonce } from '../lib/cabecalhos-seguranca.ts';

const outDir = path.resolve(import.meta.dirname, '../dist');
void test('build real renderiza scripts com nonce e passa fumaca local', { skip: !fs.existsSync(path.join(outDir, 'server/index.js')) }, async t => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-csp-fumaca-'));
  const parar = path.join(pasta, 'parar');
  const runtime = await iniciarServidorFixture(outDir, { ...process.env, SUPPLY_VISION_PRIVADO: pasta,
    MODO_ENSAIO: '1', PORTAL_CRIAR_BANCO: '1', INITIAL_ADMIN_PASSWORD: 'senha-ficticia-csp-123' }, parar);
  t.after(async () => {
    if (runtime.filho.exitCode === null) {
      const fim = new Promise(r => runtime.filho.once('exit', r)); fs.writeFileSync(parar, 'parar'); await fim;
    }
    fs.rmSync(pasta, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${runtime.porta}`;
  const nonces = [];
  for (let i = 0; i < 2; i++) {
    const headersCsp = await new Promise((resolve, reject) => {
      http.get(base, resposta => {
        const valores = resposta.rawHeaders.filter((_, indice) => indice % 2 === 1 && resposta.rawHeaders[indice - 1].toLowerCase() === 'content-security-policy');
        resposta.resume(); resposta.on('end', () => resolve(valores));
      }).on('error', reject);
    });
    assert.equal(headersCsp.length, 1, `HTML deve ter uma unica CSP: ${JSON.stringify(headersCsp)}`);
    assert.match(headersCsp[0], /'nonce-[^']+'/);
    const nonceHttp = headersCsp[0].match(/'nonce-([^']+)'/)[1];
    assert.equal(headersCsp[0], cabecalhosComNonce(nonceHttp)['Content-Security-Policy'], 'Sem politica adicional, mesmo combinada na mesma linha HTTP');
    const r = await fetch(base, { headers: { 'content-security-policy': "script-src 'nonce-forjado'" } });
    assert.equal(r.status, 200, runtime.log);
    const csp = r.headers.get('content-security-policy');
    const nonce = csp?.match(/'nonce-([^']+)'/)?.[1];
    assert.ok(nonce); assert.notEqual(nonce, 'forjado'); nonces.push(nonce);
    const scripts = [...(await r.text()).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    assert.ok(scripts.some(s => s[2].trim()), 'A pagina deve conter scripts inline do runtime');
    for (const script of scripts.filter(s => s[2].trim())) assert.match(script[1], new RegExp(`nonce="${nonce}"`));
    assert.doesNotMatch(csp.split(';').find(d => d.trim().startsWith('script-src')), /unsafe-inline/);
  }
  assert.notEqual(nonces[0], nonces[1]);
  assert.match(await verificarSaude(base), /saudaveis/);
});
