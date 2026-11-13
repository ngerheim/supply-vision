import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { encerrarLeituraParalela, lerEmParalelo, lerJsonEmParalelo } from '../lib/leitura-paralela.ts';
import { registrarPedidoLento } from '../scripts/servidor-node.mjs';

void test('leitura paralela: mesma resposta, so leitura, erro volta para quem pediu', async (t) => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-leitura-paralela-')), arquivo = path.join(pasta, 'portal.sqlite');
  const db = new DatabaseSync(arquivo);
  t.after(async () => { await encerrarLeituraParalela(); db.close(); fs.rmSync(pasta, { recursive: true, force: true }); });
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE t(id INTEGER PRIMARY KEY, nome TEXT); INSERT INTO t(nome) VALUES('a'),('b'),('c')");
  assert.equal(JSON.stringify(await lerEmParalelo(arquivo, 'SELECT id,nome FROM t WHERE id>? ORDER BY id', [1])), JSON.stringify(db.prepare('SELECT id,nome FROM t WHERE id>1 ORDER BY id').all()));
  assert.equal(await lerJsonEmParalelo(arquivo, [{ sql: 'SELECT COUNT(*) n FROM t' }, { sql: 'SELECT nome FROM t WHERE id=?', valores: [3] }]), '[[{"n":3}],[{"nome":"c"}]]');
  // A thread nao escreve: a conexao dela e somente leitura.
  await assert.rejects(lerEmParalelo(arquivo, "INSERT INTO t(nome) VALUES('x')"), /readonly|read-only|query_only/i);
  await assert.rejects(lerEmParalelo(arquivo, 'SELECT * FROM inexistente'), /no such table/);
  // Escrita na conexao principal enquanto a thread existe: a proxima leitura ve o dado.
  db.exec("INSERT INTO t(nome) VALUES('d')");
  assert.equal((await lerEmParalelo(arquivo, 'SELECT COUNT(*) n FROM t'))[0].n, 4);
});

void test('pedido lento vai para o log sem a busca da URL', () => {
  const linhas = [];
  assert.equal(registrarPedidoLento('GET', '/api/internal/agreements?token=segredo', 200, 1999, l => linhas.push(l)), false);
  assert.equal(registrarPedidoLento('GET', '/api/internal/agreements?token=segredo', 200, 12345.6, l => linhas.push(l)), true);
  assert.deepEqual(linhas, ['[portal] pedido lento: GET /api/internal/agreements 200 12346 ms']);
});
