export const MENSAGEM_RESTAURACAO = 'Banco restaurado: confirme o reenvio.';
export function marcarFilasAposRestauracao(db) {
  const agora = new Date().toISOString();
  const tabelas = new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map((linha) => linha.name));
  let total = 0;
  for (const tabela of ['email_notifications', 'daily_report_deliveries']) {
    if (!tabelas.has(tabela)) continue;
    total += Number(db.prepare(`UPDATE ${tabela} SET status='failed',locked_at=NULL,last_error=?,updated_at=? WHERE status IN ('pending','processing')`).run(MENSAGEM_RESTAURACAO, agora).changes);
  }
  return total;
}
