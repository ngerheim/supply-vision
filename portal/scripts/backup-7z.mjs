import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { privado } from './caminhos.mjs';

// Nunca propagar erros de child_process: podem incluir argumentos e saida nativa.
export class FalhaBackup extends Error {}
const quebraLinha = process.platform === 'win32' ? '\r\n' : '\n';
const promptSenha = `${quebraLinha}Enter password (will not be echoed):${quebraLinha}`;
function opcoes7z(cwd, timeout, input) {
  return { cwd, timeout, input, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 4 * 1024 * 1024 };
}
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
  if (typeof senha !== 'string' || !senha || /[\r\n\0]/.test(senha)) throw new FalhaBackup('Senha de backup invalida.');
  try {
    const comando = argumentos[0];
    if (!['a', 't', 'l', 'x'].includes(comando) || argumentos.some(a => /^-p/i.test(a))) throw new Error();
    // No 7-Zip Windows, -p vazio pede senha ao criar, mas significa senha
    // vazia ao ler. Leituras devem omitir -p para consumir uma linha do stdin.
    // Somente a listagem precisa de stdout; nos demais comandos -bso0 tambem
    // suprime o prompt, sem suprimir erros nem a verificacao de exit code.
    const saida = executar(executavel, [...argumentos, ...(comando === 'a' ? ['-p'] : []),
      '-y', '-bd', '-bb0', ...(comando === 'l' ? [] : ['-bso0'])], opcoes7z(cwd, timeout, `${senha}\n`));
    if (comando !== 'l') {
      if (saida !== '') throw new Error();
      return saida;
    }
    // A listagem cifrada -slt -ba tem este prefixo exato. Nao usar trim ou
    // remover linhas no meio: formato novo/inesperado deve falhar fechado.
    if (!argumentos.includes('-slt') || !argumentos.includes('-ba') || !saida.startsWith(promptSenha)) throw new Error();
    const lista = saida.substring(promptSenha.length);
    if (!lista.startsWith('Path = ') || /[\r\n]Enter password|[\r\n]Verify password/.test(lista)) throw new Error();
    return lista;
  } catch { throw new FalhaBackup('7-Zip falhou: confira senha, arquivo e permissoes.'); }
}
export function exigirNomesCriptografados(executavel, arquivo, { cwd, timeout = 120000, executar = execFileSync } = {}) {
  try {
    // Stdin fechado, sem senha nem -p: nomes cifrados exigem o prompt e o
    // abandono por EOF (255). Arquivo corrompido/timeout nao prova criptografia.
    executar(executavel, ['l', '-slt', '-ba', arquivo, '-y', '-bd', '-bb0'], opcoes7z(cwd, timeout, ''));
  } catch (erro) {
    if (erro?.status === 255 && String(erro.stdout) === promptSenha) return;
    throw new FalhaBackup('7-Zip falhou: confira senha, arquivo e permissoes.');
  }
  throw new FalhaBackup('Backup sem criptografia de nomes; recusado.');
}
