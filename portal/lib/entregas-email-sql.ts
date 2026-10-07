// Projecao comum para paginar notificacoes e relatorios, sem esconder falhas.
export const ENTREGAS_EMAIL_SQL = `(
 SELECT e.id,e.type,e.status,e.attempts,e.next_attempt_at,e.sent_at,e.last_error,e.created_at,
 COALESCE(e.recipient_user_id,u.id) recipient_user_id,e.recipient_name,e.recipient_email,t.code ticket_code,t.supplier_name,
 'notificacao' delivery_kind,NULL period_start,NULL period_end
 FROM email_notifications e JOIN tickets t ON t.id=e.ticket_id LEFT JOIN users u ON u.id=e.recipient_user_id OR (e.recipient_user_id IS NULL AND lower(u.email)=lower(e.recipient_email))
 UNION ALL
 SELECT d.id,'relatorio_diario',d.status,d.attempts,d.next_attempt_at,d.sent_at,d.last_error,d.created_at,
 d.user_id,u.name,u.email,d.report_date,'Relatório diário','diario',d.period_start,d.period_end
 FROM daily_report_deliveries d JOIN users u ON u.id=d.user_id
) e`;
