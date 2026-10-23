import fs from 'node:fs';
import path from 'node:path';
import { modoEnsaio } from '../scripts/modo-ensaio.mjs';
import { validarPasta, marcarBancoNovo } from './pasta.mjs';
import { clienteApi, exemplo, semear } from './semear.mjs';

if (!modoEnsaio()) throw new Error('Demonstracao exige MODO_ENSAIO=1.');
const pasta = process.env.SUPPLY_VISION_PRIVADO;
// A pasta do ambiente ja foi validada pelo launcher, antes de sobrescrever o
// ambiente real. Revalida banco, sentinela e worktree dentro do filho.
const { criar, sentinela } = validarPasta(pasta, { privadoAmbiente: null });
if (!sentinela) throw new Error('Sentinela obrigatoria.');
process.env.PORTAL_CRIAR_BANCO = criar ? '1' : '0';
process.env.INITIAL_ADMIN_PASSWORD = exemplo.inicial.password;
const { iniciarPortal } = await import('../scripts/iniciar-portal.mjs');
const runtime = await iniciarPortal('local');
for (const sinal of ['SIGINT', 'SIGTERM']) process.once(sinal, () => { void runtime.encerrar(); });
try {
  const endereco = `http://127.0.0.1:${runtime.server.address().port}`;
  await clienteApi(endereco)('/health');
  if (criar) marcarBancoNovo(pasta, exemplo.inicial);
  process.env.PORTAL_CRIAR_BANCO = '0';
  await semear(endereco, pasta);
  fs.writeFileSync(path.join(pasta, 'pronto.json'), JSON.stringify({ pid: process.pid, endereco }));
  console.log(`Demonstracao pronta: ${endereco}`);
} catch (erro) { await runtime.encerrar(); throw erro; }
