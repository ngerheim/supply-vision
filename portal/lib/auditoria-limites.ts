export const MAX_EXPORT_AUDITORIA = 10_000;
export function erroExportacaoAuditoria(total: number): string | null {
  return total > MAX_EXPORT_AUDITORIA
    ? 'A exportação permite até 10.000 registros. Restrinja o período ou os filtros do histórico.'
    : null;
}
// INSTR preserva a busca literal e evita o limite de padrao LIKE do D1.
export const BUSCA_LITERAL_AUDITORIA_SQL = '(instr(lower(l.details),lower(?))>0 OR instr(lower(l.entity),lower(?))>0 OR instr(lower(u.name),lower(?))>0)';
