import fs from 'node:fs';
import path from 'node:path';
import { privado } from './caminhos.mjs';

export const arquivoCorteRestauracao = (raiz = privado) => path.join(raiz, 'operacao', 'restauracao.json');
const dia = data => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(data);

// Expira logicamente na virada do dia civil; conservar o registro ajuda o diagnostico.
export function lerCorteRestauracao(agora = new Date(), raiz = privado, registrarAviso = console.warn) {
  const arquivo = arquivoCorteRestauracao(raiz);
  let corte;
  const avisar = mensagem => { try { registrarAviso(mensagem); } catch { /* O log nao pode interromper o consumidor. */ } };
  try {
    const registro = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    corte = new Date(registro?.corte);
    if (typeof registro?.corte !== 'string' || !Number.isFinite(corte.getTime())) throw new Error('Corte invalido.');
  } catch (erro) {
    if (erro.code === 'ENOENT') return null;
    try {
      corte = fs.statSync(arquivo).mtime;
      if (!Number.isFinite(corte.getTime())) throw new Error('Modificacao invalida.');
    } catch {
      avisar('AVISO: restauracao.json invalido ou ilegivel; data de modificacao indisponivel, seguindo sem corte.');
      return null;
    }
    avisar('AVISO: restauracao.json invalido ou ilegivel; usando a data de modificacao como corte.');
  }
  return dia(corte) === dia(agora) ? corte : null;
}
