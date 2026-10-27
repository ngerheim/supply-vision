import { joinContagemHistorico } from './operacao-dados.ts';
import { detalhesHistorico, referenciasHistorico, rotuloAcaoHistorico, rotuloEntidadeHistorico } from './historico-legivel.ts';
import { paginaSolicitada } from './paginacao.ts';
import { intervaloDatasNegocio } from './periodo-auditoria.ts';
import * as XLSX from 'xlsx';
import { EntradaInvalida, LIMITES_CAMPO, exigeTexto } from './limites-entrada.ts';
import { type ContextoApi } from './api-compartilhada.ts';

export const AUDITAR_REENVIO_SQL = `INSERT INTO audit_logs (id,user_id,action,entity,entity_id,details,created_at)
 SELECT ?,?,?,?,?,?,? WHERE changes()=1`;

export const MAX_EXPORT_AUDITORIA = 10_000;
export function erroExportacaoAuditoria(total: number): string | null {
  return total > MAX_EXPORT_AUDITORIA
    ? 'A exportação permite até 10.000 registros. Restrinja o período ou os filtros do histórico.'
    : null;
}
// INSTR preserva a busca literal e evita o limite de padrao LIKE do SQLite.
export const BUSCA_LITERAL_AUDITORIA_SQL = '(instr(lower(l.details),lower(?))>0 OR instr(lower(l.entity),lower(?))>0 OR instr(lower(l.entity_id),lower(?))>0 OR instr(lower(u.name),lower(?))>0)';

// Registro de auditoria como instrucao preparada, para entrar no MESMO batch
// da escrita: se a escrita confirma, o registro confirma junto, e vice-versa.
export function auditoriaNoLote(contexto: ContextoApi, userId: string | null, action: string, entity: string, entityId: string | null, details: string) {
  const { rawDb, id, now } = contexto;
  return rawDb().prepare('INSERT INTO audit_logs (id,user_id,action,entity,entity_id,details,created_at) VALUES (?,?,?,?,?,?,?)').bind(id('aud'), userId, action, entity, entityId, details, now());
}

export function auditoriaApi(contexto: ContextoApi) {
  const { now, NextResponse, all, first } = contexto;

  async function auditList(params?: URLSearchParams, exportAll=false){
    type AuditLog = { id: string; action: string; entity: string; entityId: string | null; details: string | null; createdAt: string; user: string | null; userEmail: string | null; userId: string | null };
    const values:unknown[]=[], conditions:string[]=[];
    const userId=params?.get('user'); if(userId){conditions.push('l.user_id=?');values.push(userId)}
    const action=params?.get('action'); if(action){conditions.push('l.action=?');values.push(action)}
    const entity=params?.get('entity'); if(entity){conditions.push('l.entity=?');values.push(entity)}
    const q=params?.get('q'); if(q){exigeTexto(q,LIMITES_CAMPO.busca,'busca');conditions.push(BUSCA_LITERAL_AUDITORIA_SQL);values.push(q,q,q,q)}
    const periodo=intervaloDatasNegocio(params?.get('from')||null,params?.get('to')||null);
    if(periodo.inicio){conditions.push('l.created_at>=?');values.push(periodo.inicio)}
    if(periodo.fim){conditions.push('l.created_at<?');values.push(periodo.fim)}
    const where=conditions.length?`WHERE ${conditions.join(' AND ')}`:'';

    // Paginacao real: o total vem do banco, entao a tela sabe quantas paginas
    // existem sem precisar carregar tudo.
    const {page:requestedPage,pageSize}=paginaSolicitada(params||new URLSearchParams());
    const total=Number((await first<{n:number}>(`SELECT COUNT(*) n FROM audit_logs l ${joinContagemHistorico(q)} ${where}`, values))?.n||0);
    if(exportAll){const erro=erroExportacaoAuditoria(total);if(erro)throw new EntradaInvalida(erro);}
    const pageCount=Math.max(Math.ceil(total/pageSize),1);
    const page=Math.min(requestedPage,pageCount);
    const offset=(page-1)*pageSize;

    const logs=await all<AuditLog>(`SELECT l.id,l.action,l.entity,l.entity_id AS entityId,l.details,l.created_at AS createdAt,u.name AS user,u.email AS userEmail,l.user_id AS userId FROM audit_logs l LEFT JOIN users u ON u.id=l.user_id ${where} ORDER BY l.created_at DESC,l.id DESC ${exportAll?'':`LIMIT ${pageSize} OFFSET ${offset}`}`, values);
    const referencias = referenciasHistorico(logs.map(r => r.details));
    const fontes = [
      ['catalog_item_id', 'catalog_items', 'name'], ['vehicle_model_id', 'vehicle_models', 'name'],
      ['location_id', 'locations', "city||' / '||state"], ['unit_id', 'units', 'code'],
      ['supplier_id', 'suppliers', 'trade_name'], ['agreementId', 'agreements', 'number'],
      ['version_id', 'agreement_versions', '(SELECT number FROM agreements WHERE id=agreement_versions.agreement_id)'],
    ] as const;
    const nomes: Record<string, string> = {};
    await Promise.all(fontes.map(async ([campo, tabela, coluna]) => {
      if (!referencias[campo]?.length) return;
      const rows = await all<{ id: string; nome: string | null }>(`SELECT id,${coluna} AS nome FROM ${tabela} WHERE id IN (SELECT value FROM json_each(?))`, [JSON.stringify(referencias[campo])]);
      for (const row of rows) if (row.nome !== null) nomes[`${campo}:${row.id}`] = row.nome;
    }));
    return { logs: logs.map(r => ({ ...r, detailsText: detalhesHistorico(r.details, nomes) })), total, page, pageSize, pageCount };
  }

  async function exportAudit(params: URLSearchParams){
    const {logs}=await auditList(params,true);
    const sheet=XLSX.utils.aoa_to_sheet([['Quando','Usuario','Email','Acao','Registro','ID do registro','Detalhes'],...logs.map(r=>[r.createdAt,r.user||'Sistema',r.userEmail||'',rotuloAcaoHistorico(r.action),rotuloEntidadeHistorico(r.entity),r.entityId||'',r.detailsText])]);
    sheet['!cols']=[24,28,36,16,24,40,80].map(wch=>({wch}));
    sheet['!autofilter']={ref:`A1:G${logs.length+1}`};
    const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,sheet,'Historico');
    return new NextResponse(XLSX.write(workbook,{bookType:'xlsx',type:'array'}) as ArrayBuffer,{headers:{
      'cache-control':'no-store','content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition':`attachment; filename="historico-${now().slice(0,10)}.xlsx"`,'x-content-type-options':'nosniff',
    }});
  }

  return { auditList, exportAudit };
}
