import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { portalPrivado } from './configuracao.mjs';

const origem = path.join(portalPrivado, 'backups', 'portal-atual.sqlite');
if (!fs.existsSync(origem)) throw new Error(`Backup nao encontrado: ${origem}`);
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'supply-vision-restauracao-'));
const copia = path.join(pasta, 'restaurado.sqlite');
try {
  fs.copyFileSync(origem, copia);
  const db = new DatabaseSync(copia, { readOnly: true });
  try {
    const integridade = Object.values(db.prepare('PRAGMA integrity_check').get())[0];
    if (integridade !== 'ok') throw new Error(`Integridade reprovada: ${integridade}`);
    const obrigatorias = ['users', 'agreements', 'tickets', 'email_notifications'];
    const tabelas = new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map((x) => x.name));
    const faltando = obrigatorias.filter((nome) => !tabelas.has(nome));
    if (faltando.length) throw new Error(`Tabelas ausentes: ${faltando.join(', ')}`);
    const totais = Object.fromEntries(obrigatorias.map((nome) => [nome, Number(db.prepare(`SELECT COUNT(*) total FROM ${nome}`).get().total)]));
    console.log(`Restauracao aprovada: ${JSON.stringify(totais)}`);
  } finally { db.close(); }
} finally { fs.rmSync(pasta, { recursive: true, force: true }); }