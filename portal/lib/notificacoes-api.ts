import { pode } from './permissoes.ts';
import { AUDITAR_REENVIO_SQL } from './auditoria-api.ts';
import { paginaSolicitada } from './paginacao.ts';
import { intervaloDatasNegocio } from './periodo-auditoria.ts';
import { EntradaInvalida, LIMITES_CAMPO } from './limites-entrada.ts';
import { type ContextoApi, type User } from './api-compartilhada.ts';

// Projecao comum para paginar notificacoes e relatorios, sem esconder falhas.
export const ENTREGAS_EMAIL_SQL = `(
 SELECT e.id,e.type,e.status,e.attempts,e.next_attempt_at,e.sent_at,e.last_error,e.created_at,
 COALESCE(e.recipient_user_id,u.id) recipient_user_id,e.recipient_name,e.recipient_email,COALESCE(t.code,json_extract(e.payload_json,'$.codigo')) ticket_code,COALESCE(t.supplier_name,json_extract(e.payload_json,'$.fornecedor')) supplier_name,
 'notificacao' delivery_kind,NULL period_start,NULL period_end
 FROM email_notifications e LEFT JOIN tickets t ON t.id=e.ticket_id LEFT JOIN users u ON u.id=e.recipient_user_id OR (e.recipient_user_id IS NULL AND lower(u.email)=lower(e.recipient_email))
 UNION ALL
 SELECT d.id,'relatorio_diario',d.status,d.attempts,d.next_attempt_at,d.sent_at,d.last_error,d.created_at,
 d.user_id,u.name,u.email,d.report_date,'Relatório diário','diario',d.period_start,d.period_end
 FROM daily_report_deliveries d JOIN users u ON u.id=d.user_id
) e`;

export const REENVIAR_NOTIFICACAO_SQL = `UPDATE email_notifications SET status='pending',attempts=0,next_attempt_at=?,locked_at=NULL,last_error=NULL,updated_at=?
 WHERE id=? AND status='failed' AND updated_at=? AND attempts=?`;
export const REENVIAR_RELATORIO_DIARIO_SQL = REENVIAR_NOTIFICACAO_SQL.replace('email_notifications', 'daily_report_deliveries');

export function filtrosNotificacoes(params: URLSearchParams) {
  const conditions: string[] = [], values: string[] = [];
  for (const [key, column] of [['status','e.status'],['type','e.type'],['recipient','e.recipient_user_id']] as const) {
    const value=params.get(key); if(value){conditions.push(`${column}=?`);values.push(value);}
  }
  const q=params.get('q'); if(q){
    // LIKE recebe o texto original: espacos tambem contam para seu limite.
    if(q.length>LIMITES_CAMPO.busca)throw new EntradaInvalida(`O campo "busca" passa do limite de ${LIMITES_CAMPO.busca} caracteres.`);
    conditions.push('(e.ticket_code LIKE ? OR e.supplier_name LIKE ? OR e.recipient_name LIKE ? OR e.recipient_email LIKE ?)');values.push(...Array(4).fill(`%${q}%`));
  }
  const periodo=intervaloDatasNegocio(params.get('from'),params.get('to'));
  if(periodo.inicio){conditions.push('julianday(e.created_at)>=julianday(?)');values.push(periodo.inicio);}
  if(periodo.fim){conditions.push('julianday(e.created_at)<julianday(?)');values.push(periodo.fim);}
  return {where:conditions.length?`WHERE ${conditions.join(' AND ')}`:'',values,...paginaSolicitada(params,25,100,1)};
}

export function notificacoesApi(contexto: ContextoApi) {
  const { id, now, rawDb, ok, fail, all, first } = contexto;

  async function emailNotificationList(params:URLSearchParams){
    const {where,values,page:requestedPage,pageSize}=filtrosNotificacoes(params);
    const join=`FROM ${ENTREGAS_EMAIL_SQL}`;
    const stats=await first<{total:number;pending:number;processing:number;sent:number;failed:number}>(`SELECT COUNT(*) total,
    SUM(CASE WHEN e.status='pending' THEN 1 ELSE 0 END) pending,
    SUM(CASE WHEN e.status='processing' THEN 1 ELSE 0 END) processing,
    SUM(CASE WHEN e.status='sent' THEN 1 ELSE 0 END) sent,
    SUM(CASE WHEN e.status='failed' THEN 1 ELSE 0 END) failed ${join} ${where}`,values);
    const total=Number(stats?.total||0),pageCount=Math.max(1,Math.ceil(total/pageSize)),page=Math.min(requestedPage,pageCount);
    const notifications=await all(`SELECT e.id,e.type,e.recipient_name AS recipientName,e.recipient_email AS recipientEmail,e.status,e.attempts,
    e.next_attempt_at AS nextAttemptAt,e.sent_at AS sentAt,e.last_error AS lastError,e.created_at AS createdAt,
    e.ticket_code AS ticketCode,e.supplier_name AS supplierName,e.delivery_kind AS deliveryKind,e.period_start AS periodStart,e.period_end AS periodEnd ${join} ${where} ORDER BY e.created_at DESC,e.id DESC LIMIT ? OFFSET ?`,[...values,pageSize,(page-1)*pageSize]);
    return {stats,notifications,total,page,pageCount,pageSize};
  }

  async function retryEmailNotification(user:User,notificationId:string,kind:'notificacao'|'diario'='notificacao'){
    const tabela=kind==='diario'?'daily_report_deliveries':'email_notifications';
    if(!pode(user, 'email:reenviar')) return fail('Somente administradores podem reenviar notificações.',403);
    const notification=await first<{id:string;status:string;updated_at:string;attempts:number}>(`SELECT id,status,updated_at,attempts FROM ${tabela} WHERE id=?`,[notificationId]);
    if(!notification) return fail('Notificação não encontrada.',404);
    if(notification.status==='sent') return fail('Esta notificação já foi enviada.',409);
    if(notification.status==='processing') return fail('Esta notificação está sendo enviada. Atualize a lista antes de tentar novamente.',409);
    if(notification.status!=='failed') return fail('Somente notificações com falha podem ser reenviadas manualmente.',409);
    const timestamp=now();
    const resultados=await rawDb().batch([
      rawDb().prepare(kind==='diario'?REENVIAR_RELATORIO_DIARIO_SQL:REENVIAR_NOTIFICACAO_SQL).bind(timestamp,timestamp,notificationId,notification.updated_at,notification.attempts),
      rawDb().prepare(AUDITAR_REENVIO_SQL).bind(id('aud'),user.id,'RETRY',kind==='diario'?'daily_report_delivery':'email_notification',notificationId,'Reenvio de notificação solicitado',timestamp),
    ]);
    if(!resultados[0].meta.changes) return fail('A entrega mudou. Atualize a lista antes de tentar novamente.',409);
    return ok({success:true});
  }

  return { emailNotificationList, retryEmailNotification };
}
