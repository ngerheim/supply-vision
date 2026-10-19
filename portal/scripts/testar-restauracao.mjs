import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepararRestauracao } from './restauracao-segura.mjs';
import { validarBanco } from './validar-banco.mjs';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_RELATORIOS } from '../lib/relatorios.ts';
import { comBackupDaRede } from './backup-pacote.mjs';

const pasta = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'supply-vision-restauracao-'));
const copia = path.join(pasta, 'restaurado.sqlite');
const ficticio = process.argv.includes('--fixture');
const origem = path.join(pasta, 'origem.sqlite');
try {
  if (ficticio) {
    const db = new DatabaseSync(origem);
    try {
      for (const [,ddl] of fs.readFileSync(new URL('../lib/database.ts',import.meta.url),'utf8').matchAll(/`(CREATE TABLE IF NOT EXISTS [^`]+)`/g)) db.exec(ddl);
      for (const ddl of SCHEMA_RELATORIOS) db.exec(ddl);
      db.exec("INSERT INTO users(id,name,email,password_salt,password_hash,role,created_at) VALUES('u','Ficticio','u@example.invalid','salt','hash','editor','x')");
    } finally { db.close(); }
  }
  if (!ficticio) await comBackupDaRede(undefined, extraido => fs.copyFileSync(path.join(extraido, 'banco/portal.sqlite'), origem));
  if (!fs.existsSync(origem)) throw new Error(`Backup nao encontrado: ${origem}`);
  const { resumo, marcados } = prepararRestauracao(origem, copia, validarBanco);
  validarBanco(copia);
  console.log(`Preparacao da restauracao aprovada em copia descartavel: ${Object.entries(resumo).map(([tabela, total]) => `${tabela}=${total}`).join(", ")}; ${marcados} entregas neutralizadas. O banco operacional nao foi substituido.`);
} catch { console.error('Teste do backup falhou: confira rede, senha, 7-Zip e integridade.'); process.exitCode = 1; } finally { fs.rmSync(pasta, { recursive: true, force: true }); }