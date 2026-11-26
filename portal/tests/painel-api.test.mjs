import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextResponse } from 'vinext/shims/server';
import { painelApi } from '../lib/painel-api.ts';

const contexto = () => {
  const auditorias = [];
  return {
    auditorias,
    ok: (dados, init) => NextResponse.json(dados, init),
    fail: (error, status = 400) => NextResponse.json({ error }, { status }),
    audit: async (...args) => { auditorias.push(args); },
    NextResponse,
  };
};
const editor = { id: 'u1', role: 'editor' }, viewer = { id: 'u2', role: 'viewer' };

void test('painel: sem arquivo avisa indisponível; com arquivo devolve os números como estão', async t => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-painel-'));
  t.after(() => fs.rmSync(pasta, { recursive: true, force: true }));
  const ctx = contexto(), api = painelApi(ctx, pasta);
  assert.deepEqual(await (await api.dados(editor)).json(), { disponivel: false });
  assert.equal((await api.dados(viewer)).status, 403);
  fs.writeFileSync(path.join(pasta, 'painel.json'), JSON.stringify({ versao: 1, resumo: { indice: 95.5 } }));
  assert.deepEqual(await (await api.dados(editor)).json(), { disponivel: true, versao: 1, resumo: { indice: 95.5 } });
});

void test('painel: baixar base exige permissão, registra no Histórico e entrega o zip', async t => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-painel-'));
  t.after(() => fs.rmSync(pasta, { recursive: true, force: true }));
  const ctx = contexto(), api = painelApi(ctx, pasta);
  assert.equal((await api.base(editor)).status, 404);
  fs.writeFileSync(path.join(pasta, 'painel_base.zip'), Buffer.from('PK\x03\x04conteudo'));
  assert.equal((await api.base(viewer)).status, 403);
  assert.equal(ctx.auditorias.length, 0);
  const resposta = await api.base(editor);
  assert.equal(resposta.status, 200);
  assert.equal(resposta.headers.get('content-type'), 'application/zip');
  assert.match(resposta.headers.get('content-disposition'), /^attachment; filename="painel-base-\d{4}-\d{2}-\d{2}\.zip"$/);
  assert.equal(Buffer.from(await resposta.arrayBuffer()).toString('latin1'), 'PK\x03\x04conteudo');
  assert.equal(ctx.auditorias.length, 1);
  assert.equal(ctx.auditorias[0][1], 'EXPORT');
});
