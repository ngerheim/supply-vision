import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Lock do SQLite liberado pelo SO inclusive se o processo for encerrado.
// O banco de lock e separado do banco operacional e permanece vazio.
export async function comBackupExclusivo(pasta, executar) {
  fs.mkdirSync(pasta, { recursive: true });
  const lock = new DatabaseSync(path.join(pasta, 'backup.lock.sqlite'));
  try {
    lock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE');
    return await executar();
  } finally { lock.close(); }
}
