// Sobe o Portal entregando ao Worker as variaveis que ele espera em `env`.
//
// O wrangler.json e GERADO pelo build e sai com "vars": {}. Nao havia
// .dev.vars nem --var em lugar nenhum fora dos testes, entao
// INITIAL_ADMIN_PASSWORD e TRUSTED_PROXY -- que o route.ts e o database.ts
// leem de `env` -- chegavam sempre indefinidos. O README ja avisava que
// "definir a variavel so no PowerShell nao a entrega"; faltava quem
// entregasse.
//
// As variaveis vem do portal.env, junto das outras configuracoes de operacao,
// e sao entregues por um arquivo proprio (--env-file), gravado na area privada
// a cada subida e apagado quando o Portal para. Antes iam por --var, e a linha
// de comando de qualquer processo fica visivel para todo usuario da maquina
// (Gerenciador de Tarefas, Get-CimInstance Win32_Process): a senha inicial e
// o token interno apareciam ali em texto puro.
//
//   node scripts/iniciar-portal.mjs           porta e ip padrao do wrangler
//   node scripts/iniciar-portal.mjs local     127.0.0.1:3000
//   node scripts/iniciar-portal.mjs lan       0.0.0.0:3000
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

import { lerConfigBruta, portalPrivado } from './configuracao.mjs';

// Lista fechada: so o que o codigo do Worker realmente le. Uma lista aberta
// mandaria SMTP_PASSWORD e afins para dentro do Worker sem ninguem pedir.
export const VARIAVEIS_DO_WORKER = ['INITIAL_ADMIN_PASSWORD', 'TRUSTED_PROXY', 'PORTAL_API_TOKEN'];

export const ARQUIVO_VARS = path.join(portalPrivado, 'configuracao', 'worker.env');

// O wrangler le o arquivo como .env: dotenv e, em seguida, dotenv-expand. Dois
// cuidados para o Worker receber exatamente o que esta no portal.env:
//   - o dotenv-expand troca $NOME pelo valor de NOME mesmo entre aspas
//     simples; "\$" vira "$" literal, entao todo cifrao e escapado;
//   - entre aspas duplas o dotenv converte \n e \r em quebra de linha. Por
//     isso a ordem de preferencia e aspas simples, crase e so entao duplas,
//     e nunca duplas quando o valor tem essas sequencias.
// O que nao couber em nenhum delimitador e recusado com mensagem clara (a
// senha e trocada no portal.env), em vez de chegar ao Worker outro valor.
function citar(chave, valor) {
  if (/[\r\n]/.test(valor)) throw new Error(`${chave} no portal.env nao pode ter quebra de linha.`);
  const delimitador = ["'", '`', '"'].find((aspas) => !valor.includes(aspas) && !(aspas === '"' && /\\[nr]/.test(valor)));
  if (!delimitador) throw new Error(`${chave} no portal.env tem uma combinacao de aspas que o wrangler nao le fielmente; troque o valor.`);
  return `${delimitador}${valor.replaceAll('$', '\\$')}${delimitador}`;
}

export function montarArquivoVars(config) {
  const linhas = [];
  for (const chave of VARIAVEIS_DO_WORKER) {
    const valor = String(config[chave] ?? '').trim();
    if (valor) linhas.push(`${chave}=${citar(chave, valor)}`);
  }
  return linhas.length ? `${linhas.join('\n')}\n` : '';
}

export function montarArgumentos(modo, arquivoVars = null) {
  const base = [
    'dev',
    '--config', 'dist/server/wrangler.json',
    '--persist-to', '../privado/portal/banco/estado/state',
  ];
  if (arquivoVars) base.push('--env-file', arquivoVars);
  if (modo === 'local') base.push('--ip', '127.0.0.1', '--port', '3000');
  if (modo === 'lan') base.push('--ip', '0.0.0.0', '--port', '3000');
  return base;
}

function apagarArquivoVars() {
  try { fs.rmSync(ARQUIVO_VARS, { force: true }); } catch { /* ja removido */ }
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith('iniciar-portal.mjs')) {
  const modo = process.argv[2] || '';
  const conteudo = montarArquivoVars(lerConfigBruta());
  // Sempre regrava: um arquivo que sobrou de uma queda nao pode entregar
  // valores antigos depois que o portal.env mudou.
  apagarArquivoVars();
  if (conteudo) {
    fs.mkdirSync(path.dirname(ARQUIVO_VARS), { recursive: true });
    fs.writeFileSync(ARQUIVO_VARS, conteudo, { encoding: 'utf8', mode: 0o600 });
  }
  const wrangler = path.join(path.resolve(import.meta.dirname, '..'), 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  const filho = spawn(process.execPath, [wrangler, ...montarArgumentos(modo, conteudo ? ARQUIVO_VARS : null)], {
    cwd: path.resolve(import.meta.dirname, '..'),
    stdio: 'inherit',
  });
  // O supervisor encerra a arvore de processos; repassar os sinais evita
  // deixar o wrangler orfao quando o encerramento vem pelo console.
  for (const sinal of ['SIGINT', 'SIGTERM']) process.on(sinal, () => filho.kill(sinal));
  filho.on('exit', (codigo, sinal) => {
    apagarArquivoVars();
    process.exitCode = sinal ? 1 : (codigo ?? 0);
  });
}
