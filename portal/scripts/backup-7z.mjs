import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { privado } from './caminhos.mjs';

// Nunca propagar erros de child_process: incluem spawnargs, inclusive -p.
export class FalhaBackup extends Error {}
export function localizar7zip(config, executar = execFileSync) {
  const executavel = config.BACKUP_7ZIP_EXE?.trim() || 'C:\\Program Files\\7-Zip\\7z.exe';
  const minima = config.BACKUP_7ZIP_MIN_VERSION?.trim() || '24.09';
  if (!/^\d{2}\.\d{2}$/.test(minima)) throw new FalhaBackup('BACKUP_7ZIP_MIN_VERSION invalida.');
  let saida;
  try { saida = executar(executavel, ['i'], { encoding: 'utf8', windowsHide: true, timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch { throw new FalhaBackup('7-Zip ausente ou indisponivel. Instale o 7-Zip oficial.'); }
  const versao = /7-Zip[^\r\n]*?\b(\d{2}\.\d{2})\b/.exec(saida)?.[1];
  if (!versao || Number(versao) < Number(minima)) throw new FalhaBackup(`7-Zip abaixo da versao minima ${minima}.`);
  return executavel;
}
export function lerSenhaBackup({ raiz = privado, executar = execFileSync } = {}) {
  if (!fs.existsSync(path.join(raiz, 'comum/backup-senha.dpapi')))
    throw new FalhaBackup('Senha de backup ausente. Execute supv backup senha com a conta do dono.');
  try {
    const senha = executar('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      path.resolve(import.meta.dirname, '../../scripts/backup-senha.ps1'), '-Ler'], {
      env: { ...process.env, SUPPLY_VISION_PRIVADO: raiz }, encoding: 'utf8', windowsHide: true, timeout: 15000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (!senha || /[\r\n\0]/.test(senha)) throw new Error();
    return senha;
  } catch { throw new FalhaBackup('Senha de backup indisponivel para esta conta. Execute supv backup senha com a conta do dono.'); }
}
export function executar7z(executavel, senha, argumentos, { cwd, timeout = 120000, executar = execFileSync } = {}) {
  if (!senha || /[\r\n\0]/.test(senha)) throw new FalhaBackup('Senha de backup invalida.');
  try {
    return executar(executavel, [...argumentos, `-p${senha}`, '-y', '-bd', '-bb0'], {
      cwd, timeout, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 4 * 1024 * 1024,
    });
  } catch { throw new FalhaBackup('7-Zip falhou: confira senha, arquivo e permissoes.'); }
}
