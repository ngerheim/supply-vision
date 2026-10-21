import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PADRAO_BACKUP, podarHistorico } from './retencao-backup.mjs';
import { modoEnsaio } from './modo-ensaio.mjs';
import { executar7z, FalhaBackup } from './backup-7z.mjs';

// Processo descartavel: SMB sincrono nao bloqueia o prazo observado pelo pai.
export function hashArquivo(arquivo) {
  const hash = createHash('sha256'), bloco = Buffer.allocUnsafe(1024 * 1024);
  const fd = fs.openSync(arquivo, 'r');
  try {
    let lidos;
    while ((lidos = fs.readSync(fd, bloco, 0, bloco.length, null)) > 0) hash.update(bloco.subarray(0, lidos));
    return hash.digest('hex');
  } finally { fs.closeSync(fd); }
}
export function moverSemSubstituir(origem, destino) {
  // File.Move do .NET recusa destino existente (rename do Node substitui).
  if (process.platform === 'win32') {
    try {
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        "[IO.File]::Move($env:SV_BACKUP_ORIGEM,$env:SV_BACKUP_DESTINO)"], {
        env: { ...process.env, SV_BACKUP_ORIGEM: origem, SV_BACKUP_DESTINO: destino },
        stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 15000,
      });
    } catch { throw new FalhaBackup('Publicacao do backup recusada; nenhum arquivo existente foi substituido.'); }
  } else {
    fs.linkSync(origem, destino); fs.unlinkSync(origem);
  }
}
export function limparTemporariosAntigos(pastaRede, { agora = Date.now(), registrar = console.warn } = {}) {
  for (const nome of fs.readdirSync(pastaRede)) {
    if (!/^supply-vision-\d{4}-\d{2}-\d{2}_\d{4}\.7z\.[0-9a-f-]{36}\.tmp$/.test(nome)) continue;
    try {
      const arquivo = path.join(pastaRede, nome), estado = fs.lstatSync(arquivo);
      if (estado.isFile() && estado.mtimeMs < agora - 2 * 3600_000) fs.unlinkSync(arquivo);
    } catch { registrar('AVISO: temporario antigo de backup nao removido.'); }
  }
}
export function replicarCopiaNaRede(origem, pastaRede, { executavel, senha, testar = executar7z, registrar = console.warn } = {}) {
  if (modoEnsaio()) throw new FalhaBackup('ensaio: backup em rede bloqueado.');
  if (!pastaRede) throw new FalhaBackup('BACKUP_NETWORK_DIR nao configurado.');
  const nome = path.basename(origem);
  if (!PADRAO_BACKUP.test(nome)) throw new FalhaBackup('Nome de backup invalido.');
  // A pasta e provisionada pela TI; nao criar uma pasta local se a rede sumir.
  if (!fs.statSync(pastaRede).isDirectory()) throw new Error('Rede indisponivel.');
  limparTemporariosAntigos(pastaRede, { registrar });
  const final = path.join(pastaRede, nome), temporario = `${final}.${randomUUID()}.tmp`;
  if (fs.existsSync(final)) throw new FalhaBackup('Backup com este horario ja existe; nao sera substituido.');
  try {
    fs.copyFileSync(origem, temporario, fs.constants.COPYFILE_EXCL);
    testar(executavel, senha, ['t', temporario]);
    const hashLocal = hashArquivo(origem), hashRede = hashArquivo(temporario);
    if (hashLocal !== hashRede) throw new FalhaBackup('Hash do backup na rede nao confere.');
    moverSemSubstituir(temporario, final);
    // Limpeza so depois de publicar uma nova copia validada.
    try { podarHistorico(pastaRede); }
    catch { registrar('AVISO: backup confirmado; retencao da rede nao concluida.'); }
    return { arquivo: final, hash: hashRede };
  } finally { fs.rmSync(temporario, { force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.send) throw new Error('Este script exige canal privado de processo.');
  process.once('message', ({ origem, pastaRede, executavel, senha }) => {
    let resultado;
    try { resultado = { ok: true, ...replicarCopiaNaRede(origem, pastaRede, { executavel, senha, registrar: aviso => process.send({ aviso }) }) }; }
    catch (erro) { resultado = { ok: false, erro: erro instanceof FalhaBackup ? erro.message : 'Pasta de backup de rede indisponivel.' }; }
    process.send(resultado, () => process.disconnect());
  });
}
