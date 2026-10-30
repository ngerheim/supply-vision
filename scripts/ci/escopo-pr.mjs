import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Via rapida do CI. Um PR que so muda telas, rotas, regras ou testes nao
// mexe no mecanismo de operacao/atualizacao do servidor; nele, os jobs
// pesados terminam verdes sem os cenarios longos (o supv atualizar exige os
// checks com sucesso, nunca pulados). Na main, na agenda semanal, no disparo
// manual ou em qualquer duvida: roda tudo.

// Caminhos do mecanismo: atualizacao, supervisor, banco, dependencias, CI.
export const CAMINHOS_MECANISMO = [
  /^scripts\//, /^supv\.cmd$/, /^\.github\//, /^\.gitattributes$/, /^compartilhado\//, /^privado\.exemplo\//,
  /^portal\/scripts\//, /^portal\/package(-lock)?\.json$/, /^portal\/vendor\//,
  /^portal\/(vite\.config|next\.config|middleware)\.ts$/, /^portal\/tsconfig\.json$/, /^portal\/[^/]+\.env\.example$/,
  /^portal\/lib\/(database|sqlite-local|controle-escrita|operacao-dados|operacao-validacao|portal-build|politica-sessao|autor-escrita)\.ts$/,
  /^portal\/lib\/[^/]*schema[^/]*\.ts$/,
  /^alertas\/config\//, /^alertas\/processo\/(pipeline|sv_paths|segredos|base_atomica|estado_entrega|limpeza)\.py$/,
];
// Mudanca de estrutura do banco em qualquer arquivo tambem e mecanismo.
const DDL = /^[+-].*\b((CREATE|ALTER|DROP)\s+(TABLE|INDEX|TRIGGER|VIEW)|schema_migrations)\b/im;

export function classificar(arquivos, diff = '') {
  const mecanismo = arquivos.filter(a => CAMINHOS_MECANISMO.some(r => r.test(a)));
  if (mecanismo.length) return { mecanismo: true, motivo: `mecanismo alterado: ${mecanismo.slice(0, 5).join(', ')}` };
  if (DDL.test(diff)) return { mecanismo: true, motivo: 'estrutura do banco alterada' };
  return { mecanismo: false, motivo: `via rapida: ${arquivos.length} arquivo(s) de tela, regra ou teste` };
}

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

export function escopo({ evento, base, head, raiz }) {
  if (evento !== 'pull_request') return { mecanismo: true, motivo: `evento ${evento || 'desconhecido'}: roda tudo` };
  try {
    if (!/^[0-9a-f]{40}$/i.test(base || '') || !/^[0-9a-f]{40}$/i.test(head || '')) throw new Error('SHAs ausentes');
    const inicio = git(['merge-base', base, head], raiz).trim();
    const arquivos = git(['diff', '--name-only', inicio, head], raiz).split('\n').filter(Boolean);
    const diff = git(['diff', '--unified=0', inicio, head], raiz);
    return classificar(arquivos, diff);
  } catch (erro) {
    return { mecanismo: true, motivo: `escopo indeterminado (${erro instanceof Error ? erro.message.split('\n')[0] : 'erro'}): roda tudo` };
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const resultado = escopo({
    evento: process.env.GITHUB_EVENT_NAME, base: process.env.SV_ESCOPO_BASE, head: process.env.SV_ESCOPO_HEAD,
    raiz: path.resolve(import.meta.dirname, '../..'),
  });
  console.log(`Escopo do CI: ${resultado.motivo}`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `mecanismo=${resultado.mecanismo}\n`);
}
