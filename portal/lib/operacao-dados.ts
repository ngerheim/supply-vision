// Uma unica varredura na migracao, nunca na abertura de novos chamados.
export const CRIAR_CONTADOR_CHAMADOS_SQL = 'CREATE TABLE IF NOT EXISTS ticket_counter (id INTEGER PRIMARY KEY CHECK(id=1), value INTEGER NOT NULL)';
export const MIGRAR_CONTADOR_CHAMADOS_SQL = `INSERT OR IGNORE INTO ticket_counter(id,value)
 SELECT 1,COALESCE(MAX(CAST(substr(code,instr(code,'-')+1) AS INTEGER)),0) FROM tickets`;
export const RESERVAR_CODIGO_CHAMADO_SQL = 'UPDATE ticket_counter SET value=value+1 WHERE id=1 RETURNING value';
export function joinContagemHistorico(busca: string | null | undefined) {
  return busca ? 'LEFT JOIN users u ON u.id=l.user_id' : '';
}
export function filtroChamados(params: URLSearchParams) {
  const conditions: string[] = [], values: unknown[] = [];
  const grupos: Record<string, string[]> = { ativos: ['aberto', 'aguardando_fornecedor'], fechados: ['fechado'], cancelados: ['cancelado'] };
  const grupo = params.get('group');
  if (grupo && grupos[grupo]) {
    conditions.push(`t.status IN (${grupos[grupo].map(() => '?').join(',')})`);
    values.push(...grupos[grupo]);
  }
  const q = params.get('q')?.trim();
  if (q) { conditions.push("instr(lower(t.code||' '||t.supplier_name||' '||COALESCE(t.city,'')||' '||COALESCE(t.state,'')),lower(?))>0"); values.push(q); }
  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', values };
}
