// A condição usa o estado do banco no instante da escrita, não o snapshot
// consultado pela requisição. Duas desativações não removem o último admin.
export const ATUALIZAR_USUARIO_SQL = `UPDATE users
  SET name=?,role=?,active=?,daily_report_enabled=?,daily_report_time=?,revision=revision+1
  WHERE id=? AND revision=? AND (
    role<>'admin' OR active<>1 OR (?='admin' AND ?=1)
    OR EXISTS (SELECT 1 FROM users outro WHERE outro.role='admin' AND outro.active=1 AND outro.id<>users.id)
  )`;

// Dados cadastrais e credenciais mudam na mesma escrita, sob a mesma guarda.
export const ATUALIZAR_USUARIO_COM_SENHA_SQL = ATUALIZAR_USUARIO_SQL.replace(
  'daily_report_time=?', 'daily_report_time=?,password_salt=?,password_hash=?,password_iterations=?',
);

export const ENCERRAR_SESSOES_REDEFINIDAS_SQL = `DELETE FROM sessions WHERE user_id=? AND changes()=1
  AND EXISTS (SELECT 1 FROM users WHERE id=? AND password_salt=?)`;

// Desativacao ou troca de perfil encerra as sessoes, mas so se a atualizacao
// guardada acima realmente gravou o novo estado (guarda do ultimo admin).
export const ENCERRAR_SESSOES_ALTERADAS_SQL = `DELETE FROM sessions WHERE user_id=? AND changes()=1
  AND EXISTS (SELECT 1 FROM users WHERE id=? AND role=? AND active=?)`;

// Imediatamente depois do UPDATE no mesmo batch: guarda recusada nao gera
// auditoria, e a auditoria passa changes()=1 ao encerramento de sessoes.
export const AUDITAR_USUARIO_SQL = `INSERT INTO audit_logs (id,user_id,action,entity,entity_id,details,created_at)
  SELECT ?,?,'UPDATE','user',?,?,? WHERE changes()=1`;
