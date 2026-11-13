// Copia de acordos para os Alertas: uma linha por condicao vigente na versao
// atual e por CNPJ que atende a cidade dela (o principal sempre; os outros
// em todas as cidades ou nas listadas). Duas consultas diretas unidas: o
// formato anterior (junta com uma subconsulta UNION de todos os CNPJs)
// fazia o SQLite varrer essa subconsulta inteira para cada acordo.
export const SQL_ACORDOS_INTERNOS = `SELECT vm.name MODELO,ci.name PECA_SERVICO,l.city CIDADE,l.state UF,s.cnpj CNPJ,
    ai.price PRECO,s.trade_name FORNECEDOR,un.code MEDIDA,COALESCE(ai.brands_text,'') MARCAS,
    a.start_date INICIO_VIGENCIA,a.end_date FIM_VIGENCIA,a.status STATUS_ACORDO
  FROM (
    SELECT a.id AS agreement_id,a.supplier_id,ai.id AS item_id FROM agreements a JOIN agreement_items ai ON ai.version_id=a.current_version_id
    UNION ALL
    SELECT ac.agreement_id,ac.supplier_id,ai.id FROM agreement_cnpjs ac JOIN agreements a ON a.id=ac.agreement_id
      JOIN agreement_items ai ON ai.version_id=a.current_version_id
      WHERE ac.todas_cidades=1 OR EXISTS (SELECT 1 FROM agreement_cnpj_locations acl
        WHERE acl.agreement_id=ac.agreement_id AND acl.supplier_id=ac.supplier_id AND acl.location_id=ai.location_id)
  ) x
  JOIN agreements a ON a.id=x.agreement_id JOIN agreement_items ai ON ai.id=x.item_id JOIN suppliers s ON s.id=x.supplier_id
  JOIN catalog_items ci ON ci.id=ai.catalog_item_id JOIN vehicle_models vm ON vm.id=ai.vehicle_model_id
  JOIN units un ON un.id=ai.unit_id JOIN locations l ON l.id=ai.location_id
  ORDER BY s.trade_name,vm.name,ci.name,l.state,l.city,ai.id`;
