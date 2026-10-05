import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { portalPrivado } from './configuracao.mjs';

export function localizarBanco(informado = null) {
  if (informado) return path.resolve(informado);
  const diretorio = path.join(
    portalPrivado,
    'banco',
    'estado',
    'state',
    'v3',
    'd1',
    'miniflare-D1DatabaseObject',
  );
  if (!fs.existsSync(diretorio)) return null;
  const arquivos = fs
    .readdirSync(diretorio)
    .filter((nome) => nome.endsWith('.sqlite') && nome !== 'metadata.sqlite');
  if (arquivos.length !== 1)
    throw new Error('Não foi possível identificar um único banco local.');
  return path.join(diretorio, arquivos[0]);
}
export function abrirBancoLocal(tabela, informado = null) {
  const arquivo = localizarBanco(informado);
  if (!arquivo) return null;
  const db = new DatabaseSync(arquivo);
  db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON');
  if (
    !db
      .prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?")
      .get(tabela)
  ) {
    db.close();
    return null;
  }
  return db;
}
