import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Fragmentos evitam que a propria verificacao contenha os termos proibidos.
export const padroesInfraInterna = [
  ['192', '168', ''].join('.'),
  ['loc', 'frotas'].join(''),
  ['PROGRAMA', 'SUP'].join(''),
];

export function arquivosComInfraInterna(raiz) {
  const argumentos = ['grep', '-z', '-l', '-i', '-a', '-F'];
  for (const padrao of padroesInfraInterna) argumentos.push('-e', padrao);
  argumentos.push('--', '.', ':!package-lock.json', ':!**/package-lock.json');
  const resultado = spawnSync('git', argumentos, { cwd: raiz, encoding: 'utf8' });
  if (resultado.error) throw resultado.error;
  if (resultado.status === 1) return [];
  if (resultado.status !== 0) throw new Error('Nao foi possivel conferir os arquivos versionados com Git.');
  return resultado.stdout.split('\0').filter(Boolean);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const encontrados = arquivosComInfraInterna(path.resolve(import.meta.dirname, '..'));
  if (encontrados.length) {
    // Publica somente nomes de arquivos, nunca o conteudo encontrado.
    console.error('Dados de infraestrutura interna em arquivos versionados:');
    for (const arquivo of encontrados) console.error(arquivo);
    process.exitCode = 1;
  } else console.log('Infraestrutura publica: nenhum padrao proibido encontrado.');
}
