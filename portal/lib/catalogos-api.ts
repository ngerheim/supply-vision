import type { ConsultaLocal } from './sqlite-local.ts';
import { EntradaInvalida, LIMITES_CAMPO, exigeTexto } from './limites-entrada.ts';
import { errorMessage, isValidCnpj, isValidState, situacaoAtiva, normalizeImportText } from './domain.ts';
import { type ContextoApi, type User, textValue, nullableText } from './api-compartilhada.ts';
import { revisaoConfere } from './controle-escrita.ts';
import { auditoriaNoLote, AUDITAR_REENVIO_SQL } from './auditoria-api.ts';

// Condicoes no proprio UPDATE protegem inclusive uma referencia criada em paralelo.
export const ATUALIZAR_UNIDADE_SQL = `UPDATE units SET code=?,name=?,active=? WHERE id=? AND revision=?
  AND (code=? OR (NOT EXISTS (SELECT 1 FROM agreement_items WHERE unit_id=units.id)
    AND NOT EXISTS (SELECT 1 FROM import_unit_mappings WHERE target_id=units.id)))`;
export const ATUALIZAR_LOCALIDADE_SQL = `UPDATE locations SET city=?,state=? WHERE id=? AND revision=?
  AND ((city=? AND state=?) OR (NOT EXISTS (SELECT 1 FROM agreement_items WHERE location_id=locations.id)
    AND NOT EXISTS (SELECT 1 FROM agreement_locations WHERE location_id=locations.id)))`;

