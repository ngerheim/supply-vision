import { paginaSolicitada } from './paginacao.ts';
export function filtrosNotificacoes(params: URLSearchParams) {
  const conditions: string[] = [], values: string[] = [];
  for (const [key, column] of [['status','e.status'],['type','e.type'],['recipient','e.recipient_user_id']] as const) {
    const value=params.get(key); if(value){conditions.push(`${column}=?`);values.push(value);}
  }
  const q=params.get('q'); if(q){conditions.push('(t.code LIKE ? OR t.supplier_name LIKE ? OR e.recipient_name LIKE ? OR e.recipient_email LIKE ?)');values.push(...Array(4).fill(`%${q}%`));}
  for(const [key,operator] of [['from','>='],['to','<=']] as const){const value=params.get(key);if(value){conditions.push(`date(e.created_at)${operator}date(?)`);values.push(value);}}
  return {where:conditions.length?`WHERE ${conditions.join(' AND ')}`:'',values,...paginaSolicitada(params,25,100,1)};
}
