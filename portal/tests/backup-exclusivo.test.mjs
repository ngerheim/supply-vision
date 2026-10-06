import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { comBackupExclusivo } from '../scripts/backup-exclusivo.mjs';

void test('backup concorrente nao toca arquivos e lock libera depois de falha', async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-backup-lock-'));
  let liberar;
  try {
    const primeiro = comBackupExclusivo(pasta, () => new Promise(r => { liberar = r; }));
    let executou = false;
    await assert.rejects(comBackupExclusivo(pasta, () => { executou = true; }), /locked/);
    assert.equal(executou, false);
    liberar(); await primeiro;
    await assert.rejects(comBackupExclusivo(pasta, () => { throw new Error('falha injetada'); }), /falha injetada/);
    assert.equal(await comBackupExclusivo(pasta, () => 'ok'), 'ok');
  } finally { fs.rmSync(pasta, { recursive: true, force: true }); }
});

void test('queda do processo libera lock sem apagar arquivo manualmente', { timeout: 15000 }, async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-backup-crash-'));
  const modulo = new URL('../scripts/backup-exclusivo.mjs', import.meta.url).href;
  const codigo = `import { comBackupExclusivo } from ${JSON.stringify(modulo)}; await comBackupExclusivo(process.argv[1], () => new Promise(() => { console.log('pronto'); setInterval(() => {}, 1000); }));`;
  const filho = spawn(process.execPath, ['--input-type=module', '-e', codigo, pasta], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const encerrado = once(filho, 'close');
  try {
    const [saida] = await once(filho.stdout, 'data');
    assert.equal(String(saida).trim(), 'pronto');
    await assert.rejects(comBackupExclusivo(pasta, () => 'nao deve executar'), /locked/);
    filho.kill(); await encerrado;
    assert.equal(await comBackupExclusivo(pasta, () => 'recuperado'), 'recuperado');
  } finally { if (filho.exitCode === null && filho.signalCode === null) { filho.kill(); await encerrado; } fs.rmSync(pasta, { recursive: true, force: true }); }
});
