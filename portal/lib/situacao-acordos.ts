// Uma regra para a lista, o detalhe e a planilha; ?1 recebe o dia em Sao Paulo.
export const SITUACAO_EFETIVA_SQL = `CASE
  WHEN a.status='active' AND date(a.start_date)>date(?1) THEN 'scheduled'
  WHEN a.status='active' AND a.end_date IS NOT NULL AND date(a.end_date)<date(?1) THEN 'expired'
  WHEN a.status='active' AND a.end_date IS NOT NULL AND date(a.end_date) BETWEEN date(?1) AND date(?1,'+60 day') THEN 'expiring'
  ELSE a.status END`;

export function correspondeSituacaoAcordo(efetiva: string, filtro: string): boolean {
  return !filtro || efetiva === filtro || (filtro === 'active' && efetiva === 'expiring');
}
