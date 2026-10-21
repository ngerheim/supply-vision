import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { localizarBanco, diretorioBanco, destinoBanco } from '../scripts/banco-local.mjs';

void test('recusa banco ambíguo em vez de escolher o primeiro arquivo', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'banco-local-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  assert.equal(localizarBanco(null, base), null);
  const pasta = diretorioBanco(base);
  assert.equal(path.relative(base,pasta).split(path.sep).join('/'),'banco/estado/state/v3/d1/miniflare-D1DatabaseObject');
  fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(path.join(pasta, 'metadata.sqlite'), '');
  assert.equal(localizarBanco(null, base), null);
  const banco = path.join(pasta, 'a.sqlite');
  fs.writeFileSync(banco, '');
  assert.equal(localizarBanco(null, base), banco);
  fs.writeFileSync(path.join(pasta, 'b.sqlite'), '');
  assert.throws(() => localizarBanco(null, base), /ambiguo/);
});

void test('bancos auxiliares e backups nao participam da descoberta do arquivo operacional', t => {
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'sv-localizador-'));
  t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  fs.mkdirSync(path.join(base,'backups'),{recursive:true});
  for(const nome of ['restauracao.lock.sqlite','backup.lock.sqlite','backups/portal-atual.sqlite'])fs.writeFileSync(path.join(base,nome),'auxiliar');
  assert.equal(localizarBanco(null,base),null);
  const novo=localizarBanco(null,base,{criar:true});
  assert.equal(novo,destinoBanco('portal.sqlite',base));
  assert.equal(fs.existsSync(novo),false,'Resolver caminho nao deve criar banco vazio');
  fs.mkdirSync(path.dirname(novo),{recursive:true});fs.writeFileSync(novo,'operacional');
  assert.equal(localizarBanco(null,base),novo);
  assert.throws(()=>destinoBanco('../fora.sqlite',base),/invalido/);
  assert.throws(()=>destinoBanco('metadata.sqlite',base),/invalido/);
});
