// Deve ser importado antes dos consumidores que fixam portalPrivado ao carregar.
import fs from 'node:fs';
import path from 'node:path';
import { after } from 'node:test';
import { criarTemporarioTeste } from './ambiente.mjs';
const anterior = process.env.SUPPLY_VISION_PRIVADO;
const raiz = criarTemporarioTeste('sv-email-logs-');
process.env.SUPPLY_VISION_PRIVADO = raiz;
export const arquivoLogEmail = path.join(raiz, 'portal/logs/portal-email.log');
fs.mkdirSync(path.dirname(arquivoLogEmail), { recursive: true });
after(() => {
  if (anterior === undefined) delete process.env.SUPPLY_VISION_PRIVADO;
  else process.env.SUPPLY_VISION_PRIVADO = anterior;
  fs.rmSync(raiz, { recursive: true, force: true });
});
