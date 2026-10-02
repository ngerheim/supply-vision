import * as XLSX from 'xlsx';
import assert from 'node:assert/strict';

const porta = Number(process.env.PORTAL_TESTE_PORTA);
if (process.env.PORTAL_TESTE_DESCARTAVEL !== 'SIM' || (!Number.isInteger(porta) || porta < 1024 || porta > 65535)) throw new Error('Exige instalacao descartavel na porta informada.');
const headers = { cookie: process.env.PORTAL_TESTE_COOKIE, 'content-type': 'application/json' };
const pedir = async (path, method='GET', body) => {
  const response = await fetch(`http://127.0.0.1:${porta}/api/${path}`, { method, headers, ...(body === undefined ? {} : {body:JSON.stringify(body)}), signal:AbortSignal.timeout(30000) });
  return { status:response.status, data:await response.json() };
};
for (const body of [{title:'Titulo sem fornecedor'}, {supplierName:'   '}, {supplierName:'A'.repeat(121)}]) {
  assert.equal((await pedir('tickets','POST',body)).status,400);
}
const criado=await pedir('tickets','POST',{supplierName:'  Oficina teste  '});
assert.equal(criado.status,201);
const ticketId=criado.data.id;
let detalhe=await pedir(`tickets/${ticketId}`);
assert.equal(detalhe.data.ticket.supplier_name,'OFICINA TESTE');
const lista=await pedir('tickets');
assert.equal(lista.data.tickets.find(t=>t.id===ticketId).supplierName,'OFICINA TESTE');
assert.equal((await pedir(`tickets/${ticketId}`,'PUT',{supplierName:' '})).status,400);
assert.equal((await pedir(`tickets/${ticketId}`,'PUT',{supplierName:'OFICINA NOVA',cnpj:'11222333000181',contact:'Contato legado'})).status,200);
const mensagem='Fornecedor respondeu <teste>\nAguardando proposta comercial.';
assert.equal((await pedir(`tickets/${ticketId}`,'PUT',{status:'aguardando_fornecedor',statusMessage:mensagem})).status,200);
assert.equal((await pedir(`tickets/${ticketId}`,'PUT',{priority:'alta',notes:'Formulario sem campos legados'})).status,200);
detalhe=await pedir(`tickets/${ticketId}`);
assert.equal(detalhe.data.ticket.supplier_name,'OFICINA NOVA');
assert.equal(detalhe.data.ticket.cnpj,'11222333000181');
assert.equal(detalhe.data.ticket.contact,'Contato legado');
assert.equal(detalhe.data.ticket.priority,'alta');
const evento=detalhe.data.events.find(e=>e.kind==='status');
assert.equal(evento.message,mensagem);
assert.equal(evento.fromStatus,'aberto');
assert.equal(evento.toStatus,'aguardando_fornecedor');
console.log('[OK] Fornecedor obrigatorio, cadastro sem titulo, mensagem de situacao e dados legados preservados.');

for(let i=0;i<12;i++)assert.equal((await pedir(`tickets/${ticketId}/events`,'POST',{message:`OFICINA TESTE exportacao ${i}`})).status,201);
const codigo=detalhe.data.ticket.code;
const historico=await pedir(`audit?q=${encodeURIComponent(codigo)}&pageSize=10`);
assert.equal(historico.status,200);
assert.ok(historico.data.total>historico.data.logs.length);
const exported=await fetch(`http://127.0.0.1:${porta}/api/audit/export?q=${encodeURIComponent(codigo)}`,{headers});
assert.equal(exported.status,200);
assert.match(exported.headers.get('content-type'),/spreadsheetml/);
const book=XLSX.read(await exported.arrayBuffer(),{type:'array'});
const rows=XLSX.utils.sheet_to_json(book.Sheets.Historico);
assert.equal(rows.length,historico.data.total);
assert.ok(rows.length>0);
assert.ok(rows.every(r=>String(r.Detalhes).includes(codigo)));
const paged=await pedir('email-notifications?pageSize=10&status=failed');
assert.equal(paged.status,200);
assert.ok(paged.data.notifications.length<=10);
assert.ok(paged.data.notifications.every(n=>n.status==='failed'));

const primeira=await pedir('email-notifications?pageSize=10');
const segunda=await pedir('email-notifications?pageSize=10&page=2');
assert.ok(primeira.data.total>10);
assert.equal(primeira.data.notifications.length,10);
assert.equal(segunda.data.page,2);
const ids=new Set(primeira.data.notifications.map(n=>n.id));
assert.ok(segunda.data.notifications.every(n=>!ids.has(n.id)));

for(const invalid of ['1.5','Infinity','-1','9007199254740992']){
  const result=await pedir(`audit?page=${invalid}&pageSize=${invalid}`);
  assert.equal(result.status,200);assert.equal(result.data.page,1);assert.equal(result.data.pageSize,50);
}

for(const filtro of ['state='+ 'X'.repeat(1000),Array.from({length:81},(_,i)=>'item='+i).join('&')]){
 const result=await pedir('search?'+filtro);assert.equal(result.status,400);assert.equal(typeof result.data.error,'string');
}
const cadastro=await pedir('catalogs/items','POST',{name:'ITEM INATIVO '+Date.now()});assert.equal(cadastro.status,201);
for(const body of [{name:'ITEM INATIVO A',active:false},{name:'ITEM INATIVO B',active:0},{name:'ITEM INATIVO C'}]){
 assert.equal((await pedir('catalogs/items/'+cadastro.data.id,'PUT',body)).status,200);
 const bootstrap=await pedir('bootstrap');assert.equal(bootstrap.data.catalogs.items.find(item=>item.id===cadastro.data.id).active,0);
}
console.log('[OK] GET traduz filtros invalidos e edicoes preservam cadastros inativos.');

const atualizado=await pedir(`tickets/${ticketId}`),revision=atualizado.data.ticket.revision;
assert.equal((await pedir(`tickets/${ticketId}`,'PUT',{scope:'edicao confirmada',expectedRevision:revision})).status,200);
assert.equal((await pedir(`tickets/${ticketId}`,'PUT',{scope:'formulario antigo',expectedRevision:revision})).status,409);
assert.equal((await pedir(`tickets/${ticketId}`)).data.ticket.scope,'edicao confirmada');
console.log('[OK] Formulario antigo nao sobrescreve edicao confirmada.');
