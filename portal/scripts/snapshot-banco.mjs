import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { validarBanco } from './validar-banco.mjs';

export function criarSnapshot(origem, destino) {
  if (fs.existsSync(destino)) throw new Error('Destino do snapshot ja existe.');
  const db = new DatabaseSync(origem, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout=5000');
    db.exec(`VACUUM INTO '${destino.replaceAll("'", "''").replaceAll('\\', '/')}'`);
    return validarBanco(destino);
  } catch (erro) { fs.rmSync(destino, { force: true }); throw erro; }
  finally { db.close(); }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 4) throw new Error('Uso: snapshot-banco.mjs origem.sqlite destino.sqlite');
  console.log(JSON.stringify(criarSnapshot(path.resolve(process.argv[2]), path.resolve(process.argv[3]))));
}
