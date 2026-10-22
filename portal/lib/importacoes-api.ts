import type { ConsultaLocal } from './sqlite-local.ts';
import { lerPlanilha } from './planilha.ts';
import { chaveLocalidade, colunasAusentes, parseImportRow, resolveImportRows, summarizeImportErrors, deduplicateImportRows, validarFornecedorImportacao, uniqueIndex, type ImportTarget } from './importacao.ts';
import { corpoBinarioLimitado } from './corpo-limitado.ts';
import { CORPO_MAX_UPLOAD, EntradaInvalida } from './limites-entrada.ts';
import { errorMessage, MAX_IMPORT_BYTES, safeFilename, normalizeImportText } from './domain.ts';
import { type ContextoApi, type User, type Row } from './api-compartilhada.ts';
import { TravaPerdida, revisaoConfere } from './controle-escrita.ts';
import { impressaoPlanoImportacao, valoresItemImportado } from './plano-importacao.ts';

export function importacoesApi(contexto: ContextoApi, acordos: Pick<ReturnType<typeof import('./acordos-api.ts').acordosApi>, 'travarAcordo' | 'soltarAcordo'>) {
  const { id, now, rawDb, TRAVA_IMPORTACAO, adquirirTrava, renovarTrava, liberarTrava, ok, fail, CorpoGrandeDemais, all, first } = contexto;
  const { travarAcordo, soltarAcordo } = acordos;

  class ConflitoImportacao extends EntradaInvalida {}

  async function importWorkbook(request: Request, user: User, agreementId: string) {
    // A trava e adquirida ANTES de ler o multipart: sem isso, uma segunda
    // importacao gastaria memoria materializando o corpo inteiro so para ser
    // recusada depois.
    const donoTrava = id('lck');
    if (!await adquirirTrava(TRAVA_IMPORTACAO, donoTrava)) {
      // Finaliza o envio sem guardar o arquivo: o proxy local precisa consumir
      // o corpo para entregar o 409 sem interromper as conexoes concorrentes.
      await corpoBinarioLimitado(request, 0);
      return fail('Já existe uma importação em andamento. Aguarde ela terminar e tente de novo.', 409);
    }
    try {
      await recuperarImportacoesInterrompidas();
      return await importWorkbookComTrava(request, user, agreementId, donoTrava);
    } finally {
      // finally cobre sucesso, planilha invalida e excecao inesperada.
      // Falha ao liberar nao pode transformar uma importacao ja publicada em
      // falso erro 500. A trava tem recuperacao por validade; registramos a
      // falha para diagnostico e preservamos a resposta verdadeira da operacao.
      try { await liberarTrava(TRAVA_IMPORTACAO, donoTrava); }
      catch (erro) { console.error('[portal] nao foi possivel liberar a trava de importacao:', erro); }
    }
  }

  async function importWorkbookComTrava(request: Request, user: User, agreementId: string, donoTrava: string) {
    // Limite REAL do multipart. Content-Length pode vir ausente, mentiroso ou a
    // requisicao pode ser fragmentada, entao conferir so o cabecalho deixaria o
    // formData() materializar o corpo inteiro na memoria.
    //
    // A leitura conta os bytes que efetivamente chegam e descarta o excedente;
    // so um corpo dentro do teto e entregue ao interpretador multipart.
    const bytes = await corpoBinarioLimitado(request, CORPO_MAX_UPLOAD);
    if (bytes === null) throw new CorpoGrandeDemais(CORPO_MAX_UPLOAD);

    await renovarTrava(TRAVA_IMPORTACAO, donoTrava);
    // Reconstroi a requisicao a partir dos bytes ja conferidos.
    const requisicaoLimitada = new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: bytes.buffer as ArrayBuffer,
    });
    // Só o formData() fica no try: conteúdo que não é multipart é erro do
    // cliente e merece 400. Exceções depois daqui continuam sendo 500.
    let form: FormData;
    try { form = await requisicaoLimitada.formData(); }
    catch { throw new EntradaInvalida('Envie a planilha como formulário (multipart/form-data).'); }
    const file = form.get('file');
    if (!(file instanceof File)) return fail('Selecione uma planilha Excel.');
    if (!/\.(xlsx|xls)$/i.test(file.name)) return fail('Use uma planilha com extensão .xlsx ou .xls.');
    if (file.size <= 0) return fail('A planilha está vazia.');
    if (file.size > MAX_IMPORT_BYTES) return fail('A planilha ultrapassa o limite de 2 MB.');
    const acordo = await first<{revision:number}>('SELECT revision FROM agreements WHERE id=?', [agreementId]);
    if (!acordo) return fail('Acordo de destino não encontrado.', 404);
    const preview = new URL(request.url).searchParams.get('preview') === '1';
    const informada = form.get('expectedRevision');
    const expectedRevision = typeof informada === 'string' && /^\d+$/.test(informada) ? Number(informada) : null;
    const expectedPlanFingerprint = form.get('expectedPlanFingerprint');
    const conflito = 'O acordo mudou desde a conferência. Confira a planilha novamente antes de publicar.';
    const conflitoPlano = 'Os De/Para ou cadastros mudaram desde a conferência. Confira a planilha novamente antes de publicar.';
    if (!preview && (expectedRevision === null || !Number.isSafeInteger(expectedRevision) || typeof expectedPlanFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(expectedPlanFingerprint))) return fail('A tela está desatualizada. Recarregue a página (Ctrl+F5) e confira a planilha novamente.', 409);
    if (!preview && !revisaoConfere(expectedRevision, Number(acordo.revision))) return fail(conflito, 409);
    const importId = id('imp'), timestamp = now();
    if (!preview) await rawDb().prepare(`INSERT INTO imports (id,agreement_id,filename,mode,status,created_by,created_at) VALUES (?,?,?,?,?,?,?)`).bind(importId, agreementId, safeFilename(file.name), 'replace', 'processing', user.id, timestamp).run();
    try {
      const leitura = await lerPlanilha(file);
      if (!leitura.ok) throw new EntradaInvalida(leitura.erro);
      const sourceRows = leitura.linhas as Row[];
      if (!sourceRows.length) throw new EntradaInvalida('A planilha não contém linhas de dados.');
      const ausentes = colunasAusentes(sourceRows[0]);
      if (ausentes.length) throw new EntradaInvalida(`A planilha não tem ${ausentes.length === 1 ? 'a coluna' : 'as colunas'} ${ausentes.join(', ')}. Confira o cabeçalho da primeira aba.`);
      const parsed = sourceRows.map((row, index) => parseImportRow(row, leitura.numerosLinhas[index]));
      const fornecedor=await first<{cnpj:string;tradeName:string;legalName:string}>('SELECT s.cnpj,s.trade_name AS tradeName,s.legal_name AS legalName FROM agreements a JOIN suppliers s ON s.id=a.supplier_id WHERE a.id=?',[agreementId]);
      if(!fornecedor)throw new EntradaInvalida('Acordo de destino não encontrado.');
      validarFornecedorImportacao(parsed,fornecedor);
      const sourceErrors = parsed.some(row => row.error);
      await applyImportMappings(parsed);
      const errors = parsed.filter((r) => r.error);
      if (errors.length) {
        const summary = summarizeImportErrors(parsed, leitura.aba);
        if (preview) return ok({ preview: true, agreementRevision: Number(acordo.revision), valid: false, totalRows: parsed.length, ...summary });
        // Erros do arquivo continuam sendo 400; perder uma referencia de um
        // plano antes valido e conflito, mesmo quando ja nao ha plano completo.
        const conflict = !sourceErrors;
        await rawDb().prepare('UPDATE imports SET status=?,total_rows=?,valid_rows=?,error_rows=?,summary_json=?,completed_at=? WHERE id=?').bind(conflict ? 'conflict' : 'error', parsed.length, parsed.length-errors.length, errors.length, JSON.stringify(conflict ? { error: conflitoPlano, ...summary } : summary), now(), importId).run();
        return ok({ error: conflict ? conflitoPlano : `A planilha possui ${errors.length} linha(s) inválida(s). Nenhum dado foi publicado.`, importId, ...summary }, { status: conflict ? 409 : 400 });
      }
      let prepared: ReturnType<typeof deduplicateImportRows>;
      try { prepared = deduplicateImportRows(parsed); }
      catch (error) {
        if (!preview && error instanceof EntradaInvalida) throw new ConflitoImportacao(conflitoPlano);
        throw error;
      }
      const baseSummary = prepared.summary;
      const planFingerprint = impressaoPlanoImportacao(agreementId, prepared.rows);
      if (preview) return ok({ preview: true, agreementRevision: Number(acordo.revision), planFingerprint, valid: true, sheet: leitura.aba, totalRows: parsed.length, summary: baseSummary, sample: prepared.rows.slice(0, 20).map(row => ({ linha: row.rowNumber, fornecedor: row.supplier, cidade: row.city, uf: row.state, item: row.item, modelo: row.model, unidade: row.unit, preco: row.price })) });
      // De/Para e cadastros compartilham a TRAVA_IMPORTACAO desde antes da
      // resolucao ate o fim da publicacao, inclusive os lotes intermediarios.
      if (expectedPlanFingerprint !== planFingerprint) throw new ConflitoImportacao(conflitoPlano);
      const publish: PublishImport = async (statements, details) => {
        const summary = { ...details, ...baseSummary }, db = rawDb(), timestamp = now();
        await renovarTrava(TRAVA_IMPORTACAO, donoTrava);
        // A publicacao e seus registros de conclusao precisam confirmar juntos.
        await db.batch([
          ...statements,
          db.prepare('UPDATE imports SET status=?,total_rows=?,valid_rows=?,error_rows=0,summary_json=?,completed_at=? WHERE id=?').bind('completed', parsed.length, parsed.length, JSON.stringify(summary), timestamp, importId),
          db.prepare('INSERT INTO audit_logs (id,user_id,action,entity,entity_id,details,created_at) VALUES (?,?,?,?,?,?,?)').bind(id('aud'), user.id, 'IMPORT', 'agreement', agreementId, `${file.name}: ${parsed.length} linhas publicadas`, timestamp),
        ]);
        return summary;
      };
      // A publicacao troca a abrangencia do acordo: pega a mesma trava da edicao.
      const donoAcordo = await travarAcordo(agreementId);
      if (!donoAcordo) throw new ConflitoImportacao('outro usuário está alterando este acordo neste momento. Tente de novo em instantes');
      let summary: Record<string, unknown>;
      try {
        const atual = await first<{revision:number}>('SELECT revision FROM agreements WHERE id=?', [agreementId]);
        if (!atual || !revisaoConfere(expectedRevision, Number(atual.revision))) throw new ConflitoImportacao(conflito);
        await renovarTrava(TRAVA_IMPORTACAO, donoTrava); summary = await processAgreementImport(prepared.rows, user, importId, agreementId, publish); }
      finally { await soltarAcordo(agreementId, donoAcordo); }
      return ok({ success: true, summary });
    } catch (error: unknown) {
      // So erros de validacao conhecidos chegam ao usuario. O resto (banco,
      // bug) vira mensagem generica e fica no log do servidor.
      const reservaPerdida = error instanceof TravaPerdida || error instanceof ConflitoImportacao;
      const conhecido = error instanceof EntradaInvalida || reservaPerdida;
      if (!conhecido) console.error('[portal] falha inesperada na importacao:', error);
      const message = conhecido ? errorMessage(error, 'arquivo inválido') : 'erro interno ao processar a planilha. Tente de novo; se persistir, avise o administrador.';
      if (preview) return ok({ preview: true, agreementRevision: Number(acordo.revision), valid: false, error: conhecido ? message : `Não foi possível conferir: ${message}` }, reservaPerdida ? { status: 409 } : conhecido ? undefined : { status: 500 });
      await cleanupFailedImport(importId);
      await rawDb().prepare('UPDATE imports SET status=?,summary_json=?,completed_at=? WHERE id=?').bind(error instanceof ConflitoImportacao ? 'conflict' : 'error', JSON.stringify({ error: message }), now(), importId).run();
      return ok({ error: message === conflitoPlano ? message : `Não foi possível importar: ${message}`, importId }, { status: reservaPerdida ? 409 : conhecido ? 400 : 500 });
    }
  }

  async function applyImportMappings(rows: ReturnType<typeof parseImportRow>[]) {
    const [itemRows, modelRows, unitRows, locationRows, unitAliases] = await Promise.all([
      all<{ sourceKey: string; name: string; id: string }>('SELECT m.source_key AS sourceKey,c.name,c.id FROM import_item_mappings m JOIN catalog_items c ON c.id=m.target_id WHERE m.active=1 AND c.active=1'),
      all<{ sourceKey: string; name: string; id: string }>('SELECT m.source_key AS sourceKey,v.name,v.id FROM import_model_mappings m JOIN vehicle_models v ON v.id=m.target_id WHERE m.active=1 AND v.active=1'),
      all<{ id: string; code: string; name: string }>('SELECT id,code,name FROM units WHERE active=1'),
      all<{ id: string; city: string; state: string }>('SELECT id,city,state FROM locations'),
      all<{ sourceKey: string; id: string; name: string }>('SELECT m.source_key AS sourceKey,u.id,u.code AS name FROM import_unit_mappings m JOIN units u ON u.id=m.target_id WHERE m.active=1 AND u.active=1'),
    ]);
    const units = uniqueIndex<ImportTarget>(unitRows.flatMap(unit => [...new Set([normalizeImportText(unit.code), normalizeImportText(unit.name)])].map(key => [key, { id: unit.id, name: unit.code }] as [string, ImportTarget])));
    const locations = uniqueIndex(locationRows.map(location => [chaveLocalidade(location.city, location.state), location]));
    for (const alias of unitAliases) units.set(alias.sourceKey, alias);
    // Localidade nao e nomenclatura a traduzir: cidade ou esta cadastrada ou
    // precisa ser cadastrada. O De/Para dela so abria caminho para apontar uma
    // cidade para outra.
    const items = new Map<string, ImportTarget>(itemRows.map(item => [item.sourceKey, { id: item.id, name: item.name }]));
    const models = new Map<string, ImportTarget>(modelRows.map(model => [model.sourceKey, { id: model.id, name: model.name }]));
    resolveImportRows(rows, { items, models, units, locations });
  }

  type PublishImport = (statements: ConsultaLocal[], details: Record<string, unknown>) => Promise<Record<string, unknown>>;

  async function processAgreementImport(rows: ReturnType<typeof parseImportRow>[], user: User, importId: string, agreementId: string, publish: PublishImport) {
    const agreement = await first<{id:string;number:string}>('SELECT id,number FROM agreements WHERE id=?',[agreementId]); if(!agreement) throw new EntradaInvalida('Acordo não encontrado');
    const fornecedor=await first<{cnpj:string;tradeName:string;legalName:string}>('SELECT s.cnpj,s.trade_name AS tradeName,s.legal_name AS legalName FROM agreements a JOIN suppliers s ON s.id=a.supplier_id WHERE a.id=?',[agreementId]);
    if(!fornecedor)throw new EntradaInvalida('Fornecedor de destino não encontrado.');
    validarFornecedorImportacao(rows,fornecedor);
    if(rows.some(row=>row.error))throw new EntradaInvalida('O fornecedor do acordo mudou durante a conferência. Confira a planilha novamente.');
    const db=rawDb(), timestamp=now();
    const max=await first<{n:number}>('SELECT COALESCE(MAX(version_number),0) n FROM agreement_versions WHERE agreement_id=?',[agreementId]);
    const versionId=id('ver'), versionNumber=Number(max?.n||0)+1;
    await db.prepare(`INSERT INTO agreement_versions (id,agreement_id,version_number,import_id,status,published_at,created_by,created_at) VALUES (?,?,?,?,'processing',NULL,?,?)`).bind(versionId,agreementId,versionNumber,importId,user.id,timestamp).run();
    const links=new Map<string,string>(), statements:ConsultaLocal[]=[];
    for(const row of rows){ const locationId=row.locationId!; links.set(locationId,locationId); statements.push(db.prepare(`INSERT INTO agreement_items (id,version_id,location_id,catalog_item_id,vehicle_model_id,unit_id,price,courtesy,brands_text,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(id('itm'),versionId,...valoresItemImportado(row),timestamp,timestamp)); }
    await batch(statements,80);
    return publish([
      db.prepare('DELETE FROM agreement_locations WHERE agreement_id=?').bind(agreementId),
      ...Array.from(links.keys()).map((locationId)=>db.prepare('INSERT INTO agreement_locations (agreement_id,location_id) VALUES (?,?)').bind(agreementId,locationId)),
      db.prepare('UPDATE agreements SET current_version_id=?,updated_at=? WHERE id=?').bind(versionId,timestamp,agreementId),
      db.prepare(`UPDATE agreement_versions SET status='published',published_at=? WHERE id=?`).bind(timestamp,versionId),
    ], { agreement: agreement.number, version: versionNumber });
  }

  async function batch(statements: ConsultaLocal[], size: number) { for(let i=0;i<statements.length;i+=size) await rawDb().batch(statements.slice(i,i+size)); }

  async function cleanupFailedImport(importId:string){
    const db=rawDb();
    const staged=await all<{id:string;agreementId:string}>(`SELECT id,agreement_id AS agreementId FROM agreement_versions WHERE import_id=? AND status='processing'`,[importId]);
    if(!staged.length) return;
    for(const version of staged){
      const attached=await first('SELECT 1 ok FROM agreements WHERE id=? AND current_version_id=?',[version.agreementId,version.id]);
      if(attached){
        // Uma troca finalizada nunca pode ficar apontando para uma versão removida.
        await db.prepare(`UPDATE agreement_versions SET status='published',published_at=COALESCE(published_at,?) WHERE id=?`).bind(now(),version.id).run();
        continue;
      }
      await db.batch([
        db.prepare('DELETE FROM agreement_items WHERE version_id=?').bind(version.id),
        db.prepare('DELETE FROM agreement_versions WHERE id=?').bind(version.id),
      ]);
    }
  }

  // Quem segura a trava de importacao e o unico que pode estar importando. Uma
  // importacao ainda em 'processing' neste momento e resto de um processo que
  // morreu no meio (queda de energia, portal encerrado): sem esta varredura ela
  // ficava assim para sempre, com a versao em preparo e as condicoes gravadas
  // ate ali. A trava vence em 30 min; uma importacao real leva segundos.
  async function recuperarImportacoesInterrompidas(){
    const presas=await all<{id:string}>(`SELECT id FROM imports WHERE status='processing'`);
    for(const {id:importId} of presas){
      try{
        await cleanupFailedImport(importId);
        await rawDb().prepare('UPDATE imports SET status=?,summary_json=?,completed_at=? WHERE id=?')
          .bind('error',JSON.stringify({error:'Importação interrompida antes de concluir; os dados parciais foram removidos.'}),now(),importId).run();
      }catch(erro){
        // Nao bloqueia a importacao nova: a varredura tenta de novo na proxima.
        console.error(`[portal] nao foi possivel limpar a importacao interrompida ${importId}:`,erro);
      }
    }
  }

  async function totalImportacoes(){return Number((await first<{n:number}>('SELECT COUNT(*) n FROM imports'))?.n||0)}
  async function importList(){ return all(`SELECT i.id,i.filename,i.mode,i.status,i.total_rows AS totalRows,i.valid_rows AS validRows,i.error_rows AS errorRows,i.created_at AS createdAt,i.completed_at AS completedAt,a.number AS agreement,u.name AS user FROM imports i LEFT JOIN agreements a ON a.id=i.agreement_id LEFT JOIN users u ON u.id=i.created_by ORDER BY i.created_at DESC LIMIT 100`); }
  async function importDetail(importId:string){
    const row=await first<{id:string;filename:string;mode:string;status:string;totalRows:number;validRows:number;errorRows:number;createdAt:string;completedAt:string|null;agreement:string|null;user:string|null;summaryJson:string|null}>(`SELECT i.id,i.filename,i.mode,i.status,i.total_rows AS totalRows,i.valid_rows AS validRows,i.error_rows AS errorRows,
    i.created_at AS createdAt,i.completed_at AS completedAt,i.summary_json AS summaryJson,a.number AS agreement,u.name AS user
    FROM imports i LEFT JOIN agreements a ON a.id=i.agreement_id LEFT JOIN users u ON u.id=i.created_by WHERE i.id=?`,[importId]);
    if(!row) return fail('Importação não encontrada.',404);
    let summary:unknown=null;
    try{summary=row.summaryJson?JSON.parse(row.summaryJson):null}catch{summary={error:'O resumo armazenado não pôde ser lido.'}}
    const {summaryJson:_,...detail}=row;
    void _;
    return ok({...detail,summary});
  }

  return { importWorkbook, importDetail, importList, totalImportacoes };
}
