// Condicoes no proprio UPDATE protegem inclusive uma referencia criada em paralelo.
export const ATUALIZAR_UNIDADE_SQL = `UPDATE units SET code=?,name=?,active=? WHERE id=? AND revision=?
  AND (code=? OR (NOT EXISTS (SELECT 1 FROM agreement_items WHERE unit_id=units.id)
    AND NOT EXISTS (SELECT 1 FROM import_unit_mappings WHERE target_id=units.id)))`;
export const ATUALIZAR_LOCALIDADE_SQL = `UPDATE locations SET city=?,state=? WHERE id=? AND revision=?
  AND ((city=? AND state=?) OR (NOT EXISTS (SELECT 1 FROM agreement_items WHERE location_id=locations.id)
    AND NOT EXISTS (SELECT 1 FROM agreement_locations WHERE location_id=locations.id)))`;
