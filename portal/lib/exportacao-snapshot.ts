export const CONSULTAS_EXPORTACAO = {
  users: 'SELECT id,name,email,role,active,daily_report_enabled,daily_report_time,created_at FROM users ORDER BY created_at',
  suppliers: 'SELECT * FROM suppliers ORDER BY legal_name',
  locations: 'SELECT * FROM locations ORDER BY state,city',
  catalogItems: 'SELECT * FROM catalog_items ORDER BY name',
  vehicleModels: 'SELECT * FROM vehicle_models ORDER BY name',
  importItemMappings: 'SELECT * FROM import_item_mappings ORDER BY source_key',
  importUnitMappings: 'SELECT * FROM import_unit_mappings ORDER BY source_key',
  importModelMappings: 'SELECT * FROM import_model_mappings ORDER BY source_key',
  units: 'SELECT * FROM units ORDER BY code',
  agreements: 'SELECT * FROM agreements ORDER BY created_at',
  agreementLocations: 'SELECT * FROM agreement_locations',
  imports: 'SELECT * FROM imports ORDER BY created_at',
  agreementVersions: "SELECT * FROM agreement_versions WHERE status='published' ORDER BY agreement_id,version_number",
  agreementItems: "SELECT * FROM agreement_items WHERE version_id IN (SELECT id FROM agreement_versions WHERE status='published') ORDER BY version_id,created_at",
  tickets: 'SELECT * FROM tickets ORDER BY created_at',
  ticketEvents: 'SELECT * FROM ticket_events ORDER BY created_at',
  emailNotifications: 'SELECT * FROM email_notifications ORDER BY created_at',
  auditLogs: 'SELECT * FROM audit_logs ORDER BY created_at',
  reportJobs: 'SELECT * FROM report_jobs',
  dailyReportDeliveries: 'SELECT * FROM daily_report_deliveries',
};

// D1 batch executa as leituras na mesma transacao, inclusive em SQLite local.
export async function exportarTabelas(db: Pick<D1Database, 'prepare' | 'batch'>) {
  const entradas=Object.entries(CONSULTAS_EXPORTACAO);
  const resultados=await db.batch(entradas.map(([,sql])=>db.prepare(sql)));
  return Object.fromEntries(entradas.map(([nome],i)=>[nome,resultados[i].results]));
}
