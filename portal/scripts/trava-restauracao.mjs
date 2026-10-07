import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { portalPrivado } from './configuracao.mjs';

// Leitores mantêm uma trava compartilhada durante toda a vida do consumidor.
// A restauração exige acesso exclusivo. O SO libera a trava após uma queda.
// Este banco auxiliar não faz parte do banco de negócio nem de seu backup.
export function travarRestauracao(exclusiva = false, pasta = portalPrivado) {
  fs.mkdirSync(pasta, { recursive: true });
  const db = new DatabaseSync(path.join(pasta, 'restauracao.lock.sqlite'));
  try {
    db.exec('PRAGMA busy_timeout=1000; CREATE TABLE IF NOT EXISTS trava(id INTEGER PRIMARY KEY)');
    db.exec(exclusiva ? 'BEGIN EXCLUSIVE' : 'BEGIN');
    db.prepare('SELECT id FROM trava').all();
    let liberada = false;
    return () => { if (!liberada) { liberada = true; db.close(); } };
  } catch (erro) {
    db.close();
    throw new Error('Restauração e processadores de e-mail/relatórios não podem executar ao mesmo tempo.', { cause: erro });
  }
}
