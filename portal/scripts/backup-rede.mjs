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
const PADRAO_TEMPORARIO = /^portal-atual\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp\.sqlite$/;
export function limparTemporariosAntigos(pastaRede, { agora = Date.now(), registrar = console.warn } = {}) {
  const avisar = erro => registrar(`AVISO: limpeza de temporarios do backup em rede falhou (${erro.code || 'erro desconhecido'}); backup continua.`);
  let nomes;
  try { nomes = fs.readdirSync(pastaRede); }
  catch (erro) { avisar(erro); return; }
  for (const nome of nomes) {
    if (!PADRAO_TEMPORARIO.test(nome)) continue;
    const arquivo = path.join(pastaRede, nome);
    try {
      // Sem recursao ou links: somente arquivos regulares do nosso padrao.
      const estado = fs.lstatSync(arquivo);
      if (estado.isFile() && estado.mtimeMs < agora - 60 * 60 * 1000) fs.unlinkSync(arquivo);
    } catch (erro) { avisar(erro); }
  }
}
export function replicarCopiaNaRede(origem, pastaRede, registrar = console.warn) {
  if (modoEnsaio()) throw new Error('ensaio: backup em rede bloqueado.');
  fs.mkdirSync(pastaRede, { recursive: true });
  limparTemporariosAntigos(pastaRede, { registrar });
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
    try { resultado = { ok: true, ...replicarCopiaNaRede(origem, pastaRede, aviso => process.send({ aviso })) }; }
    catch (erro) { resultado = { ok: false, erro: erro instanceof Error ? erro.message : 'Falha no backup em rede.' }; }
    process.send(resultado, () => process.disconnect());
  });
}
