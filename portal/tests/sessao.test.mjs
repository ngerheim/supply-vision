import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { once } from 'node:events';
import { assinarIpLogin, ipLoginAssinado } from '../lib/ip-login.mjs';
import { criarProxyIpLogin } from '../scripts/proxy-ip-login.mjs';
import { DatabaseSync } from 'node:sqlite';
import { CRIAR_SESSAO_AUTENTICADA_SQL, MIGRAR_SENHA_AUTENTICADA_SQL } from '../lib/sessao-api.ts';

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
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('x-sv-client-proof','nao-expor');res.end(JSON.stringify({corpo,metodo:req.method,caminho:req.url}));
  });
  backend.listen(0,'127.0.0.1');await once(backend,'listening');
  const proxy=criarProxyIpLogin({portaBackend:backend.address().port,token});
  proxy.listen(0,'127.0.0.1');await once(proxy,'listening');
  t.after(()=>{proxy.closeAllConnections();backend.closeAllConnections();proxy.close();backend.close();});
  const r=await fetch(`http://127.0.0.1:${proxy.address().port}/api/login`,{method:'POST',body:'{"email":"teste@example.com"}',headers:{'x-sv-client-ip':'127.0.0.2','x-sv-client-proof':'0'.repeat(64)}});
  assert.equal(r.status,200);assert.equal(r.headers.get('x-sv-client-proof'),null);
  assert.equal(r.headers.get('content-type'),'application/json; charset=utf-8');
  assert.equal(r.headers.get('x-content-type-options'),'nosniff');
  assert.deepEqual(await r.json(),{corpo:'{"email":"teste@example.com"}',metodo:'POST',caminho:'/api/login'});assert.equal(ip,'127.0.0.1');
});
void test('backend indisponivel devolve 503 e deixa proxy funcionando', async t => {
  const reserva=http.createServer();reserva.listen(0,'127.0.0.1');await once(reserva,'listening');const portaBackend=reserva.address().port;await new Promise(r=>reserva.close(r));
  const proxy=criarProxyIpLogin({portaBackend,token});proxy.listen(0,'127.0.0.1');await once(proxy,'listening');t.after(()=>{proxy.closeAllConnections();proxy.close();});
  assert.equal((await fetch(`http://127.0.0.1:${proxy.address().port}/api/health`)).status,503);
});

for (const mudanca of [null, 'senha', 'desativacao', 'perfil']) {
  void test(`login protege snapshot: ${mudanca || 'sem mudanca'}`, () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(`CREATE TABLE users(id TEXT,active INTEGER,revision INTEGER,password_salt TEXT,password_hash TEXT,password_iterations INTEGER);
        CREATE TABLE sessions(token TEXT,user_id TEXT,expires_at TEXT,last_seen_at TEXT);
        INSERT INTO users VALUES('u',1,0,'antigo','hash-antigo',120000)`);
      if (mudanca === 'senha') db.exec("UPDATE users SET revision=1,password_salt='novo',password_hash='senha-nova'");
      if (mudanca === 'desativacao') db.exec('UPDATE users SET active=0,revision=1');
      if (mudanca === 'perfil') db.exec('UPDATE users SET revision=1');
      db.exec('BEGIN');
      const inserida = db.prepare(CRIAR_SESSAO_AUTENTICADA_SQL).run('token','futuro','agora','u',0,'antigo','hash-antigo').changes;
      db.prepare(MIGRAR_SENHA_AUTENTICADA_SQL).run('migrado','hash-migrado',600000,'u',0,'antigo','hash-antigo','token');
      db.exec('COMMIT');
      assert.equal(inserida, mudanca ? 0 : 1);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get().n, mudanca ? 0 : 1);
      assert.equal(db.prepare('SELECT password_hash h FROM users').get().h, mudanca === 'senha' ? 'senha-nova' : mudanca ? 'hash-antigo' : 'hash-migrado');
    } finally { db.close(); }
  });
}
