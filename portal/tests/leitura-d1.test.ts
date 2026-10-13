import assert from 'node:assert/strict';
import test from 'node:test';
import { leituraD1 } from '../lib/leitura-d1.ts';
import { consultasOpcoesBusca } from '../lib/consulta-busca.ts';
const interno = new Error('D1_ERROR: Failed to get session commit token: internal error');

void test('opcoes em Promise.all: D1 interno na primeira leitura, segunda ok e log sem SQL/dados', async t => {
  const avisos: unknown[][] = [];
  t.mock.method(console, 'warn', (...args: unknown[]) => { avisos.push(args); });
  const consultas = consultasOpcoesBusca(new URLSearchParams(), '2026-10-13');
  let chamadas = 0;
  const resultados = await Promise.all(Object.values(consultas).map(consulta => leituraD1(consulta.sql, async () => {
    chamadas++;
    if (chamadas === 1) throw interno;
    return ['opcao sintetica'];
  })));
  assert.equal(chamadas, Object.keys(consultas).length + 1);
  assert.ok(resultados.every(r => r[0] === 'opcao sintetica'));
  assert.equal(avisos.length, 1);
  assert.match(String(avisos[0]), /nova tentativa unica/);
  assert.doesNotMatch(String(avisos[0]), /SELECT|opcao sintetica/);
});

void test('D1 persistente repete somente uma vez', async t => {
  t.mock.method(console, 'warn', () => {});
  let chamadas = 0;
  await assert.rejects(leituraD1('SELECT 1', async () => { chamadas++; throw interno; }), e => e === interno);
  assert.equal(chamadas, 2);
});

for (const sql of ['INSERT INTO x VALUES (1) RETURNING id', 'UPDATE x SET id=2', 'DELETE FROM x', 'CREATE TABLE x(id)', 'WITH x AS (SELECT 1) INSERT INTO y SELECT * FROM x']) {
  void test(`nao repete escrita: ${sql}`, async () => {
    let chamadas = 0;
    await assert.rejects(leituraD1(sql, async () => { chamadas++; throw interno; }), e => e === interno);
    assert.equal(chamadas, 1);
  });
}
void test('outro erro D1 nao e repetido', async () => {
  let chamadas = 0;
  const erro = new Error('D1_ERROR: no such table');
  await assert.rejects(leituraD1('SELECT 1', async () => { chamadas++; throw erro; }), e => e === erro);
  assert.equal(chamadas, 1);
});
