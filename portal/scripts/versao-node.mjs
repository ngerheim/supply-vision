import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const VERSAO_NODE = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).engines.node;

export function validarVersaoNode({ versao = process.versions.node, exata = false, avisar = console.warn } = {}) {
  const alvo = VERSAO_NODE.split('.').map(Number);
  const atual = /^\d+\.\d+\.\d+$/.test(versao) ? versao.split('.').map(Number) : [];
  if (atual[0] !== alvo[0] || atual[1] < alvo[1] || (exata && atual[1] !== alvo[1])) {
    throw new Error(`Node ${versao} nao suportado; ${exata ? 'instalacao e PREPARAR exigem' : 'partida exige'} ${alvo[0]}.${alvo[1]}.${exata ? 'x' : '0 ou superior no mesmo major'}.`);
  }
  if (!exata && versao !== VERSAO_NODE) avisar(`Node ${versao}: versao de referencia do Portal e ${VERSAO_NODE}.`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  validarVersaoNode({ exata: process.argv.includes('--exata') });
}
