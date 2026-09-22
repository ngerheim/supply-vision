// A condição usa o estado do banco no instante da escrita, não o snapshot
// consultado pela requisição. Duas desativações não removem o último admin.
export const ATUALIZAR_USUARIO_SQL = `UPDATE users
  SET name=?,role=?,active=?,daily_report_enabled=?,daily_report_time=?
  WHERE id=? AND (
    role<>'admin' OR active<>1 OR (?='admin' AND ?=1)
    OR EXISTS (SELECT 1 FROM users outro WHERE outro.role='admin' AND outro.active=1 AND outro.id<>users.id)
  )`;
