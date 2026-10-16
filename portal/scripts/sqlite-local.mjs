import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { travarRestauracao } from './trava-restauracao.mjs';

// O formato legado preserva o arquivo existente e permite rollback da versao anterior.
export function arquivoSqliteLocal(persistencia) {
  const pasta = path.join(persistencia, 'v3/d1/miniflare-D1DatabaseObject');
  if (!fs.existsSync(pasta)) return null;
  const arquivos = fs.readdirSync(pasta).filter(n => n.endsWith('.sqlite') && n !== 'metadata.sqlite');
  if (arquivos.length > 1) throw new Error('SQLite local ambiguo.');
  return arquivos.length ? path.join(pasta, arquivos[0]) : null;
}

/** @param {{ persistencia: string, pastaRestauracao?: string | null, criar?: boolean }} options */
export function abrirSqliteLocal({ persistencia, pastaRestauracao = null, criar = false }) {
  let arquivo = arquivoSqliteLocal(persistencia);
  if (!arquivo && criar) {
    const pasta = path.join(persistencia, 'v3/d1/miniflare-D1DatabaseObject');
    fs.mkdirSync(pasta, { recursive: true });
    arquivo = path.join(pasta, 'portal.sqlite');
  }
  if (!arquivo) throw new Error('SQLite local ainda nao inicializado.');
  const liberar = pastaRestauracao ? travarRestauracao(false, pastaRestauracao) : () => {};
  let db;
  try {
    db = new DatabaseSync(arquivo);
    db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON');
    // Restauracao entrega journal DELETE; a partida deve restabelecer WAL.
    if (db.prepare('PRAGMA journal_mode=WAL').get().journal_mode !== 'wal') throw new Error('SQLite local exige suporte a WAL.');
  } catch (erro) { db?.close(); liberar(); throw erro; }
  let fechado = false;
  /** @param {{ sql: string, values?: unknown[] }} consulta */
  function consultar({ sql, values = [] }) {
    if (fechado) throw new Error('SQLite local fechado.');
    const antes = db.prepare('SELECT total_changes() changes').get().changes;
    const params = values.map(v => v instanceof ArrayBuffer ? Buffer.from(v) : ArrayBuffer.isView(v) ? Buffer.from(v.buffer, v.byteOffset, v.byteLength) : Array.isArray(v) ? Buffer.from(v) : v);
    const results = db.prepare(sql).all(...params).map(row => Object.fromEntries(Object.entries(row).map(([k,v]) => [k, v instanceof Uint8Array ? Array.from(v) : v])));
    const meta = db.prepare('SELECT total_changes() changes,last_insert_rowid() last_row_id').get();
    return { success: true, results, meta: { changes: meta.changes - antes, last_row_id: meta.last_row_id } };
  }
  return {
    arquivo, consultar,
    /** @param {{ sql: string, values: unknown[] }[] } consultas */
    batch(consultas) {
      // Leitores compartilham snapshot sem reservar antecipadamente o escritor.
      db.exec(consultas.every(c => /^\s*SELECT\b/i.test(c.sql)) ? 'BEGIN' : 'BEGIN IMMEDIATE');
      try { const results = consultas.map(consultar); db.exec('COMMIT'); return results; }
      catch (erro) { db.exec('ROLLBACK'); throw erro; }
    },
    exec(sql) { db.exec(sql); },
    fechar() { if (fechado) return; fechado = true; try { db.close(); } finally { liberar(); } },
  };
}
