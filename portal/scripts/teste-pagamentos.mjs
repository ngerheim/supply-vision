import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const porta=Number(process.env.PORTAL_TESTE_PORTA),[raiz,arquivo]=process.argv.slice(2);
if(process.env.PORTAL_TESTE_DESCARTAVEL!=='SIM'||!Number.isInteger(porta)||porta<1024||porta>65534||[3000,3001].includes(porta)||!raiz||!arquivo)throw new Error('Exige instalacao descartavel.');
const root=fs.realpathSync.native(raiz),rel=path.relative(root,fs.realpathSync.native(arquivo));assert.ok(root.includes('portal-teste-')&&rel&&!rel.startsWith('..')&&!path.isAbsolute(rel),'Banco fora da fixture.');
const base=`http://127.0.0.1:${porta}/api/`,admin=process.env.PORTAL_TESTE_COOKIE;
async function json(url,{method='GET',body,cookie=admin,key}={}){const r=await fetch(base+url,{method,headers:{cookie,'content-type':'application/json',...(key?{'idempotency-key':key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});return{status:r.status,data:await r.json()};}
async function login(role){const user={name:`Pagamento ${role} Ficticio`,email:`pagamento-${role}@example.com`,password:'senha-ficticia-pagamento-123',role};assert.equal((await json('users',{method:'POST',body:user})).status,201);const r=await fetch(base+'login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:user.email,password:user.password})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];}
const viewer=await login('viewer'),editor=await login('editor');
function form(oc=new Blob(['%PDF-1.7 ficticio']),nf=new Blob(['%PDF-1.7 ficticio'])){const f=new FormData();for(const[k,v]of Object.entries({fornecedor:'Fornecedor HTTP Ficticio',cnpj:'',numero_oc:'OC-HTTP-1',numero_nf:'NF-HTTP-1',valor_centavos:'25400',vencimento:'2026-12-15',link:'https://example.com/nf',observacao:'Fixture de pagamento'}))f.set(k,v);f.set('oc',oc,'ordem.pdf');f.set('nf',nf,'nota.pdf');return f;}
async function upload(f,cookie=viewer,key='pagamento-http-chave-0001'){const r=await fetch(base+'pagamentos',{method:'POST',headers:{cookie,'idempotency-key':key},body:f,signal:AbortSignal.timeout(30000)});return{status:r.status,data:await r.json()};}
assert.equal((await upload(form(new Blob(['texto invalido']),new Blob(['%PDF-1.7'])))).status,400);
assert.equal((await upload(form(new Blob([new Uint8Array(5*1024*1024+1)]),new Blob(['%PDF-1.7'])),'', 'pagamento-http-grande-0001')).status,401);
const grande=await upload(form(new Blob([new Uint8Array(5*1024*1024+1)]),new Blob(['%PDF-1.7'])),viewer,'pagamento-http-grande-0002');assert.equal(grande.status,413);assert.equal(grande.data.error,'Cada anexo deve ter até 5 MB.');
const aberta=await upload(form());assert.equal(aberta.status,201,JSON.stringify(aberta.data));assert.match(aberta.data.codigo,/^PAG-\d{4}$/);
const rota=`pagamentos/${aberta.data.id}`,detalhe=await json(rota,{cookie:viewer});assert.equal(detalhe.status,200);assert.equal(detalhe.data.anexos.length,2);assert.equal(detalhe.data.pagamento.request_key,undefined);
const download=await fetch(base+`${rota}/anexos/oc`,{headers:{cookie:viewer},signal:AbortSignal.timeout(30000)});assert.equal(download.status,200);assert.equal(download.headers.get('x-content-type-options'),'nosniff');assert.match(download.headers.get('content-disposition'),/attachment/);assert.equal(new TextDecoder().decode((await download.arrayBuffer()).slice(0,5)),'%PDF-');
assert.equal((await json(rota,{cookie:editor})).status,404);const locked=await json(`${rota}/transicao`,{method:'POST',cookie:viewer,body:{para:'em_analise',expectedRevision:0}});assert.equal(locked.status,403);
assert.equal((await json(`${rota}/transicao`,{method:'POST',cookie:editor,body:{para:'recusada',expectedRevision:0}})).data.codigo,'status_invalido');
const trans=await json(`${rota}/transicao`,{method:'POST',cookie:editor,key:'pagamento-http-transicao-1',body:{para:'em_analise',expectedRevision:0}});assert.equal(trans.status,200);
assert.equal((await json(`${rota}/transicao`,{method:'POST',cookie:editor,key:'pagamento-http-transicao-1',body:{para:'em_analise',expectedRevision:0}})).status,200);
assert.equal((await json(`${rota}/transicao`,{method:'POST',cookie:editor,body:{para:'paga',expectedRevision:0}})).data.codigo,'revisao');
console.log('[OK] Pagamentos HTTP: multipart, tipo/tamanho, download, posse, permissões e transições.');
