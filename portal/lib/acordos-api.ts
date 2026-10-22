import { pode } from './permissoes.ts';
import { consultaBusca, consultasOpcoesBusca } from './consulta-busca.ts';
import { dataDeNegocio } from './data-negocio.ts';
import { SITUACAO_EFETIVA_SQL } from './situacao-acordos.ts';
import { corpoBinarioLimitado } from './corpo-limitado.ts';
import { CORPO_MAX_JSON, LIMITES_CAMPO, LIMITE_LISTA, exigeTexto } from './limites-entrada.ts';
import { AGREEMENT_STATUSES, errorMessage, isOneOf, isValidDateRange, toNonNegativeMoney } from './domain.ts';
import { type ContextoApi, type User, type Row, textValue, nullableText, stringList } from './api-compartilhada.ts';
import { revisaoConfere } from './controle-escrita.ts';
import { auditoriaNoLote } from './auditoria-api.ts';

export function acordosApi(contexto: ContextoApi) {
  const { id, now, rawDb, adquirirTrava, liberarTrava, ok, fail, jsonBody, all, first } = contexto;

  type AgreementInput = {
    expectedRevision?: unknown;
    number?: unknown;
    supplierId?: unknown;
    status?: unknown;
    startDate?: unknown;
    endDate?: unknown;
    notes?: unknown;
    locationIds?: unknown;
  };

  type AgreementItemInput = {
    expectedRevision?: unknown;
    catalogItemId?: unknown;
    locationId?: unknown;
    unitId?: unknown;
    modelId?: unknown;
    modelIds?: unknown;
    price?: unknown;
    brands?: unknown;
    notes?: unknown;
  };

  // Aplicado em validateAgreementInput, abaixo.
  type ValidAgreementInput = {
    number: string;
    supplierId: string;
    status: (typeof AGREEMENT_STATUSES)[number];
    startDate: string;
    endDate: string | null;
    notes: string | null;
    locationIds: string[];
  };

  function validateAgreementInput(body: AgreementInput): { value?: ValidAgreementInput; error?: string } {
    const number = textValue(body.number);
    const supplierId = textValue(body.supplierId);
    const startDate = textValue(body.startDate);
    const endDate = nullableText(body.endDate);
    // Sem status, o acordo nasce vigente, como na tela. 'draft' nao e mais uma
    // situacao valida e so produzia a mensagem de situacao invalida.
    const status = body.status ?? 'active';
    const locationIds = Array.from(new Set(stringList(body.locationIds)));
    if (!number || !supplierId || !startDate) return { error: 'Número, fornecedor e início da vigência são obrigatórios.' };
    if (number.length > 80) return { error: 'O número do acordo deve ter no máximo 80 caracteres.' };
    if (!isOneOf(status, AGREEMENT_STATUSES)) return { error: 'Situação do acordo inválida.' };
    if (!isValidDateRange(startDate, endDate)) return { error: 'Confira as datas: o fim não pode ser anterior ao início.' };
    if (textValue(body.notes).length > LIMITES_CAMPO.observacoes) return { error: `As observações passam do limite de ${LIMITES_CAMPO.observacoes} caracteres.` };
    if (locationIds.length > LIMITE_LISTA) return { error: `O acordo tem ${locationIds.length} localidades, acima do limite de ${LIMITE_LISTA}.` };
    if (!locationIds.length) return { error: 'Selecione pelo menos uma localidade.' };
    return { value: { number, supplierId, status, startDate, endDate, notes: nullableText(body.notes), locationIds } };
  }

  async function deleteItem(user: User, itemId: string, expectedRevision: number | null) {
    // A versao vigente precisa ser conferida depois de adquirir a trava: uma
    // publicacao concorrente nao pode trocar a versao entre a leitura e o DELETE.
    const item = await first<Row>('SELECT ai.*,a.id AS agreementId,a.number AS agreementNumber FROM agreement_items ai JOIN agreements a ON a.current_version_id=ai.version_id WHERE ai.id=?', [itemId]);
    if (!item) return fail('Condição não encontrada na versão vigente.', 404);
    if (!revisaoConfere(expectedRevision, Number(item.revision))) return fail('Esta condição foi alterada ou a tela está desatualizada. Reabra o acordo antes de remover.', 409);
    await rawDb().batch([
      rawDb().prepare('DELETE FROM agreement_items WHERE id=?').bind(itemId),
      rawDb().prepare('INSERT INTO audit_logs (id,user_id,action,entity,entity_id,details,created_at) VALUES (?,?,?,?,?,?,?)')
        .bind(id('aud'), user.id, 'DELETE', 'agreement_item', itemId, JSON.stringify({ antes: item, depois: null }), now()),
    ]);
    return ok({ success: true });
  }

  // Exclusao de acordo. Só administrador: apaga preco negociado e todo o
  // historico de versoes, que e justamente o que o versionamento existe para
  // preservar. Um comprador que erra o cadastro pede ao administrador.
  //
  // Quatro tabelas apontam para agreements, e elas se dividem em duas naturezas:
  //
  //   FILHAS (existem por causa do acordo, vao junto):
  //     agreement_versions -> agreement_items
  //     agreement_locations
  //
  //   INDEPENDENTES (tem valor proprio, NAO podem ser apagadas):
  //     imports  - registro de que uma planilha foi processada, e historico
  //     tickets  - chamado de negociacao, que e trabalho da equipe
  //
  // Para as independentes a referencia e apenas anulada. Apagar um chamado
  // porque o acordo saiu seria destruir informacao que nao pertence ao acordo.
  async function deleteAgreement(user: User, agreementId: string, expectedRevision: number | null) {
    if (!pode(user, 'acordo:excluir')) {
      return fail('Somente administradores podem excluir um acordo. Um acordo apagado leva consigo os preços e todo o histórico de versões.', 403);
    }

    const acordo = await first<{ number: string; supplier: string; revision: number }>(
      'SELECT a.number, a.revision, s.trade_name AS supplier FROM agreements a JOIN suppliers s ON s.id=a.supplier_id WHERE a.id=?',
      [agreementId],
    );
    if (!acordo) return fail('Acordo não encontrado.', 404);
    if (!revisaoConfere(expectedRevision, Number(acordo.revision))) return fail('Este acordo foi alterado ou a tela está desatualizada. Reabra o acordo antes de excluir.', 409);

    // Conta antes de apagar, para o registro de auditoria dizer o tamanho do
    // estrago e permitir conferir depois.
    const condicoes = Number((await first<{ n: number }>(
      'SELECT COUNT(*) n FROM agreement_items WHERE version_id IN (SELECT id FROM agreement_versions WHERE agreement_id=?)',
      [agreementId]))?.n || 0);
    const versoes = Number((await first<{ n: number }>(
      'SELECT COUNT(*) n FROM agreement_versions WHERE agreement_id=?', [agreementId]))?.n || 0);
    const chamados = Number((await first<{ n: number }>(
      'SELECT COUNT(*) n FROM tickets WHERE agreement_id=?', [agreementId]))?.n || 0);

    const detalhe = `Acordo ${acordo.number} (${acordo.supplier}) excluído: ${condicoes} condição(ões) e ${versoes} versão(ões) apagadas` +
      (chamados > 0 ? `; ${chamados} chamado(s) preservado(s), sem o vínculo` : '');
    const db = rawDb();
    await db.batch([
      // current_version_id aponta para agreement_versions: precisa sair antes,
      // senao a exclusao das versoes viola a chave estrangeira.
      db.prepare('UPDATE agreements SET current_version_id=NULL WHERE id=?').bind(agreementId),
      db.prepare('DELETE FROM agreement_items WHERE version_id IN (SELECT id FROM agreement_versions WHERE agreement_id=?)').bind(agreementId),
      db.prepare('DELETE FROM agreement_versions WHERE agreement_id=?').bind(agreementId),
      db.prepare('DELETE FROM agreement_locations WHERE agreement_id=?').bind(agreementId),
      // Independentes: perdem o vinculo, nao a existencia.
      db.prepare('UPDATE imports SET agreement_id=NULL WHERE agreement_id=?').bind(agreementId),
      db.prepare('UPDATE tickets SET agreement_id=NULL WHERE agreement_id=?').bind(agreementId),
      db.prepare('DELETE FROM agreements WHERE id=?').bind(agreementId),
      auditoriaNoLote(contexto, user.id, 'DELETE', 'agreement', agreementId, detalhe),
    ]);
    return ok({ success: true, condicoes, versoes, chamadosDesvinculados: chamados });
  }

  async function agreementList() {
    return all(`SELECT a.id,a.number,a.status,a.start_date AS startDate,a.end_date AS endDate,a.updated_at AS updatedAt,
    ${SITUACAO_EFETIVA_SQL} AS effectiveStatus,
    s.trade_name AS supplier,s.cnpj,
    (SELECT COUNT(*) FROM agreement_locations al WHERE al.agreement_id=a.id) AS locationCount,
    (SELECT COUNT(*) FROM agreement_items ai WHERE ai.version_id=a.current_version_id) AS itemCount,
    (SELECT GROUP_CONCAT(l.city || ' / ' || l.state) FROM agreement_locations al JOIN locations l ON l.id=al.location_id WHERE al.agreement_id=a.id) AS locations
    FROM agreements a JOIN suppliers s ON s.id=a.supplier_id
    ORDER BY a.updated_at DESC`, [dataDeNegocio()]);
  }

  async function agreementDetail(agreementId: string, user: User, params: URLSearchParams) {
    const requestedOffset = Number(params.get('offset') || 0);
    const offset = Number.isSafeInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0;
    const limit = 500;
    const sortColumns: Record<string, string> = {
      item: 'ci.name', model: 'vm.name', location: "l.state || '/' || l.city",
      brands: "COALESCE(ai.brands_text,'')", unit: 'un.code', price: 'ai.price',
    };
    const sort = params.get('sort') || 'item';
    const sortColumn = Object.hasOwn(sortColumns, sort) ? sortColumns[sort] : sortColumns.item;
    const sortDirection = params.get('direction') === 'desc' ? 'DESC' : 'ASC';
    // Metadados e pagina sao lidos no mesmo snapshot SQLite.
    const db = rawDb();
    const [cabecalho, locais, condicoes, historico] = await db.batch([
      db.prepare(`SELECT a.*,
    (SELECT COUNT(*) FROM agreement_items ai WHERE ai.version_id=a.current_version_id) AS totalItems,
    ${SITUACAO_EFETIVA_SQL} AS effectiveStatus,
    s.trade_name AS supplier,s.legal_name AS legalName,s.cnpj,u.name AS owner
    FROM agreements a JOIN suppliers s ON s.id=a.supplier_id LEFT JOIN users u ON u.id=a.owner_user_id WHERE a.id=?2`).bind(dataDeNegocio(), agreementId),
      db.prepare(`SELECT l.id,l.city,l.state FROM agreement_locations al JOIN locations l ON l.id=al.location_id WHERE al.agreement_id=? ORDER BY l.state,l.city`).bind(agreementId),
      db.prepare(`SELECT ai.id,ai.revision,ai.price,ai.courtesy,ai.brands_text AS brands,ai.notes,ci.id AS catalogItemId,ci.name AS item,
      vm.id AS modelId,vm.name AS model,un.id AS unitId,un.code AS unit,l.id AS locationId,l.city,l.state
      FROM agreements a JOIN agreement_items ai ON ai.version_id=a.current_version_id JOIN catalog_items ci ON ci.id=ai.catalog_item_id
      JOIN vehicle_models vm ON vm.id=ai.vehicle_model_id JOIN units un ON un.id=ai.unit_id JOIN locations l ON l.id=ai.location_id
      WHERE a.id=? ORDER BY ${sortColumn} ${sortDirection},ai.id ASC LIMIT ? OFFSET ?`).bind(agreementId, limit, offset),
      db.prepare(`SELECT version_number AS versionNumber,status,published_at AS publishedAt,created_at AS createdAt FROM agreement_versions WHERE agreement_id=? AND status='published' ORDER BY version_number DESC`).bind(agreementId),
    ]);
    const agreement = cabecalho.results[0] as Row | undefined;
    if (!agreement) return fail('Acordo não encontrado.', 404);
    const locations = locais.results as Row[], rows = condicoes.results as Row[], versions = historico.results as Row[];
    if (!pode(user, 'acordo:consultar-completo')) {
      const { id, number, status, start_date, end_date, effectiveStatus, supplier, cnpj } = agreement;
      return ok({ agreement: { id, number, status, start_date, end_date, effectiveStatus, supplier, cnpj }, locations,
        totalItems: agreement.totalItems, offset, limit, revision: agreement.revision, version: agreement.current_version_id,
        items: rows.map(({ notes: _notes, ...item }) => item),
        versions: versions.map(({ versionNumber }) => ({ versionNumber })),
      });
    }
    return ok({ agreement, locations, items: rows, versions, totalItems: agreement.totalItems, offset, limit, revision: agreement.revision, version: agreement.current_version_id });
  }

  async function createAgreement(request: Request, user: User) {
    const parsed = validateAgreementInput(await jsonBody<AgreementInput>(request));
    if (!parsed.value) return fail(parsed.error || 'Dados do acordo inválidos.');
    const body = parsed.value;
    const supplier = await first<{ id: string }>('SELECT id FROM suppliers WHERE id=? AND active=1', [body.supplierId]);
    if (!supplier) return fail('Fornecedor não encontrado ou inativo.');
    const locations = await first<{ n: number }>(`SELECT COUNT(*) n FROM locations WHERE id IN (${body.locationIds.map(() => '?').join(',')})`, body.locationIds);
    if (Number(locations?.n || 0) !== body.locationIds.length) return fail('Uma ou mais localidades não existem.');
    const agreementId = id('agr'), versionId = id('ver'), timestamp = now();
    try {
      await rawDb().batch([
        rawDb().prepare(`INSERT INTO agreements (id,number,supplier_id,status,start_date,end_date,owner_user_id,notes,provisional,current_version_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,0,?,?,?)`).bind(agreementId, body.number, body.supplierId, body.status, body.startDate, body.endDate, user.id, body.notes, versionId, timestamp, timestamp),
        rawDb().prepare(`INSERT INTO agreement_versions (id,agreement_id,version_number,status,published_at,created_by,created_at) VALUES (?,?,1,'published',?,?,?)`).bind(versionId, agreementId, timestamp, user.id, timestamp),
        ...body.locationIds.map((locationId) => rawDb().prepare('INSERT INTO agreement_locations (agreement_id,location_id) VALUES (?,?)').bind(agreementId, locationId)),
        auditoriaNoLote(contexto, user.id, 'CREATE', 'agreement', agreementId, `Acordo ${body.number} criado`),
      ]);
      return ok({ id: agreementId }, { status: 201 });
    } catch (error: unknown) { if (errorMessage(error).includes('UNIQUE')) return fail('Já existe um acordo com esse número.'); throw error; }
  }

  // Verificar e gravar a abrangencia e as condicoes de um acordo precisa ser uma
  // operacao so. Sem isso, duas pessoas no mesmo acordo ao mesmo tempo -- uma
  // retirando uma cidade, outra incluindo preco nela -- passavam as duas
  // verificacoes, e a condicao ficava fora da abrangencia. Editar o acordo,
  // incluir ou editar condicao e publicar importacao pegam a trava do acordo
  // antes de verificar; quem chega com ela ocupada recebe 409 e tenta de novo.
  // E o mesmo mecanismo da trava de importacao (PRIMARY KEY em travas).
  async function comTravaDoAcordo(request: Request, agreementId: string | null, operacao: () => Promise<Response>) {
    if (!agreementId) return operacao();
    const dono = await travarAcordo(agreementId);
    if (!dono) {
      // O corpo precisa ser consumido antes da resposta antecipada (ver denyWrite).
      if (request.body) await corpoBinarioLimitado(request, CORPO_MAX_JSON);
      return fail('Outro usuário está alterando este acordo neste momento. Tente de novo em instantes.', 409);
    }
    try { return await operacao(); }
    finally { await soltarAcordo(agreementId, dono); }
  }

  async function travarAcordo(agreementId: string) {
    const dono = id('lck');
    return await adquirirTrava(`acordo:${agreementId}`, dono) ? dono : null;
  }

  async function soltarAcordo(agreementId: string, dono: string) {
    // Falha ao soltar nao desfaz o que ja foi gravado; a trava vence sozinha.
    try { await liberarTrava(`acordo:${agreementId}`, dono); }
    catch (erro) { console.error('[portal] nao foi possivel liberar a trava do acordo:', erro); }
  }

  async function acordoDaCondicao(itemId: string) {
    const linha = await first<{ agreementId: string }>('SELECT v.agreement_id AS agreementId FROM agreement_items ai JOIN agreement_versions v ON v.id=ai.version_id WHERE ai.id=?', [itemId]);
    return linha?.agreementId ?? null;
  }

  async function updateAgreement(request: Request, user: User, agreementId: string) {
    const entrada = await jsonBody<AgreementInput>(request);
    const parsed = validateAgreementInput(entrada);
    if (!parsed.value) return fail(parsed.error || 'Dados do acordo inválidos.');
    const body = parsed.value;
    const existing = await first<{ id: string; number: string; supplierId: string; status: string; startDate: string; endDate: string; notes: string | null; revision: number }>('SELECT id,number,supplier_id AS supplierId,status,start_date AS startDate,end_date AS endDate,notes,revision FROM agreements WHERE id=?', [agreementId]);
    if (!existing) return fail('Acordo não encontrado.', 404);
    // A trava já está adquirida: uma tela antiga não pode substituir o snapshot
    // que outro usuário gravou. Ausência de revisão também exige recarregar.
    if (!revisaoConfere(entrada.expectedRevision, existing.revision)) return fail('Este acordo foi alterado ou a tela está desatualizada. Reabra o acordo antes de salvar.', 409);
    // Trocar de fornecedor exige um fornecedor ativo, como na criacao. Manter o
    // fornecedor atual continua permitido mesmo que ele tenha sido inativado
    // depois: editar as datas de um acordo antigo nao pode ficar bloqueado.
    const trocaFornecedor = body.supplierId !== existing.supplierId;
    const supplier = await first<{ id: string }>(`SELECT id FROM suppliers WHERE id=?${trocaFornecedor ? ' AND active=1' : ''}`, [body.supplierId]);
    if (!supplier) return fail(trocaFornecedor ? 'Fornecedor não encontrado ou inativo.' : 'Fornecedor não encontrado.');
    const locations = await first<{ n: number }>(`SELECT COUNT(*) n FROM locations WHERE id IN (${body.locationIds.map(() => '?').join(',')})`, body.locationIds);
    if (Number(locations?.n || 0) !== body.locationIds.length) return fail('Uma ou mais localidades não existem.');
    // Retirar do acordo uma localidade que ainda tem condicoes na versao vigente
    // criava duas verdades: o acordo dizia nao atender a cidade, mas a busca de
    // precos, que parte das condicoes, continuava mostrando o preco dela. A
    // remocao e recusada; as condicoes daquela cidade saem ou mudam antes.
    // Versoes anteriores nao contam: sao historico.
    const emUso = await all<{ city: string; state: string }>(`SELECT DISTINCT l.city,l.state
    FROM agreements a JOIN agreement_items ai ON ai.version_id=a.current_version_id JOIN locations l ON l.id=ai.location_id
    WHERE a.id=? AND ai.location_id NOT IN (SELECT value FROM json_each(?)) ORDER BY l.state,l.city`, [agreementId, JSON.stringify(body.locationIds)]);
    if (emUso.length) {
      const nomes = emUso.slice(0, 5).map((local) => `${local.city}/${local.state}`).join(', ') + (emUso.length > 5 ? ` e mais ${emUso.length - 5}` : '');
      return fail(`Não é possível retirar ${nomes} do acordo: há condições vigentes nessa(s) localidade(s). Remova ou substitua essas condições antes de alterar a abrangência.`, 409);
    }
    // Auditoria no mesmo formato das condicoes: {antes, depois} so dos campos
    // gerais que mudaram.
    const localidadesAntes = (await all<{ id: string }>('SELECT location_id AS id FROM agreement_locations WHERE agreement_id=? ORDER BY location_id', [agreementId])).map((l) => l.id);
    const novo: Record<string, unknown> = { number: body.number, supplierId: body.supplierId, status: body.status, startDate: body.startDate, endDate: body.endDate, notes: body.notes, locationIds: [...body.locationIds].sort() };
    const anterior: Record<string, unknown> = { number: existing.number, supplierId: existing.supplierId, status: existing.status, startDate: existing.startDate, endDate: existing.endDate, notes: existing.notes, locationIds: localidadesAntes };
    const antes: Record<string, unknown> = {}, depois: Record<string, unknown> = {};
    for (const campo of Object.keys(novo)) {
      if (JSON.stringify(anterior[campo]) !== JSON.stringify(novo[campo])) { antes[campo] = anterior[campo]; depois[campo] = novo[campo]; }
    }
    try {
      await rawDb().batch([
        rawDb().prepare('UPDATE agreements SET number=?,supplier_id=?,status=?,start_date=?,end_date=?,notes=?,updated_at=? WHERE id=?').bind(body.number, body.supplierId, body.status, body.startDate, body.endDate, body.notes, now(), agreementId),
        rawDb().prepare('DELETE FROM agreement_locations WHERE agreement_id=?').bind(agreementId),
        ...body.locationIds.map((locationId) => rawDb().prepare('INSERT INTO agreement_locations (agreement_id,location_id) VALUES (?,?)').bind(agreementId, locationId)),
        auditoriaNoLote(contexto, user.id, 'UPDATE', 'agreement', agreementId, JSON.stringify({ antes, depois })),
      ]);
      return ok({ success: true });
    } catch (error: unknown) {
      if (errorMessage(error).includes('UNIQUE')) return fail('Já existe um acordo com esse número.'); throw error;
    }
  }

  async function addAgreementItems(request: Request, user: User, agreementId: string) {
    const body = await jsonBody<AgreementItemInput>(request);
    const catalogItemId = textValue(body.catalogItemId), locationId = textValue(body.locationId), unitId = textValue(body.unitId);
    const modelIds = Array.from(new Set(stringList(body.modelIds))), price = toNonNegativeMoney(body.price);
    // A consulta de validacao monta IN (?,?,...) com um parametro por modelo.
    if (modelIds.length > LIMITE_LISTA) return fail(`Selecione no máximo ${LIMITE_LISTA} modelos por condição.`);
    exigeTexto(body.brands, LIMITES_CAMPO.marcas, 'marcas');
    exigeTexto(body.notes, LIMITES_CAMPO.observacoes, 'observações');
    if (!catalogItemId || !locationId || !unitId || !modelIds.length || price === null) return fail('Preencha item, localidade, modelos, unidade e um preço válido.');
    const agreement = await first<{ current_version_id: string }>('SELECT current_version_id FROM agreements WHERE id=?', [agreementId]);
    if (!agreement) return fail('Acordo não encontrado.', 404);
    const permittedLocation = await first('SELECT 1 ok FROM agreement_locations WHERE agreement_id=? AND location_id=?', [agreementId, locationId]);
    if (!permittedLocation) return fail('A localidade selecionada não pertence à abrangência do acordo.');
    const references = await Promise.all([
      first('SELECT 1 ok FROM catalog_items WHERE id=? AND active=1', [catalogItemId]),
      first('SELECT 1 ok FROM units WHERE id=? AND active=1', [unitId]),
      first<{ n: number }>(`SELECT COUNT(*) n FROM vehicle_models WHERE active=1 AND id IN (${modelIds.map(() => '?').join(',')})`, modelIds),
    ]);
    if (!references[0] || !references[1] || Number(references[2]?.n || 0) !== modelIds.length) return fail('Item, unidade ou modelo inválido/inativo.');
    const duplicate = await first(`SELECT id FROM agreement_items
    WHERE version_id=? AND location_id=? AND catalog_item_id=? AND unit_id=?
    AND vehicle_model_id IN (${modelIds.map(() => '?').join(',')}) LIMIT 1`,
      [agreement.current_version_id, locationId, catalogItemId, unitId, ...modelIds]);
    if (duplicate) return fail('Já existe uma condição para um dos modelos selecionados. Edite a condição existente para alterar o preço.', 409);
    const timestamp = now();
    try {
      await rawDb().batch([...modelIds.map((modelId) => rawDb().prepare(`INSERT INTO agreement_items (id,version_id,location_id,catalog_item_id,vehicle_model_id,unit_id,price,courtesy,brands_text,notes,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id('itm'), agreement.current_version_id, locationId, catalogItemId, modelId, unitId, price, price === 0 ? 1 : 0, nullableText(body.brands), nullableText(body.notes), timestamp, timestamp)),
        rawDb().prepare('INSERT INTO audit_logs (id,user_id,action,entity,entity_id,details,created_at) VALUES (?,?,?,?,?,?,?)')
          .bind(id('aud'), user.id, 'CREATE', 'agreement_item', agreementId, `${modelIds.length} condição(ões) cadastrada(s)`, timestamp),
      ]);
    } catch (error: unknown) {
      if (errorMessage(error).includes('UNIQUE')) return fail('Já existe uma condição igual. Edite a condição existente para alterar o preço.', 409);
      throw error;
    }
    return ok({ success: true });
  }

  async function updateItem(request: Request, user: User, itemId: string) {
    // Os mesmos tetos de addAgreementItems. Faltavam aqui: dava para criar uma
    // condicao dentro do limite e depois edita-la sem limite nenhum.
    const body = await jsonBody<AgreementItemInput>(request);
    exigeTexto(body.brands, LIMITES_CAMPO.marcas, 'marcas');
    exigeTexto(body.notes, LIMITES_CAMPO.observacoes, 'observações');
    const catalogItemId = textValue(body.catalogItemId), locationId = textValue(body.locationId), unitId = textValue(body.unitId), modelId = textValue(body.modelId);
    const price = toNonNegativeMoney(body.price);
    if (!catalogItemId || !locationId || !unitId || !modelId || price === null) return fail('Preencha item, localidade, modelo, unidade e um preço válido.');
    const existing = await first<{ agreementId: string; revision: number; price: number; unit_id: string; location_id: string; catalog_item_id: string; vehicle_model_id: string; brands_text: string|null; notes: string|null }>(`SELECT ai.*,a.id AS agreementId FROM agreement_items ai JOIN agreements a ON a.current_version_id=ai.version_id WHERE ai.id=?`, [itemId]);
    if (!existing) return fail('Condição não encontrada na versão vigente.', 404);
    if (!revisaoConfere(body.expectedRevision, existing.revision)) return fail('Esta condição foi alterada ou a tela está desatualizada. Reabra o acordo antes de salvar.', 409);
    const permittedLocation = await first('SELECT 1 ok FROM agreement_locations WHERE agreement_id=? AND location_id=?', [existing.agreementId, locationId]);
    if (!permittedLocation) return fail('A localidade selecionada não pertence à abrangência do acordo.');
    const references = await Promise.all([
      first('SELECT 1 ok FROM catalog_items WHERE id=? AND active=1', [catalogItemId]),
      first('SELECT 1 ok FROM vehicle_models WHERE id=? AND active=1', [modelId]),
      first('SELECT 1 ok FROM units WHERE id=? AND active=1', [unitId]),
    ]);
    if(references.some((reference)=>!reference)) return fail('Item, modelo ou unidade inválido/inativo.');
    try{
      await rawDb().batch([rawDb().prepare('UPDATE agreement_items SET location_id=?,catalog_item_id=?,vehicle_model_id=?,unit_id=?,price=?,courtesy=?,brands_text=?,notes=?,updated_at=? WHERE id=?')
        .bind(locationId, catalogItemId, modelId, unitId, price, price === 0 ? 1 : 0, nullableText(body.brands), nullableText(body.notes), now(), itemId),
        rawDb().prepare('INSERT INTO audit_logs (id,user_id,action,entity,entity_id,details,created_at) VALUES (?,?,?,?,?,?,?)').bind(id('aud'),user.id,'UPDATE','agreement_item',itemId,JSON.stringify({antes:existing,depois:{location_id:locationId,catalog_item_id:catalogItemId,vehicle_model_id:modelId,unit_id:unitId,price,brands_text:nullableText(body.brands),notes:nullableText(body.notes)}}),now())]);
    }catch(error:unknown){
      if (errorMessage(error).includes('UNIQUE')) return fail('Já existe uma condição igual na versão vigente.'); throw error;
    }
    return ok({ success: true });
  }

  async function search(params: URLSearchParams) {
    const { sql, values } = consultaBusca(params, dataDeNegocio());
    const total = Number((await first<{ n: number }>(`SELECT COUNT(*) n ${sql}`, values))?.n || 0);
    const limit = 1000;
    const rows = await all(`SELECT ai.id,ci.name AS item,vm.name AS model,ai.price,ai.courtesy,un.code AS unit,ai.brands_text AS brands,
    l.city,l.state,s.trade_name AS supplier,s.cnpj,a.id AS agreementId,a.number,a.end_date AS endDate
    ${sql} ORDER BY ci.name,vm.name,l.city,ai.price LIMIT ${limit}`, values);
    return ok({ rows, total, truncated: total > rows.length, limit });
  }

  async function searchOptions(params: URLSearchParams) {
    const consultas = consultasOpcoesBusca(params, dataDeNegocio());
    const options = Object.fromEntries(await Promise.all(consultas.map(async ({ campo, sql, values }) =>
      [campo, await all<{ id: string; name: string }>(sql, values)] as const)));
    return ok({ options });
  }

  async function internalAgreements(){
    const agreements=await all(`SELECT vm.name MODELO,ci.name PECA_SERVICO,l.city CIDADE,l.state UF,s.cnpj CNPJ,
    ai.price PRECO,s.trade_name FORNECEDOR,un.code MEDIDA,COALESCE(ai.brands_text,'') MARCAS,
    a.start_date INICIO_VIGENCIA,a.end_date FIM_VIGENCIA,a.status STATUS_ACORDO
    FROM agreements a JOIN suppliers s ON s.id=a.supplier_id
    JOIN agreement_items ai ON ai.version_id=a.current_version_id
    JOIN catalog_items ci ON ci.id=ai.catalog_item_id JOIN vehicle_models vm ON vm.id=ai.vehicle_model_id
    JOIN units un ON un.id=ai.unit_id JOIN locations l ON l.id=ai.location_id
    ORDER BY s.trade_name,vm.name,ci.name,l.state,l.city,ai.id`);
    return ok({generatedAt:now(),agreements});
  }

  return { agreementList, agreementDetail, createAgreement, updateAgreement, addAgreementItems, updateItem, deleteItem, deleteAgreement, comTravaDoAcordo, travarAcordo, soltarAcordo, acordoDaCondicao, search, searchOptions, internalAgreements };
}
