import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { criarTemporarioTeste } from './apoio/ambiente.mjs';
import { nomeBackup, listarHistorico, podarHistorico, DIAS_RETENCAO } from '../scripts/retencao-backup.mjs';
void test('retencao de 14 dias por horario remove somente arquivos regulares do proprio padrao', t => {
  const dir = criarTemporarioTeste('sv-retencao-'); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const agora = new Date(2026, 9, 16, 13, 30);
  const corte = new Date(agora.getTime() - DIAS_RETENCAO * 86400_000);
  for (const data of [agora, corte, new Date(corte.getTime() - 60000)]) fs.writeFileSync(path.join(dir, nomeBackup(data)), 'ficticio');
  const alheios = ['portal-atual.sqlite', 'outro.7z', 'supply-vision-2026-01-01_1330.7z.tmp'];
  for (const nome of alheios) fs.writeFileSync(path.join(dir, nome), 'preservar');
  fs.mkdirSync(path.join(dir, 'supply-vision-2026-01-01_0000.7z'));
  assert.equal(podarHistorico(dir, agora).length, 1);
  assert.deepEqual(listarHistorico(dir).map(x => path.basename(x.arquivo)), [nomeBackup(agora), nomeBackup(corte)]);
  for (const nome of alheios) assert.equal(fs.readFileSync(path.join(dir, nome), 'utf8'), 'preservar');
  assert.throws(() => podarHistorico(dir, agora, 0), /positivo/);
});
void test('migracao limpa legado local e preserva snapshots de protecao e arquivos alheios', async t => {
  const { removerHistoricoLocal } = await import('../scripts/retencao-backup.mjs');
  const dir = criarTemporarioTeste('sv-legado-'); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'historico'));
  for (const nome of ['portal-atual.sqlite', 'historico/portal-2026-01-01.sqlite', 'pre-expurgo.sqlite', 'pre-atualizacao.sqlite', 'pre-restauracao-preservar.sqlite', 'historico/alheio.txt']) fs.writeFileSync(path.join(dir, nome), 'preservar');
  removerHistoricoLocal(dir);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['historico', 'pre-atualizacao.sqlite', 'pre-restauracao-preservar.sqlite']);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'historico')), ['alheio.txt']);
});
