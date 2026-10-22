import { execFileSync } from 'node:child_process';

// Executado pela configuracao do compilador, nunca por uma requisicao.
/** @param {string} versao @param {{ commit?: string, raiz?: string }} opcoes */
export function identificarBuild(versao, { commit = '', raiz = process.cwd() } = {}) {
  const sha = commit || execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: raiz, encoding: 'utf8' }).trim();
  if (!/^[a-f0-9]{7,40}$/.test(sha)) throw new Error('Commit do build invalido.');
  return `${versao}+${sha}`;
}
