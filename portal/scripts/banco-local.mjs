import { arquivoSqliteLocal } from './sqlite-local.mjs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { portalPrivado } from './configuracao.mjs';

export function localizarBanco(informado = null, pastaPrivada = portalPrivado) {
  if (informado) return path.resolve(informado);
  return arquivoSqliteLocal(path.join(pastaPrivada, 'banco/estado/state'));
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
