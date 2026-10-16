import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_RELATORIOS } from '../../lib/relatorios.ts';
import { localizar7zip } from '../../scripts/backup-7z.mjs';
export const senhaFicticia = 'Ficticia com espaco ç!"123';
export function ferramenta7z(t) {
  const config = { BACKUP_7ZIP_EXE: process.env.SV_TEST_7ZIP };
  try { return localizar7zip(config); }
  catch { t.skip('Integracao 7z exige SV_TEST_7ZIP com 7-Zip oficial >=24.09.'); return null; }
}
export function bancoFicticio(arquivo) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const db = new DatabaseSync(arquivo);
  for (const [, ddl] of fs.readFileSync(new URL('../../lib/database.ts', import.meta.url), 'utf8').matchAll(/`(CREATE TABLE IF NOT EXISTS [^`]+)`/g)) db.exec(ddl);
  for (const ddl of SCHEMA_RELATORIOS) db.exec(ddl);
  db.exec("INSERT INTO users(id,name,email,password_hash,password_salt,created_at,role) VALUES('u','Antes','u@example.com','hash','salt','2026-01-01','admin')");
  db.exec("INSERT INTO report_jobs(id,request_key,action,created_by,created_at) VALUES('j','j','paralelo','u','2026-01-01')");
  return db;
}
