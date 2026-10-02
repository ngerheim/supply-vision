import assert from 'node:assert/strict';

const porta = Number(process.env.PORTAL_TESTE_PORTA);
if (process.env.PORTAL_TESTE_DESCARTAVEL !== 'SIM' || porta !== 3199) throw new Error('Exige instalacao descartavel na porta 3199.');
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
