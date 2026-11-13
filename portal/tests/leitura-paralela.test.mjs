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
  let db = new DatabaseSync(arquivo);
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
  // A thread fecha a conexao a cada pedido: o arquivo pode ser renomeado
  // (no Windows, falha com EPERM se ainda estiver aberto) e sem arquivo nao ha thread.
  db.close();
  if (process.platform === 'linux') {
    const abertos = fs.readdirSync('/proc/self/fd').map(fd => { try { return fs.readlinkSync(`/proc/self/fd/${fd}`); } catch { return ''; } });
    assert.equal(abertos.some(alvo => alvo.startsWith(arquivo)), false, 'a thread deixou o banco aberto');
  }
  fs.renameSync(arquivo, `${arquivo}.movido`); fs.renameSync(`${arquivo}.movido`, arquivo);
  db = new DatabaseSync(arquivo);
  await assert.rejects(lerEmParalelo(undefined, 'SELECT 1'), /sem arquivo/);
});

void test('pedido lento vai para o log sem a busca da URL', () => {
  const linhas = [];
  assert.equal(registrarPedidoLento('GET', '/api/internal/agreements?token=segredo', 200, 1999, l => linhas.push(l)), false);
  assert.equal(registrarPedidoLento('GET', '/api/internal/agreements?token=segredo', 200, 12345.6, l => linhas.push(l)), true);
  assert.deepEqual(linhas, ['[portal] pedido lento: GET /api/internal/agreements 200 12346 ms']);
});
