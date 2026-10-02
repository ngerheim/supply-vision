// Identificadores locais sao parte da identidade da base Miniflare existente.
// A configuracao remota so e selecionada explicitamente; nunca como fallback.
export function configuracaoBinding(variaveis = process.env) {
  const destino = variaveis.SUPPLY_VISION_TARGET || 'local';
  const base = {
    main: 'vinext/server/fetch-handler',
    compatibility_flags: ['nodejs_compat'],
    observability: { enabled: false },
  };
  if (destino === 'local') return {
    ...base,
    d1_databases: [{ binding: 'DB', database_name: 'site-creator-d1', database_id: '00000000-0000-4000-8000-000000000000' }],
  };
  if (destino !== 'cloudflare-staging') throw new Error('SUPPLY_VISION_TARGET deve ser local ou cloudflare-staging.');
  const databaseId = variaveis.CLOUDFLARE_D1_DATABASE_ID || '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(databaseId)
    || databaseId === '00000000-0000-4000-8000-000000000000'
    || databaseId === '00000000-0000-0000-0000-000000000000') {
    throw new Error('Informe CLOUDFLARE_D1_DATABASE_ID de uma base exclusiva de homologacao.');
  }
  return {
    ...base,
    name: 'supply-vision-portal-staging',
    compatibility_date: '2026-10-02',
    workers_dev: false,
    preview_urls: false,
    d1_databases: [{ binding: 'DB', database_name: 'supply-vision-portal-staging', database_id: databaseId }],
  };
}
