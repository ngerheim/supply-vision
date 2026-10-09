import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { once } from 'node:events';
import { assinarIpLogin, ipLoginAssinado } from '../lib/ip-login.ts';
import { criarProxyIpLogin } from '../scripts/proxy-ip-login.mjs';
const token='ficticio-token-de-teste';
void test('IP assinado diferencia clientes; prova falsificada ou chave errada nao ocupa outra cota', async () => {
  for (const ip of ['127.0.0.1','127.0.0.2']) {
    const headers=new Headers({'x-sv-client-ip':ip,'x-sv-client-proof':await assinarIpLogin(ip,token)});
    assert.equal(await ipLoginAssinado(headers,token),ip);
    assert.equal(await ipLoginAssinado(headers,'outra-chave'),null);
    headers.set('x-sv-client-ip','127.0.0.3');assert.equal(await ipLoginAssinado(headers,token),null);
  }
  assert.equal(await ipLoginAssinado(new Headers(),token),null);
});
void test('proxy usa socket, sobrescreve cabecalhos falsos e preserva metodo e corpo', async t => {
  let ip;
  const backend=http.createServer(async(req,res)=>{
    ip=await ipLoginAssinado(new Headers(req.headers),token);
    let corpo='';for await(const trecho of req)corpo+=trecho;
    res.setHeader('x-sv-client-proof','nao-expor');res.end(JSON.stringify({corpo,metodo:req.method,caminho:req.url}));
  });
  backend.listen(0,'127.0.0.1');await once(backend,'listening');
  const proxy=criarProxyIpLogin({portaBackend:backend.address().port,token});
  proxy.listen(0,'127.0.0.1');await once(proxy,'listening');
  t.after(()=>{proxy.closeAllConnections();backend.closeAllConnections();proxy.close();backend.close();});
  const r=await fetch(`http://127.0.0.1:${proxy.address().port}/api/login`,{method:'POST',body:'{"email":"teste@example.com"}',headers:{'x-sv-client-ip':'127.0.0.2','x-sv-client-proof':'0'.repeat(64)}});
  assert.equal(r.status,200);assert.equal(r.headers.get('x-sv-client-proof'),null);
  assert.deepEqual(await r.json(),{corpo:'{"email":"teste@example.com"}',metodo:'POST',caminho:'/api/login'});assert.equal(ip,'127.0.0.1');
});
void test('backend indisponivel devolve 503 e deixa proxy funcionando', async t => {
  const reserva=http.createServer();reserva.listen(0,'127.0.0.1');await once(reserva,'listening');const portaBackend=reserva.address().port;await new Promise(r=>reserva.close(r));
  const proxy=criarProxyIpLogin({portaBackend,token});proxy.listen(0,'127.0.0.1');await once(proxy,'listening');t.after(()=>{proxy.closeAllConnections();proxy.close();});
  assert.equal((await fetch(`http://127.0.0.1:${proxy.address().port}/api/health`)).status,503);
});
