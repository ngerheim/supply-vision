import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepararRestauracao } from './restauracao-segura.mjs';
import { validarBanco } from './validar-banco.mjs';

export function restaurarBancoSemente(origem, destino) {
  if (fs.existsSync(destino)) throw new Error('Destino da semente ja possui banco.');
  const temporario = `${destino}.restaurando`;
  try {
    const resultado = prepararRestauracao(origem, temporario, validarBanco);
    fs.renameSync(temporario, destino);
    return resultado;
  } finally { fs.rmSync(temporario, { force: true }); }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 4) throw new Error('Uso: restaurar-banco-semente.mjs origem destino');
  const { marcados } = restaurarBancoSemente(path.resolve(process.argv[2]), path.resolve(process.argv[3]));
  console.log(`${marcados} entrega(s) marcada(s) como falha; confira a entrega antes de solicitar reenvio.`);
}
