export const REENVIAR_NOTIFICACAO_SQL = `UPDATE email_notifications SET status='pending',attempts=0,next_attempt_at=?,locked_at=NULL,last_error=NULL,updated_at=?
 WHERE id=? AND status='failed' AND updated_at=? AND attempts=?`;
export const AUDITAR_REENVIO_SQL = `INSERT INTO audit_logs (id,user_id,action,entity,entity_id,details,created_at)
 SELECT ?,?,?,?,?,?,? WHERE changes()=1`;
export const REENVIAR_RELATORIO_DIARIO_SQL = REENVIAR_NOTIFICACAO_SQL.replace('email_notifications', 'daily_report_deliveries');
