import fs from 'node:fs';
import { revisarPedidosInterrompidos } from './pedidos-interrompidos.mjs';
import { DatabaseSync } from 'node:sqlite';
import { marcarFilasAposRestauracao } from './filas-restauradas.mjs';

// Toda escrita acontece na copia descartavel, antes de substituir o alvo.
export function prepararRestauracao(origem, temporario, validar) {
  fs.rmSync(temporario, { force: true });
  try {
    fs.copyFileSync(origem, temporario);
    const resumo = validar(temporario);
    const db = new DatabaseSync(temporario);
    try {
      db.exec('PRAGMA journal_mode=DELETE; BEGIN IMMEDIATE');
      try {
        const marcados = marcarFilasAposRestauracao(db);
        if (db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='operacao_validacao'").get())
          db.exec('UPDATE operacao_validacao SET ativa=0');
        db.exec('COMMIT');
        if (db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='report_jobs'").get())
          revisarPedidosInterrompidos(db, true);
        return { resumo, marcados };
      } catch (erro) { db.exec('ROLLBACK'); throw erro; }
    } finally { db.close(); }
  } catch (erro) {
    for (const sufixo of ['', '-journal', '-wal', '-shm']) fs.rmSync(temporario + sufixo, { force: true });
    throw erro;
  }
}
