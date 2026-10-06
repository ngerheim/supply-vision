import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepararRestauracao } from './restauracao-segura.mjs';
import { validarBanco } from './validar-banco.mjs';
import { portalPrivado } from './configuracao.mjs';

const origem = path.join(portalPrivado, 'backups', 'portal-atual.sqlite');
if (!fs.existsSync(origem)) throw new Error(`Backup nao encontrado: ${origem}`);
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'supply-vision-restauracao-'));
const copia = path.join(pasta, 'restaurado.sqlite');
try {
  const { resumo, marcados } = prepararRestauracao(origem, copia, validarBanco);
  validarBanco(copia);
  console.log(`Preparacao da restauracao aprovada em copia descartavel: ${JSON.stringify(resumo)}; ${marcados} entregas neutralizadas. O banco operacional nao foi substituido.`);
} finally { fs.rmSync(pasta, { recursive: true, force: true }); }