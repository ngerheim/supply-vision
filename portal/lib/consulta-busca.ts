import { CAMPOS_BUSCA, condicoesBusca } from './filtros-busca.ts';

// Busca e opções precisam usar a mesma versão e as mesmas regras de vigência.
export function consultaBusca(params: URLSearchParams, hoje: string, ignorarCampo?: typeof CAMPOS_BUSCA[number]) {
  const filtros = condicoesBusca(params, ignorarCampo);
  const conditions = [
    "a.status='active'", 'date(a.start_date)<=date(?1)',
    '(a.end_date IS NULL OR date(a.end_date)>=date(?1))', ...filtros.conditions,
  ];
  return {
    sql: `FROM agreement_items ai JOIN agreements a ON a.current_version_id=ai.version_id
      JOIN suppliers s ON s.id=a.supplier_id JOIN catalog_items ci ON ci.id=ai.catalog_item_id
      JOIN vehicle_models vm ON vm.id=ai.vehicle_model_id JOIN units un ON un.id=ai.unit_id
      JOIN locations l ON l.id=ai.location_id WHERE ${conditions.join(' AND ')}`,
    values: [hoje, ...filtros.values],
  };
}

export function consultasOpcoesBusca(params: URLSearchParams, hoje: string) {
  const colunas = {
    state: ['l.state', 'l.state'], location: ['l.id', 'l.city'],
    item: ['ci.id', 'ci.name'], model: ['vm.id', 'vm.name'], supplier: ['s.id', 's.trade_name'],
  } as const;
  return CAMPOS_BUSCA.map(campo => {
    // Ignorar somente o próprio campo permite acrescentar alternativas sem
    // restringir a lista à primeira opção marcada. Os demais campos se cruzam.
    const consulta = consultaBusca(params, hoje, campo);
    const [id, nome] = colunas[campo];
    return { campo, sql: `SELECT DISTINCT ${id} AS id,${nome} AS name ${consulta.sql} ORDER BY name COLLATE NOCASE,id`, values: consulta.values };
  });
}
