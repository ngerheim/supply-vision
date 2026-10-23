// SQLite nao remove NOT NULL por ALTER COLUMN. Reconstrucao atomica da fila
// preserva todas as entregas e permite exatamente um dos dois vinculos.
export const MIGRAR_FILA_SOLICITACOES = [
  `CREATE TABLE email_notifications_nova (id TEXT PRIMARY KEY, ticket_id TEXT REFERENCES tickets(id),
    solicitacao_id TEXT REFERENCES solicitacoes(id), event_id TEXT NOT NULL, type TEXT NOT NULL,
    recipient_user_id TEXT, recipient_name TEXT NOT NULL, recipient_email TEXT NOT NULL, payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL,
    locked_at TEXT, sent_at TEXT, last_error TEXT, dedupe_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    CHECK((ticket_id IS NOT NULL) <> (solicitacao_id IS NOT NULL)))`,
  `INSERT INTO email_notifications_nova(id,ticket_id,event_id,type,recipient_user_id,recipient_name,recipient_email,payload_json,status,attempts,next_attempt_at,locked_at,sent_at,last_error,dedupe_key,created_at,updated_at)
    SELECT id,ticket_id,event_id,type,recipient_user_id,recipient_name,recipient_email,payload_json,status,attempts,next_attempt_at,locked_at,sent_at,last_error,dedupe_key,created_at,updated_at FROM email_notifications`,
  'DROP TABLE email_notifications',
  'ALTER TABLE email_notifications_nova RENAME TO email_notifications',
  'CREATE INDEX idx_email_notifications_queue ON email_notifications(status,next_attempt_at)',
  'CREATE INDEX idx_email_notifications_ticket ON email_notifications(ticket_id,created_at DESC)',
  'CREATE INDEX idx_email_notifications_solicitacao ON email_notifications(solicitacao_id,created_at DESC)',
];