export function catalogosApi(contexto: ContextoApi) {
  const { id, now, rawDb, normalizeCnpj, normalizeText, ok, fail, jsonBody, first } = contexto;

  type CatalogInput = Record<string, unknown>;

  // Cadastros so podem ser apagados quando nada depende deles. Caso contrario a
  // exclusao deixaria acordos e condicoes apontando para um registro inexistente,
  // entao o portal explica o que trava e sugere inativar.
  const catalogConfig: Record<string, { table: string; queries: Array<[string, string]> }> = {
    suppliers: { table: 'suppliers', queries: [['acordo(s)', 'SELECT COUNT(*) n FROM agreements WHERE supplier_id=?']] },
    items: { table: 'catalog_items', queries: [['condição(ões)', 'SELECT COUNT(*) n FROM agreement_items WHERE catalog_item_id=?'], ['correspondência(s) de De/Para', 'SELECT COUNT(*) n FROM import_item_mappings WHERE target_id=?']] },
    models: { table: 'vehicle_models', queries: [['condição(ões)', 'SELECT COUNT(*) n FROM agreement_items WHERE vehicle_model_id=?'], ['correspondência(s) de De/Para', 'SELECT COUNT(*) n FROM import_model_mappings WHERE target_id=?']] },
    units: { table: 'units', queries: [['condição(ões)', 'SELECT COUNT(*) n FROM agreement_items WHERE unit_id=?'], ['correspondência(s) de De/Para', 'SELECT COUNT(*) n FROM import_unit_mappings WHERE target_id=?']] },
    locations: { table: 'locations', queries: [['condição(ões)', 'SELECT COUNT(*) n FROM agreement_items WHERE location_id=?'], ['acordo(s)', 'SELECT COUNT(*) n FROM agreement_locations WHERE location_id=?']] },
  };

  async function deleteCatalog(user: User, type: string, recordId: string, expectedRevision: number | null) {
    const cfg = Object.hasOwn(catalogConfig, type) ? catalogConfig[type] : null;
    if (!cfg) return fail('Cadastro inválido.');
    const existing = await first<{ id: string; active: number; revision: number }>(`SELECT * FROM ${cfg.table} WHERE id=?`, [recordId]);
    if (!existing) return fail('Cadastro não encontrado.', 404);
    if(!revisaoConfere(expectedRevision,existing.revision))return fail('Registro alterado. Atualize a lista antes de excluir.',409);

    const blockers: string[] = [];
    for (const [label, sql] of cfg.queries) {
      const count = Number((await first<{ n: number }>(sql, [recordId]))?.n || 0);
      if (count > 0) blockers.push(`${count} ${label}`);
    }
    if (blockers.length) {
      return fail(`Não é possível excluir: este cadastro está em uso por ${blockers.join(' e ')}. Remova as referências antes de excluir; o cadastro foi preservado.`, 409);
    }

    const label = await first<{ nome: string }>(
      type === 'suppliers' ? 'SELECT trade_name AS nome FROM suppliers WHERE id=?'
      : type === 'units' ? 'SELECT code AS nome FROM units WHERE id=?'
      : type === 'locations' ? `SELECT city || ' / ' || state AS nome FROM locations WHERE id=?`
      : `SELECT name AS nome FROM ${cfg.table} WHERE id=?`, [recordId]);

    // A consulta acima melhora a mensagem; as FKs continuam sendo a garantia
    // final se outra requisicao criar uma referencia antes deste DELETE.
    const [excluido]=await rawDb().batch([
      rawDb().prepare(`DELETE FROM ${cfg.table} WHERE id=? AND revision=?`).bind(recordId,existing.revision),
      rawDb().prepare(AUDITAR_REENVIO_SQL).bind(id('aud'),user.id,'DELETE',type,recordId,`${label?.nome || recordId} excluído do cadastro`,now()),
    ]);
    if(!excluido.meta.changes)return fail('Registro alterado. Atualize a lista antes de excluir.',409);
    return ok({ success: true });
  }

  function exigeCamposDeCatalogo(body: CatalogInput) {
    exigeTexto(body.name, LIMITES_CAMPO.nome, 'nome');
    exigeTexto(body.tradeName, LIMITES_CAMPO.nome, 'nome fantasia');
    exigeTexto(body.legalName, LIMITES_CAMPO.nome, 'razão social');
    exigeTexto(body.code, LIMITES_CAMPO.codigo, 'código');
    exigeTexto(body.city, LIMITES_CAMPO.cidade, 'cidade');
    if (textValue(body.state) && !isValidState(body.state)) throw new EntradaInvalida('Selecione uma UF brasileira válida (ex.: GO).');
  }

  async function createCatalog(request: Request, user: User, type: string) {
    const cfg = Object.hasOwn(catalogConfig, type) ? catalogConfig[type] : null; if (!cfg) return fail('Cadastro inválido.');
    const body = await jsonBody<CatalogInput>(request), recordId = id(type.slice(0, 3)), timestamp = now();
    exigeCamposDeCatalogo(body);
    let sql = '', values: unknown[] = [];
    if (type === 'suppliers') {
      if (!textValue(body.tradeName) || !isValidCnpj(body.cnpj)) return fail('Informe o nome e um CNPJ válido.');
      sql = 'INSERT INTO suppliers (id,legal_name,trade_name,cnpj,city,state,active,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?)';
      values = [recordId, textValue(body.legalName) || textValue(body.tradeName), textValue(body.tradeName), normalizeCnpj(body.cnpj), nullableText(body.city), nullableText(body.state)?.toUpperCase().slice(0,2) ?? null, timestamp, timestamp];
    } else if (type === 'items') {
      if (!textValue(body.name)) return fail('Informe o nome da peça ou serviço.');
      sql = 'INSERT INTO catalog_items (id,name,active) VALUES (?,?,1)'; values = [recordId, normalizeText(body.name)];
    } else if (type === 'models') {
      if (!textValue(body.name)) return fail('Informe o modelo.');
      sql = 'INSERT INTO vehicle_models (id,name,active) VALUES (?,?,1)'; values = [recordId, normalizeText(body.name)];
    } else if (type === 'units') {
      if (!textValue(body.code)) return fail('Informe a unidade de medida.');
      // name existe no banco como NOT NULL e o importador casa a MEDIDA da
      // planilha contra codigo OU descricao. Gravando os dois iguais, a unidade
      // passa a ter uma grafia so e o caso de "unidade ambigua" deixa de existir.
      sql = 'INSERT INTO units (id,code,name,active) VALUES (?,?,?,1)'; values = [recordId, normalizeText(body.code), normalizeText(body.code)];
    } else {
      const state = normalizeText(body.state);
      if (!normalizeImportText(body.city) || !isValidState(state)) return fail('Informe a cidade e selecione uma UF brasileira válida.');
      // Mesma forma canonica que a importacao usa para comparar: sem acento e
      // em maiusculas. Gravar "São Paulo" aqui criaria um registro que a
      // planilha nunca encontraria.
      sql = 'INSERT INTO locations (id,city,state) VALUES (?,?,?)'; values = [recordId, normalizeImportText(body.city), state];
    }
    try { await rawDb().batch([rawDb().prepare(sql).bind(...values), auditoriaNoLote(contexto, user.id, 'CREATE', type, recordId, 'Cadastro incluído')]); return ok({ id: recordId }, { status: 201 }); }
    catch (erro: unknown) { if(errorMessage(erro).includes('UNIQUE'))return fail('Já existe um cadastro com esses dados.'); throw erro; }
  }

  async function updateCatalog(request: Request, user: User, type: string, recordId: string) {
    const cfg = Object.hasOwn(catalogConfig, type) ? catalogConfig[type] : null;
    if (!cfg) return fail('Cadastro inválido.');
    const body = await jsonBody<CatalogInput>(request);
    exigeCamposDeCatalogo(body);
    const existing = await first<{ id: string; active: number; revision: number }>(`SELECT * FROM ${cfg.table} WHERE id=?`, [recordId]);
    if (!existing) return fail('Cadastro não encontrado.', 404);
    if(!revisaoConfere(body.expectedRevision,existing.revision))return fail('Cadastro alterado. Atualize a lista antes de salvar.',409);
    const active = situacaoAtiva(body.active, existing.active);
    let escrita: ConsultaLocal;
    try {
      if (type === 'suppliers') {
        if (!textValue(body.tradeName) || !isValidCnpj(body.cnpj)) return fail('Informe o nome e um CNPJ válido.');
        escrita = rawDb().prepare('UPDATE suppliers SET legal_name=?,trade_name=?,cnpj=?,city=?,state=?,active=?,updated_at=? WHERE id=? AND revision=?').bind(textValue(body.legalName) || textValue(body.tradeName), textValue(body.tradeName), normalizeCnpj(body.cnpj), nullableText(body.city), nullableText(body.state)?.toUpperCase().slice(0,2) ?? null, active, now(), recordId,existing.revision);
      } else if (type === 'items') {
        if (!textValue(body.name)) return fail('Informe o nome da peça ou serviço.');
        escrita = rawDb().prepare('UPDATE catalog_items SET name=?,active=? WHERE id=? AND revision=?').bind(normalizeText(body.name), active, recordId,existing.revision);
      } else if (type === 'models') {
        if (!textValue(body.name)) return fail('Informe o modelo.');
        escrita = rawDb().prepare('UPDATE vehicle_models SET name=?,active=? WHERE id=? AND revision=?').bind(normalizeText(body.name), active, recordId,existing.revision);
      } else if (type === 'units') {
        if (!textValue(body.code)) return fail('Informe a unidade de medida.');
        escrita = rawDb().prepare(ATUALIZAR_UNIDADE_SQL).bind(normalizeText(body.code), normalizeText(body.code), active, recordId,existing.revision,normalizeText(body.code));
      } else {
        const state = normalizeText(body.state);
        if (!normalizeImportText(body.city) || !isValidState(state)) return fail('Informe a cidade e selecione uma UF brasileira válida.');
        escrita = rawDb().prepare(ATUALIZAR_LOCALIDADE_SQL).bind(normalizeImportText(body.city), state, recordId,existing.revision,normalizeImportText(body.city),state);
      }
      const [alterado]=await rawDb().batch([escrita, rawDb().prepare(AUDITAR_REENVIO_SQL).bind(id('aud'),user.id,'UPDATE',type,recordId,'Cadastro atualizado',now())]);
      if(!alterado.meta.changes)return fail('Cadastro alterado ou código/localidade em uso. Preserve sua identidade e crie outro cadastro para uma unidade ou localidade diferente.',409);
      return ok({ success: true });
    } catch (error: unknown) {
      if (errorMessage(error).includes('UNIQUE')) return fail('Já existe um cadastro com esses dados.'); throw error;
    }
  }

  return { createCatalog, updateCatalog, deleteCatalog };
}
