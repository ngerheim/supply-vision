import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Uma Promise pendente sem resolver retido pode ser coletada com a continuacao
// do await. O processo ainda vivo nao basta para manter o handle SQLite vivo.
// A conexao fica enraizada ate o finally, independentemente do GC do V8.
const backupsAtivos = new Set();

// Lock do SQLite liberado pelo SO inclusive se o processo for encerrado.
// O banco de lock e separado do banco operacional e permanece vazio.
export async function comBackupExclusivo(pasta, executar) {
  fs.mkdirSync(pasta, { recursive: true });
  const lock = new DatabaseSync(path.join(pasta, 'backup.lock.sqlite'));
  backupsAtivos.add(lock);
  try {
    lock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE');
    return await executar();
  } finally {
    try { lock.close(); } finally { backupsAtivos.delete(lock); }
  }
}
