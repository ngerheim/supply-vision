import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { dataDeNegocio } from '../lib/data-negocio.ts';

// Sao Paulo esta em UTC-3 o ano todo desde o fim do horario de verao.
void test('o dia so vira a meia-noite de Sao Paulo, nao a de UTC', () => {
  assert.equal(dataDeNegocio(new Date('2026-09-22T23:59:00Z')), '2026-09-22'); // 20:59
  assert.equal(dataDeNegocio(new Date('2026-09-23T00:00:00Z')), '2026-09-22'); // 21:00
  assert.equal(dataDeNegocio(new Date('2026-09-23T02:59:59Z')), '2026-09-22'); // 23:59:59
  assert.equal(dataDeNegocio(new Date('2026-09-23T03:00:00Z')), '2026-09-23'); // 00:00
});

void test('virada de mes e de ano pelo calendario de Sao Paulo', () => {
  assert.equal(dataDeNegocio(new Date('2026-10-01T01:00:00Z')), '2026-09-30');
  assert.equal(dataDeNegocio(new Date('2027-01-01T02:30:00Z')), '2026-12-31');
});

void test('nenhuma consulta volta a usar o relogio UTC do SQLite', () => {
  const rota = readFileSync(resolve(import.meta.dirname, '../app/api/[...path]/route.ts'), 'utf8');
  assert.doesNotMatch(rota, /date\(\s*'now'/, "use date(?1) com dataDeNegocio() em vez de date('now')");
});
