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
// e sao passadas por --var, o mesmo caminho que os testes de instalacao e de
// estresse ja usavam.
//
//   node scripts/iniciar-portal.mjs           porta e ip padrao do wrangler
//   node scripts/iniciar-portal.mjs local     127.0.0.1:3000
//   node scripts/iniciar-portal.mjs lan       0.0.0.0:3000
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

import { lerConfigBruta } from './configuracao.mjs';

// Lista fechada: so o que o codigo do Worker realmente le. Uma lista aberta
// mandaria SMTP_PASSWORD e afins para dentro do bundle sem ninguem pedir.
export const VARIAVEIS_DO_WORKER = ['INITIAL_ADMIN_PASSWORD', 'TRUSTED_PROXY'];

export function montarVars(config) {
  const args = [];
  for (const chave of VARIAVEIS_DO_WORKER) {
    const valor = String(config[chave] ?? '').trim();
    if (valor) args.push('--var', `${chave}:${valor}`);
  }
  return args;
}

export function montarArgumentos(modo, config) {
  const base = [
    'dev',
    '--config', 'dist/server/wrangler.json',
    '--persist-to', '../privado/portal/banco/estado/state',
  ];
  if (modo === 'local') base.push('--ip', '127.0.0.1', '--port', '3000');
  if (modo === 'lan') base.push('--ip', '0.0.0.0', '--port', '3000');
  return [...base, ...montarVars(config)];
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith('iniciar-portal.mjs')) {
  const modo = process.argv[2] || '';
  const config = lerConfigBruta();
  const wrangler = path.join(path.resolve(import.meta.dirname, '..'), 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  const filho = spawn(process.execPath, [wrangler, ...montarArgumentos(modo, config)], {
    cwd: path.resolve(import.meta.dirname, '..'),
    stdio: 'inherit',
  });
  // O supervisor encerra a arvore de processos; repassar os sinais evita
  // deixar o wrangler orfao quando o encerramento vem pelo console.
  for (const sinal of ['SIGINT', 'SIGTERM']) process.on(sinal, () => filho.kill(sinal));
  filho.on('exit', (codigo, sinal) => { process.exitCode = sinal ? 1 : (codigo ?? 0); });
}
