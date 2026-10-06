import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { verificarSaude } from './saude-completa.mjs';
import { localizarBanco } from './banco-local.mjs';
import { privado } from './configuracao.mjs';

export function verificarConsumidores(db, status, agora = Date.now()) {
  const recente = data => {
    const idade = agora - Date.parse(data);
    return Number.isFinite(idade) && idade >= -5000 && idade < 30_000;
  };
  if (!recente(status.atualizado) || !status.portal || !status.emails || !status.relatorios) throw new Error('Supervisor sem estado recente de todos os processos obrigatorios.');
  for (const tabela of ['email_runner', 'report_runner']) {
    const pulse = db.prepare(`SELECT heartbeat_at FROM ${tabela} WHERE id=1`).get();
    if (!pulse || !recente(pulse.heartbeat_at)) throw new Error(`Consumidor sem ciclo recente: ${tabela}.`);
  }
}

export async function verificarOperacao(url) {
  const saude = await verificarSaude(url);
  let ultimoErro;
  for (let tentativa = 0; tentativa < 13; tentativa++) {
    try {
      const arquivo = localizarBanco();
      if (!arquivo) throw new Error('Banco da operacao indisponivel.');
      const db = new DatabaseSync(arquivo, { readOnly: true });
      try {
        const status = JSON.parse(fs.readFileSync(path.join(privado, 'operacao', 'status.json'), 'utf8').replace(/^\uFEFF/, ''));
        verificarConsumidores(db, status);
        return `${saude}; supervisor e consumidores com ciclos recentes`;
      } finally { db.close(); }
    } catch (erro) { ultimoErro = erro; }
    if (tentativa < 12) await new Promise(resolve => setTimeout(resolve, 5000));
  }
  throw ultimoErro;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(await verificarOperacao(process.argv[2])); }
  catch (erro) { console.error(erro.message); process.exitCode = 1; }
}
