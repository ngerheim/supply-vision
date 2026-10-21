import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { travarRestauracao } from './trava-restauracao.mjs';

import { localizarBanco } from './banco-local.mjs';
import { portalPrivado } from './caminhos.mjs';

/** @param {{ pastaPrivada?: string, pastaRestauracao?: string | null, criar?: boolean }} options */
export function abrirSqliteLocal({ pastaPrivada = portalPrivado, pastaRestauracao = pastaPrivada, criar = false } = {}) {
  const arquivo = localizarBanco(null, pastaPrivada, { criar });
  if (!arquivo) throw new Error('SQLite local ainda nao inicializado.');
  const liberar = pastaRestauracao ? travarRestauracao(false, pastaRestauracao) : () => {};
  let db;
  try {
    if (criar) fs.mkdirSync(path.dirname(arquivo), { recursive: true });
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
    /** @param {{ sql: string, values: unknown[] }[] } consultas
     * @param {(executar: typeof consultar) => void} [antesEscrita] */
    batch(consultas, antesEscrita) {
      // Leitores compartilham snapshot sem reservar antecipadamente o escritor.
      db.exec(!antesEscrita && consultas.every(c => /^\s*SELECT\b/i.test(c.sql)) ? 'BEGIN' : 'BEGIN IMMEDIATE');
      try { antesEscrita?.(consultar); const results = consultas.map(consultar); db.exec('COMMIT'); return results; }
      catch (erro) { db.exec('ROLLBACK'); throw erro; }
    },
    exec(sql) { db.exec(sql); },
    fechar() { if (fechado) return; fechado = true; try { db.close(); } finally { liberar(); } },
  };
}
