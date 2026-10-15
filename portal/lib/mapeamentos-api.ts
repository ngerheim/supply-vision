import { LIMITES_CAMPO, exigeTexto } from './limites-entrada.ts';
import { errorMessage, normalizeImportText } from './domain.ts';
import { type ContextoApi, type User, canWrite, textValue, nullableText } from './api-compartilhada.ts';
import { revisaoConfere } from './controle-escrita.ts';
import { auditoriaNoLote, AUDITAR_REENVIO_SQL } from './auditoria-api.ts';

export function mapeamentosApi(contexto: ContextoApi) {
  const { id, now, rawDb, ok, fail, denyWrite, jsonBody, all, first } = contexto;

  type MappingInput = { expectedRevision?: unknown; source?: unknown; targetId?: unknown; active?: unknown; notes?: unknown };

  const mappingConfig: Record<string, { table: string; targetTable: string; label: string }> = {
    items: { table: 'import_item_mappings', targetTable: 'catalog_items', label: 'item' },
    models: { table: 'import_model_mappings', targetTable: 'vehicle_models', label: 'modelo' },
    units: { table: 'import_unit_mappings', targetTable: 'units', label: 'unidade' },
    // Localidade nao tem De/Para: cidade nao e nomenclatura a traduzir, e apontar
    // uma cidade para outra so serve para esconder erro de digitacao.
  };

  async function mappingList() {
    const select = (table: string, target: string, label = 't.name') => all(`SELECT m.id,m.revision,m.source_text AS source,m.source_key AS sourceKey,m.target_id AS targetId,${label} AS target,m.active,m.notes,m.updated_at AS updatedAt
    FROM ${table} m JOIN ${target} t ON t.id=m.target_id ORDER BY m.source_key`);
    const [items, models, units] = await Promise.all([
      select('import_item_mappings', 'catalog_items'),
      select('import_model_mappings', 'vehicle_models'),
      select('import_unit_mappings', 'units', 't.code'),
    ]);
    return ok({ items, models, units });
  }

  async function validateMappingInput(request: Request, type: string) {
    // O corpo e lido antes de qualquer recusa: devolver resposta sem consumir a
    // requisicao derruba a conexao do Worker, e o cliente recebe 500 no lugar do
    // 400 que explica o problema.
    const body = await jsonBody<MappingInput>(request);
    const cfg = mappingConfig[type];
    if (!cfg) return { error: 'Tipo de De/Para inválido.' };
    const source = textValue(body.source), targetId = textValue(body.targetId);
    const sourceKey = normalizeImportText(source);
    exigeTexto(body.source, LIMITES_CAMPO.nome, 'nomenclatura de origem');
    exigeTexto(body.notes, LIMITES_CAMPO.observacoes, 'observações');
    if (!sourceKey || !targetId) return { error: 'Informe a nomenclatura de origem e o destino.' };
    const target = await first(`SELECT 1 ok FROM ${cfg.targetTable} WHERE id=? AND active=1`, [targetId]);
    if (!target) return { error: `O ${cfg.label} de destino não existe ou está inativo.` };
    if (type === 'units') {
      // Inclusive as inativas: uma medida desativada continua sendo uma medida, e
      // redirecionar LITRO para UNIDADE muda o significado de todo preco da carga
      // sem travar nada nem avisar ninguem.
      const units = await all<{ id: string; code: string; name: string }>('SELECT id,code,name FROM units');
      if (units.some(unit => unit.id !== targetId && [unit.code,unit.name].some(value => normalizeImportText(value) === sourceKey))) return { error: 'Essa origem já identifica outra unidade cadastrada. Confira a medida.' };
    }
    return { cfg, body, source: source.trim(), sourceKey, targetId, notes: nullableText(body.notes), active: body.active === false || body.active === 0 ? 0 : 1 };
  }

  async function createMapping(request: Request, user: User, type: string) {
    if (!canWrite(user)) return denyWrite(request, 'Seu perfil não permite gerenciar o De/Para.');
    const value = await validateMappingInput(request, type);
    if ('error' in value) return fail(value.error || 'De/Para inválido.');
    const recordId=id('map'), timestamp=now();
    try {
      await rawDb().batch([
        rawDb().prepare(`INSERT INTO ${value.cfg.table} (id,source_text,source_key,target_id,active,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
          .bind(recordId,value.source,value.sourceKey,value.targetId,value.active,value.notes,timestamp,timestamp),
        auditoriaNoLote(contexto, user.id,'CREATE','import_mapping',recordId,`De/Para de ${value.cfg.label} incluído: ${value.sourceKey}`),
      ]);
      return ok({id:recordId},{status:201});
    } catch (error: unknown) {
      if (errorMessage(error).includes('UNIQUE')) return fail('Já existe um De/Para para essa nomenclatura de origem.'); throw error;
    }
  }

  async function updateMapping(request: Request, user: User, type: string, recordId: string) {
    if (!canWrite(user)) return denyWrite(request, 'Seu perfil não permite gerenciar o De/Para.');
    const value = await validateMappingInput(request, type);
    if ('error' in value) return fail(value.error || 'De/Para inválido.');
    const existing=await first(`SELECT revision FROM ${value.cfg.table} WHERE id=?`,[recordId]);
    if(!existing) return fail('Correspondência não encontrada.',404);
    if(!revisaoConfere(value.body.expectedRevision,Number(existing.revision)))return fail('Correspondência alterada. Atualize a lista antes de salvar.',409);
    try {
      const [alterado]=await rawDb().batch([
        rawDb().prepare(`UPDATE ${value.cfg.table} SET source_text=?,source_key=?,target_id=?,active=?,notes=?,updated_at=? WHERE id=? AND revision=?`)
          .bind(value.source,value.sourceKey,value.targetId,value.active,value.notes,now(),recordId,existing.revision),
        rawDb().prepare(AUDITAR_REENVIO_SQL).bind(id('aud'),user.id,'UPDATE','import_mapping',recordId,`De/Para de ${value.cfg.label} atualizado: ${value.sourceKey}`,now()),
      ]);
      if(!alterado.meta.changes)return fail('Correspondência alterada. Atualize a lista antes de salvar.',409);
      return ok({success:true});
    } catch (error: unknown) {
      if (errorMessage(error).includes('UNIQUE')) return fail('Já existe um De/Para para essa nomenclatura de origem.'); throw error;
    }
  }

  async function deleteMapping(user: User, type: string, recordId: string, expectedRevision: number | null) {
    if (!canWrite(user)) return fail('Seu perfil não permite gerenciar o De/Para.', 403);
    const cfg=mappingConfig[type]; if(!cfg) return fail('Tipo de De/Para inválido.');
    const existing=await first<{sourceKey:string;revision:number}>(`SELECT revision,source_key AS sourceKey FROM ${cfg.table} WHERE id=?`,[recordId]);
    if(!existing) return fail('Correspondência não encontrada.',404);
    if(!revisaoConfere(expectedRevision,existing.revision))return fail('Registro alterado. Atualize a lista antes de excluir.',409);
    const [excluido]=await rawDb().batch([
      rawDb().prepare(`DELETE FROM ${cfg.table} WHERE id=? AND revision=?`).bind(recordId,existing.revision),
      rawDb().prepare(AUDITAR_REENVIO_SQL).bind(id('aud'),user.id,'DELETE','import_mapping',recordId,`De/Para de ${cfg.label} excluído: ${existing.sourceKey}`,now()),
    ]);
    if(!excluido.meta.changes)return fail('Registro alterado. Atualize a lista antes de excluir.',409);
    return ok({success:true});
  }

  // Campos de cadastro sao os mesmos em criar e editar: valida num lugar so.

  return { mappingList, createMapping, updateMapping, deleteMapping };
}
