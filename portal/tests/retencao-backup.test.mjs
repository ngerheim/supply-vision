import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { guardarNoHistorico, listarHistorico, nomeDoDia, podarHistorico } from '../scripts/retencao-backup.mjs';

function pastaTemporaria() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'retencao-'));
}
function dia(texto) {
  const [a, m, d] = texto.split('-').map(Number);
  return new Date(a, m - 1, d, 14, 30);
}

test('guarda a copia do dia e regrava no mesmo dia', () => {
  const base = pastaTemporaria(), origem = path.join(base, 'portal-atual.sqlite');
  fs.writeFileSync(origem, 'manha');
  guardarNoHistorico(base, origem, dia('2026-09-22'));
  fs.writeFileSync(origem, 'tarde');
  const { destino } = guardarNoHistorico(base, origem, dia('2026-09-22'));
  assert.equal(path.basename(destino), 'portal-2026-09-22.sqlite');
  assert.equal(fs.readFileSync(destino, 'utf8'), 'tarde');
  assert.deepEqual(listarHistorico(base).map((item) => item.dia), ['2026-09-22']);
  assert.ok(!fs.readdirSync(path.join(base, 'historico')).some((nome) => nome.endsWith('.tmp')));
});

test('mantem 7 dias, incluindo hoje, atravessando a virada do mes', () => {
  const base = pastaTemporaria(), origem = path.join(base, 'portal-atual.sqlite');
  fs.writeFileSync(origem, 'x');
  for (let n = 0; n < 12; n++) guardarNoHistorico(base, origem, new Date(2026, 8, 25 + n, 9));
  // 25/09 + 11 dias = 06/10; ficam de 30/09 a 06/10.
  assert.deepEqual(listarHistorico(base).map((item) => item.dia), [
    '2026-10-06', '2026-10-05', '2026-10-04', '2026-10-03', '2026-10-02', '2026-10-01', '2026-09-30',
  ]);
});

test('nao toca em arquivos fora do padrao', () => {
  const base = pastaTemporaria(), pasta = path.join(base, 'historico');
  fs.mkdirSync(pasta);
  for (const nome of ['portal-2020-01-01.sqlite', 'pre-restauracao-2020.sqlite', 'anotacoes.txt', 'portal-2020-01-01.sqlite.bak'])
    fs.writeFileSync(path.join(pasta, nome), 'x');
  assert.deepEqual(podarHistorico(base, dia('2026-09-22')), ['portal-2020-01-01.sqlite']);
  assert.deepEqual(fs.readdirSync(pasta).sort(), ['anotacoes.txt', 'portal-2020-01-01.sqlite.bak', 'pre-restauracao-2020.sqlite']);
});

test('usa a data local da maquina', () => {
  assert.equal(nomeDoDia(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.equal(nomeDoDia(new Date(2026, 11, 31, 0, 1)), '2026-12-31');
});
