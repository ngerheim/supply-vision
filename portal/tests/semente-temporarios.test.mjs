import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { criarTemporarioTeste } from './apoio/ambiente.mjs';
import { montarPacote } from '../scripts/backup-pacote.mjs';
import { bancoFicticio } from './apoio/backup.mjs';
void test('semente reduzida usa backup unico; falha de snapshot nao copia configuracao', t => {
  const dir = criarTemporarioTeste('sv-semente-'); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const banco = path.join(dir, 'fixture.sqlite'); bancoFicticio(banco).close();
  const preparar = fs.readFileSync(new URL('../../scripts/preparar-semente.ps1', import.meta.url), 'utf8');
  const restaurar = fs.readFileSync(new URL('../../scripts/restaurar-semente.ps1', import.meta.url), 'utf8');
  assert.match(preparar, /Executar-NativoOperacao/); assert.doesNotMatch(preparar, /Compress-Archive|\.zip/);
  assert.match(restaurar, /--configuracao/); assert.doesNotMatch(restaurar, /Expand-Archive/);
  fs.writeFileSync(banco, 'nao e SQLite');
  assert.throws(() => montarPacote(path.join(dir, 'conteudo'), { raiz: dir, banco }));
  assert.equal(fs.existsSync(path.join(dir, 'conteudo/comum')), false);
});
void test('wrapper da semente conserva argumentos e codigo da restauracao', { skip: process.platform !== 'win32' }, t => {
  const dir = criarTemporarioTeste('sv-semente-wrapper-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const wrapper = path.join(dir, 'restaurar-semente.ps1');
  fs.copyFileSync(new URL('../../scripts/restaurar-semente.ps1', import.meta.url), wrapper);
  for (const codigo of [0, 7]) {
    fs.writeFileSync(path.join(dir, 'supv.ps1'),
      `Write-Output ('ARGUMENTOS='+(ConvertTo-Json -InputObject @($args) -Compress));exit ${codigo}`);
    for (const data of ['', '2026-10-13_1400']) {
      const argumentos = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', wrapper];
      if (data) argumentos.push('-Data', data);
      const r = spawnSync('powershell.exe', argumentos, { encoding: 'utf8', windowsHide: true, timeout: 15000 });
      assert.ifError(r.error);
      assert.equal(r.status, codigo, r.stderr || r.stdout);
      const recebidos = /^ARGUMENTOS=(.+)$/m.exec(r.stdout);
      assert.ok(recebidos, r.stdout);
      assert.deepEqual(JSON.parse(recebidos[1]), ['backup', 'restaurar', '--configuracao', ...(data ? ['--data', data] : [])]);
    }
  }
});
