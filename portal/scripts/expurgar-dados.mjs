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
  return { ativo: config.EXPURGO_HABILITADO === '1', emails: dias('EXPURGO_EMAILS_DIAS', 180), relatorios: dias('EXPURGO_RELATORIOS_DIAS', 90), importacoes: dias('EXPURGO_IMPORTACOES_DIAS', 180), notificacoesNaoLidas: dias('EXPURGO_NOTIFICACOES_NAO_LIDAS_DIAS', 365) };
}
// Somente estados terminais; pendentes/em andamento e auditoria sao preservados.
function operacoesExpurgo(db, config, agora, executar) {
  if (!config.ativo) return {};
  const limite = dias => new Date(agora.getTime() - dias * 86400_000).toISOString();
  const resultados = {};
  const aplicar = (nome, sql, valores) => {
    const tabela = sql.match(/^(?:DELETE FROM|UPDATE) ([^ ]+)/)[1];
    const where = sql.slice(sql.indexOf(' WHERE ') + 7);
    const consulta = executar ? sql : `SELECT COUNT(*) AS quantidade FROM ${tabela} WHERE ${where}`;
    const resultado = executar ? db.prepare(consulta).run(...valores).changes : db.prepare(consulta).get(...valores).quantidade;
    resultados[nome] = resultado;
  };
  if (db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='consultas_cnpj'").get())
    aplicar('consultas_cnpj', 'DELETE FROM consultas_cnpj WHERE consultada_em<?', [limite(90)]);
  if (db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='notificacoes_usuario'").get())
    aplicar('notificacoes_usuario', 'DELETE FROM notificacoes_usuario WHERE (lida_em IS NOT NULL AND lida_em<?) OR (lida_em IS NULL AND criada_em<?)', [limite(90), limite(config.notificacoesNaoLidas)]);
  if (config.emails) for (const tabela of ['email_notifications', 'daily_report_deliveries']) {
    aplicar(tabela, `DELETE FROM ${tabela} WHERE status IN ('sent','failed') AND updated_at<?`, [limite(config.emails)]);
  }
  if (config.relatorios) aplicar('report_jobs', "DELETE FROM report_jobs WHERE status IN ('done','failed','cancelled') AND completed_at<?", [limite(config.relatorios)]);
  if (config.importacoes) {
    const sql = "UPDATE imports SET summary_json=NULL WHERE completed_at<? AND status!='processing' AND summary_json IS NOT NULL";
    resultados.imports = executar ? db.prepare(sql).run(limite(config.importacoes)).changes : db.prepare("SELECT COUNT(*) AS quantidade FROM imports WHERE completed_at<? AND status!='processing' AND summary_json IS NOT NULL").get(limite(config.importacoes)).quantidade;
  }
  return resultados;
}
function contarCandidatos(db, config, agora) {
  db.exec('BEGIN IMMEDIATE');
  try { const resultados = operacoesExpurgo(db, config, agora, false); db.exec('COMMIT'); return resultados; }
  catch (erro) { db.exec('ROLLBACK'); throw erro; }
}
export function expurgar(db, config, agora = new Date()) {
  db.exec('BEGIN IMMEDIATE');
  try { const resultados = operacoesExpurgo(db, config, agora, true); db.exec('COMMIT'); return resultados; }
  catch (erro) { db.exec('ROLLBACK'); throw erro; }
}
export async function executarExpurgo({ config, arquivo, pasta, agora = new Date(), backup = async () => { if (await executarBackup() !== 0) throw new Error('Expurgo bloqueado: backup de rede nao confirmado.'); } } = {}) {
  const regras = configurarExpurgo(config);
  if (!regras.ativo) return {};
  return comBackupExclusivo(pasta, async () => {
    {
      const db = new DatabaseSync(arquivo);
      try {
        db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON');
        const candidatos = contarCandidatos(db, regras, agora);
        if (!Object.values(candidatos).some(quantidade => quantidade > 0)) return { ...candidatos, mensagem: 'nada a expurgar' };
      } finally { db.close(); }
    }
    // O expurgo exige backup de rede confirmado antes de apagar.
    await backup(arquivo);
    const db = new DatabaseSync(arquivo);
    try {
      db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON');
      const candidatos = contarCandidatos(db, regras, agora);
      if (!Object.values(candidatos).some(quantidade => quantidade > 0)) return { ...candidatos, mensagem: 'nada a expurgar' };
      return expurgar(db, regras, agora);
    }
    finally { db.close(); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const config = lerArquivo(path.join(privado, 'comum', 'operacao.env'), { obrigatorio: true });
    const regras = configurarExpurgo(config);
    if (regras.ativo) {
      const resultado = await executarExpurgo({ config, arquivo: localizarBanco(), pasta: path.join(portalPrivado, 'backups') });
      if (resultado.mensagem === 'nada a expurgar') console.log('nada a expurgar');
      else console.log('Expurgo:', resultado);
    }
  } catch { console.error('Expurgo bloqueado: confira backup, banco e configuracao.'); process.exitCode = 1; }
}
