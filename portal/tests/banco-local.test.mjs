import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { localizarBanco } from '../scripts/banco-local.mjs';

void test('recusa banco ambíguo em vez de escolher o primeiro arquivo', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'banco-local-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  assert.equal(localizarBanco(null, base), null);
  const pasta = path.join(base, 'banco/estado/state/v3/d1/miniflare-D1DatabaseObject');
  fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(path.join(pasta, 'metadata.sqlite'), '');
  assert.throws(() => localizarBanco(null, base), /único banco/);
  const banco = path.join(pasta, 'a.sqlite');
  fs.writeFileSync(banco, '');
  assert.equal(localizarBanco(null, base), banco);
  fs.writeFileSync(path.join(pasta, 'b.sqlite'), '');
  assert.throws(() => localizarBanco(null, base), /único banco/);
});
