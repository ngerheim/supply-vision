import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { guardarNoHistorico } from './retencao-backup.mjs';
import { modoEnsaio } from './modo-ensaio.mjs';

// Processo descartavel: I/O SMB sincrono nao bloqueia o prazo observado pelo pai.
export function hashArquivo(arquivo) {
  const hash = createHash('sha256'), bloco = Buffer.allocUnsafe(1024 * 1024);
  const fd = fs.openSync(arquivo, 'r');
  try {
    let lidos;
    while ((lidos = fs.readSync(fd, bloco, 0, bloco.length, null)) > 0) hash.update(bloco.subarray(0, lidos));
    return hash.digest('hex');
  } finally { fs.closeSync(fd); }
}
export function replicarCopiaNaRede(origem, pastaRede) {
  if (modoEnsaio()) throw new Error('ensaio: backup em rede bloqueado.');
  fs.mkdirSync(pastaRede, { recursive: true });
  const final = path.join(pastaRede, 'portal-atual.sqlite');
  const temporario = path.join(pastaRede, `portal-atual.${randomUUID()}.tmp.sqlite`);
  try {
    fs.copyFileSync(origem, temporario);
    const hashLocal = hashArquivo(origem), hashRede = hashArquivo(temporario);
    if (hashLocal !== hashRede) throw new Error('A copia do backup na rede nao confere com a copia local.');
    // Substituicao atomica, inclusive no Windows: interrupcao nao deixa a
    // copia anterior ausente entre duas renomeacoes.
    fs.renameSync(temporario, final);
    guardarNoHistorico(pastaRede, final);
    return { arquivo: final, hash: hashRede };
  } finally { fs.rmSync(temporario, { force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.send) throw new Error('Este script e chamado pelo backup, com canal privado de processo.');
  process.once('message', ({ origem, pastaRede }) => {
    let resultado;
    try { resultado = { ok: true, ...replicarCopiaNaRede(origem, pastaRede) }; }
    catch (erro) { resultado = { ok: false, erro: erro instanceof Error ? erro.message : 'Falha no backup em rede.' }; }
    process.send(resultado, () => process.disconnect());
  });
}
