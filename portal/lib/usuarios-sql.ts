// A condição usa o estado do banco no instante da escrita, não o snapshot
// consultado pela requisição. Duas desativações não removem o último admin.
export const ATUALIZAR_USUARIO_SQL = `UPDATE users
  SET name=?,role=?,active=?,daily_report_enabled=?,daily_report_time=?
  WHERE id=? AND (
    role<>'admin' OR active<>1 OR (?='admin' AND ?=1)
    OR EXISTS (SELECT 1 FROM users outro WHERE outro.role='admin' AND outro.active=1 AND outro.id<>users.id)
  )`;

// Dados cadastrais e credenciais mudam na mesma escrita, sob a mesma guarda.
export const ATUALIZAR_USUARIO_COM_SENHA_SQL = ATUALIZAR_USUARIO_SQL.replace(
  'daily_report_time=?', 'daily_report_time=?,password_salt=?,password_hash=?,password_iterations=?',
);

export const ENCERRAR_SESSOES_REDEFINIDAS_SQL = `DELETE FROM sessions WHERE user_id=?
  AND EXISTS (SELECT 1 FROM users WHERE id=? AND password_salt=?)`;
