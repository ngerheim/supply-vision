import fs from 'node:fs';
import path from 'node:path';
import { semearUsuarios } from './usuarios.mjs';
import { semearCadastros } from './cadastros.mjs';
import { semearAcordos } from './acordos.mjs';
import { semearChamados } from './chamados.mjs';
import { semearSolicitacoes } from './solicitacoes.mjs';
import { semearBaixas } from './baixas.mjs';
import { semearPagamentos } from './pagamentos.mjs';

export const exemplo = JSON.parse(fs.readFileSync(new URL('./usuarios.exemplo.json', import.meta.url), 'utf8'));
export function clienteApi(base) {
  const url = new URL(base);
  if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:') throw new Error('Demonstracao exige loopback.');
  let cookie = '';
  return async (rota, method = 'GET', body, chave) => {
    const resposta = await fetch(`${url.origin}/api${rota}`, { method, redirect: 'error', signal: AbortSignal.timeout(60_000),
      headers: { 'content-type': 'application/json', cookie, ...(chave ? { 'idempotency-key': chave } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (resposta.headers.has('set-cookie')) cookie = resposta.headers.get('set-cookie').split(';')[0];
    const dados = await resposta.json();
    if (!resposta.ok) throw new Error(`${method} ${rota}: HTTP ${resposta.status} ${dados.error || ''}`);
    return dados;
  };
}
export async function semear(base, pasta) {
  const progresso = path.join(pasta, 'semeadura.json');
  const estado = fs.existsSync(progresso) ? JSON.parse(fs.readFileSync(progresso, 'utf8')) : {};
  const salvar = () => { const tmp = `${progresso}.tmp`; fs.writeFileSync(tmp, JSON.stringify(estado)); fs.renameSync(tmp, progresso); };
  fs.writeFileSync(path.join(pasta, 'credenciais.json'), JSON.stringify(exemplo, null, 2));
  if (estado.concluido && estado.solicitacoesConcluidas && estado.baixasConcluidas && estado.pagamentosConcluidos) return;
  const api = clienteApi(base);
  await api('/login', 'POST', exemplo.inicial);
  try {
    const usuarios = await semearUsuarios(api, exemplo);
    const cadastros = await semearCadastros(api);
    await semearAcordos(api, cadastros);
    await semearChamados(api, usuarios, estado, salvar);
    await semearSolicitacoes(clienteApi, base, exemplo, estado, salvar);
    await semearBaixas(clienteApi, base, exemplo, estado, salvar);
    await semearPagamentos(base, exemplo, estado, salvar);
    estado.pagamentosConcluidos = true;
    estado.baixasConcluidas = true;
    estado.solicitacoesConcluidas = true;
    estado.concluido = true; salvar();
  } finally { await api('/logout', 'POST'); }
}
