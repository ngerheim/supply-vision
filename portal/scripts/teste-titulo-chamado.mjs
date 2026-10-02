import assert from 'node:assert/strict';

const porta = Number(process.env.PORTAL_TESTE_PORTA);
if (process.env.PORTAL_TESTE_DESCARTAVEL !== 'SIM' || porta !== 3199) throw new Error('Exige instalacao descartavel na porta 3199.');
const headers = { cookie: process.env.PORTAL_TESTE_COOKIE, 'content-type': 'application/json' };
const pedir = async (path, method='GET', body) => {
  const response = await fetch(`http://127.0.0.1:${porta}/api/${path}`, { method, headers, ...(body === undefined ? {} : {body:JSON.stringify(body)}), signal:AbortSignal.timeout(30000) });
  return { status:response.status, data:await response.json() };
};
for (const body of [{supplierName:'FORNECEDOR'}, {title:'   '}, {title:'A'.repeat(121)}]) {
  assert.equal((await pedir('tickets','POST',body)).status,400);
}
const criado=await pedir('tickets','POST',{title:'  Negociar pneus  '});
assert.equal(criado.status,201);
const ticketId=criado.data.id;
let detalhe=await pedir(`tickets/${ticketId}`);
assert.equal(detalhe.data.ticket.title,'Negociar pneus');
assert.equal(detalhe.data.ticket.supplier_name,'');
const lista=await pedir('tickets');
assert.equal(lista.data.tickets.find(t=>t.id===ticketId).title,'Negociar pneus');
assert.equal((await pedir(`tickets/${ticketId}`,'PUT',{title:' '})).status,400);
assert.equal((await pedir(`tickets/${ticketId}`,'PUT',{title:'Negociar alinhamento',supplierName:'OFICINA',cnpj:'11222333000181',contact:'Contato legado'})).status,200);
assert.equal((await pedir(`tickets/${ticketId}`,'PUT',{title:'Negociar alinhamento',supplierName:'',notes:'Formulario sem campos legados'})).status,200);
assert.equal((await pedir(`tickets/${ticketId}`,'PUT',{priority:'alta'})).status,200);
detalhe=await pedir(`tickets/${ticketId}`);
assert.equal(detalhe.data.ticket.title,'Negociar alinhamento');
assert.equal(detalhe.data.ticket.supplier_name,'');
assert.equal(detalhe.data.ticket.cnpj,'11222333000181');
assert.equal(detalhe.data.ticket.contact,'Contato legado');
assert.equal(detalhe.data.ticket.priority,'alta');
assert.ok(detalhe.data.events.some(e=>e.message.includes('Título')));
console.log('[OK] Titulo obrigatorio, fornecedor opcional, persistencia e dados legados preservados.');
