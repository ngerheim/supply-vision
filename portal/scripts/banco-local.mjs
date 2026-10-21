import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { portalPrivado } from './caminhos.mjs';

// Formato legado preservado: Portal, consumidores e rollback usam o mesmo arquivo.
export function diretorioBanco(pastaPrivada = portalPrivado) {
  return path.join(pastaPrivada, 'banco/estado/state/v3/d1/miniflare-D1DatabaseObject');
}
export function destinoBanco(nome, pastaPrivada = portalPrivado) {
  if (typeof nome !== 'string' || path.basename(nome) !== nome || /[\\/]/.test(nome) || !nome.endsWith('.sqlite') || nome === 'metadata.sqlite') throw new Error('Nome do banco invalido.');
  return path.join(diretorioBanco(pastaPrivada), nome);
}
// Sem busca recursiva: travas, backups e observabilidade tambem sao arquivos SQLite.
export function localizarBanco(informado = null, pastaPrivada = portalPrivado, { criar = false } = {}) {
  if (informado) return path.resolve(informado);
  const pasta = diretorioBanco(pastaPrivada);
  const arquivos = fs.existsSync(pasta) ? fs.readdirSync(pasta).filter(n => n.endsWith('.sqlite') && n !== 'metadata.sqlite') : [];
  if (arquivos.length > 1) throw new Error('SQLite local ambiguo.');
  if (arquivos.length) return destinoBanco(arquivos[0], pastaPrivada);
  return criar ? destinoBanco('portal.sqlite', pastaPrivada) : null;
}
export function abrirBancoLocal(tabela, informado = null) {
  const arquivo = localizarBanco(informado);
  if (!arquivo) return null;
  const db = new DatabaseSync(arquivo);
  db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON');
  if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(tabela)) {
    db.close(); return null;
  }
  return db;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  const valor = chave => { const i = args.indexOf(chave); if (i < 0) return undefined; if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Argumento do localizador ausente.'); return args[i + 1]; };
  const pasta = valor('--pasta-portal');
  const nome = valor('--destino');
  const arquivo = nome ? destinoBanco(nome, pasta) : localizarBanco(null, pasta);
  if (!arquivo && args.includes('--exigir')) throw new Error('Banco local nao encontrado.');
  if (arquivo) console.log(arquivo);
}
