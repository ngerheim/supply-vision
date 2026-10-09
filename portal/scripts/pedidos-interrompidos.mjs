export function revisarPedidosInterrompidos(db, restaurado = false) {
  // Reinicio normal preserva pedidos que ainda nao iniciaram. Na restauracao,
  // os pedidos da copia podem ja ter sido executados depois do backup.
  db.exec('BEGIN IMMEDIATE');
  try {
    const pedidos = db
      .prepare(
        restaurado
          ? "SELECT id,status,created_by FROM report_jobs WHERE status IN ('queued','running')"
          : "SELECT id,status,created_by FROM report_jobs WHERE status='running'",
      )
      .all();
    const timestamp = new Date().toISOString();
    for (const pedido of pedidos) {
      const mensagem =
        pedido.status === 'running'
          ? '\nExecução interrompida. Confira arquivos e entrega antes de solicitar novamente; não haverá reenvio automático.'
          : '\nO banco foi restaurado. Pedido preservado para revisão; use seus parâmetros em uma nova solicitação se ainda necessário.';
      db.prepare(
        'UPDATE report_jobs SET status=?,completed_at=?,log=log||? WHERE id=?',
      ).run(
        pedido.status === 'running' ? 'failed' : 'review',
        timestamp,
        mensagem,
        pedido.id,
      );
      db.prepare(
        "INSERT INTO audit_logs(id,user_id,action,entity,entity_id,details,created_at) VALUES(?,?,'UPDATE','report_job',?,?,?)",
      ).run(
        `aud_${crypto.randomUUID()}`,
        pedido.created_by,
        pedido.id,
        mensagem.trim(),
        timestamp,
      );
    }
    db.exec('COMMIT');
    return pedidos.length;
  } catch (erro) {
    db.exec('ROLLBACK');
    throw erro;
  }
}
