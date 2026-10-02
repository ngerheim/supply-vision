'use client';
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api, errorText } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Table, TableHeader, TableHead, TableRow, TableCell, TableBody } from '@/components/ui/table';
type Row = Record<string, ReturnType<typeof JSON.parse>>;
const statuses:Record<string,string>={pending:'Pendente',processing:'Enviando',sent:'Enviada',failed:'Falhou'};
const types:Record<string,string>={atribuicao:'Atribuição',atualizacao:'Atualização',conclusao:'Conclusão',cancelamento:'Cancelamento'};
export function EmailNotifications({users,run}:{users:Row[];run:(action:()=>Promise<void>,message:string)=>unknown}){
  const [data,setData]=useState<Row|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[page,setPage]=useState(1),[revision,setRevision]=useState(0);
  const [filters,setFilters]=useState({q:'',recipient:'',status:'',type:'',from:'',to:''});
  const filter=(key:keyof typeof filters,value:string)=>{setFilters({...filters,[key]:value});setPage(1);};
  useEffect(()=>{
    let active=true;
    queueMicrotask(()=>{if(active){setLoading(true);setError('');}});
    const params=new URLSearchParams({...filters,page:String(page),pageSize:'25'});
    void api(`/api/email-notifications?${params}`).then(result=>{if(active)setData(result);}).catch(cause=>{if(active){setError(errorText(cause));setData(null);}}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[filters,page,revision]);
  const select=(label:string,key:'status'|'type'|'recipient',options:Record<string,string>)=><label className="space-y-1 text-sm"><span>{label}</span><NativeSelect className="w-full" value={filters[key]} onChange={e=>filter(key,e.target.value)}><NativeSelectOption value="">Todos</NativeSelectOption>{Object.entries(options).map(([id,name])=><NativeSelectOption key={id} value={id}>{name}</NativeSelectOption>)}</NativeSelect></label>;
  return <div className="space-y-5">
    <Card><CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
      <label className="space-y-1 text-sm"><span>Busca</span><Input value={filters.q} onChange={e=>filter('q',e.target.value)}/></label>
      {select('Destinatário','recipient',Object.fromEntries(users.map(u=>[u.id,u.name])))}
      {select('Situação','status',statuses)}{select('Tipo','type',types)}
      <label className="space-y-1 text-sm"><span>De</span><Input type="date" value={filters.from} onChange={e=>filter('from',e.target.value)}/></label>
      <label className="space-y-1 text-sm"><span>Até</span><Input type="date" value={filters.to} onChange={e=>filter('to',e.target.value)}/></label>
    </CardContent></Card>
    <Card><CardHeader className="flex flex-row items-center justify-between"><CardTitle>Notificações por e-mail</CardTitle><Button variant="outline" onClick={()=>setRevision(r=>r+1)}><RefreshCw/> Atualizar</Button></CardHeader>
      <CardContent className="px-0 pb-0"><Table className="w-full min-w-[950px] table-fixed"><colgroup>{[22,13,24,11,9,15,6].map((w,i)=><col key={i} style={{width:`${w}%`}}/>)}</colgroup>
        <TableHeader><TableRow>{['Chamado','Tipo','Destinatário','Situação','Tentativas','Data',''].map((name,i)=><TableHead key={i}>{name}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{!loading&&!error&&data?.notifications.map((item:Row)=><TableRow key={item.id}>
          <TableCell><p className="font-mono text-xs">{item.ticketCode}</p><p className="truncate" title={item.supplierName}>{item.supplierName}</p></TableCell>
          <TableCell className="truncate">{types[item.type]||item.type}</TableCell>
          <TableCell><p className="truncate" title={item.recipientName}>{item.recipientName}</p><p className="truncate text-xs text-muted-foreground" title={item.recipientEmail}>{item.recipientEmail}</p></TableCell>
          <TableCell>{statuses[item.status]||item.status}{item.lastError&&<p className="truncate text-xs text-red-700" title={item.lastError}>{item.lastError}</p>}</TableCell>
          <TableCell>{item.attempts}</TableCell><TableCell className="whitespace-normal text-xs">{new Date(item.sentAt||item.createdAt).toLocaleString('pt-BR')}</TableCell>
          <TableCell>{item.status==='failed'&&<Button size="icon-sm" variant="ghost" aria-label="Reenviar notificação" onClick={()=>run(async()=>{await api(`/api/email-notifications/${item.id}/retry`,{method:'POST'});setRevision(r=>r+1);},'Reenvio colocado na fila.')}><RefreshCw/></Button>}</TableCell>
        </TableRow>)}</TableBody></Table>
        {loading&&<p className="p-5 text-sm">Carregando…</p>}{error&&<p role="alert" className="p-5 text-sm text-destructive">{error}</p>}{!loading&&!error&&!data?.notifications.length&&<p className="p-5 text-sm">Nenhuma notificação com esses filtros.</p>}
      </CardContent>{data?.pageCount>1&&<div className="flex justify-end gap-2 border-t p-3"><Button variant="outline" disabled={loading||data.page<=1} onClick={()=>setPage(data.page-1)}>Anterior</Button><Button variant="outline" disabled={loading||data.page>=data.pageCount} onClick={()=>setPage(data.page+1)}>Próxima</Button></div>}
    </Card>
  </div>;
}
