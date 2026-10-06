import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validarBanco } from './validar-banco.mjs';
import { portalPrivado } from './configuracao.mjs';

const origem = path.join(portalPrivado, 'backups', 'portal-atual.sqlite');
if (!fs.existsSync(origem)) throw new Error(`Backup nao encontrado: ${origem}`);
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'supply-vision-restauracao-'));
const copia = path.join(pasta, 'restaurado.sqlite');
try {
  fs.copyFileSync(origem, copia);
  console.log(`Restauracao aprovada: ${JSON.stringify(validarBanco(copia))}`);
} finally { fs.rmSync(pasta, { recursive: true, force: true }); }