import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { privado, portalPrivado, lerArquivo } from './configuracao.mjs';
import { localizarBanco } from './banco-local.mjs';
import { executarBackup } from './backup.mjs';
import { comBackupExclusivo } from './backup-exclusivo.mjs';

export function configurarExpurgo(config) {
  const dias = (nome, padrao) => {
    const valor = config[nome] === undefined ? padrao : Number(config[nome]);
    if (!Number.isInteger(valor) || valor < 0 || valor > 36500) throw new Error(`Prazo invalido: ${nome}`);
    return valor;
  };
  return { ativo: config.EXPURGO_HABILITADO === '1', emails: dias('EXPURGO_EMAILS_DIAS', 180), relatorios: dias('EXPURGO_RELATORIOS_DIAS', 90), importacoes: dias('EXPURGO_IMPORTACOES_DIAS', 180) };
}
// Somente estados terminais; pendentes/em andamento e auditoria sao preservados.
export function expurgar(db, config, agora = new Date()) {
  if (!config.ativo) return {};
  const limite = dias => new Date(agora.getTime() - dias * 86400_000).toISOString();
  const resultados = {};
  db.exec('BEGIN IMMEDIATE');
  try {
    if (config.emails) for (const tabela of ['email_notifications', 'daily_report_deliveries']) {
      resultados[tabela] = db.prepare(`DELETE FROM ${tabela} WHERE status IN ('sent','failed') AND updated_at<?`).run(limite(config.emails)).changes;
    }
    if (config.relatorios) resultados.report_jobs = db.prepare("DELETE FROM report_jobs WHERE status IN ('done','failed','cancelled') AND completed_at<?").run(limite(config.relatorios)).changes;
    if (config.importacoes) resultados.imports = db.prepare("UPDATE imports SET summary_json=NULL WHERE completed_at<? AND status!='processing' AND summary_json IS NOT NULL").run(limite(config.importacoes)).changes;
    db.exec('COMMIT');
    return resultados;
  } catch (erro) { db.exec('ROLLBACK'); throw erro; }
}
export async function executarExpurgo({ config, arquivo, pasta, agora = new Date(), backup = async () => { if (await executarBackup() !== 0) throw new Error('Expurgo bloqueado: backup de rede nao confirmado.'); } } = {}) {
  const regras = configurarExpurgo(config);
  if (!regras.ativo || ![regras.emails, regras.relatorios, regras.importacoes].some(Boolean)) return {};
  return comBackupExclusivo(pasta, async () => {
    // Sem historico local: o expurgo exige backup de rede confirmado antes de apagar.
    await backup(arquivo);
    const db = new DatabaseSync(arquivo);
    try { db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON'); return expurgar(db, regras, agora); }
    finally { db.close(); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const config = lerArquivo(path.join(privado, 'comum', 'operacao.env'), { obrigatorio: true });
    const regras = configurarExpurgo(config);
    if (regras.ativo) console.log('Expurgo:', await executarExpurgo({ config, arquivo: localizarBanco(), pasta: path.join(portalPrivado, 'backups') }));
  } catch { console.error('Expurgo bloqueado: confira backup, banco e configuracao.'); process.exitCode = 1; }
}
