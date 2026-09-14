import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { relative, isAbsolute } from 'node:path';

const [raiz, arquivo] = process.argv.slice(2);
assert(raiz && arquivo, 'Informe a raiz descartavel e seu banco');
const caminho = relative(realpathSync.native(raiz), realpathSync.native(arquivo));
assert(caminho && !caminho.startsWith('..') && !isAbsolute(caminho), 'Banco fora da instancia descartavel');
assert(realpathSync.native(raiz).includes('portal-teste-'), 'Exige instalacao descartavel');
const db = new DatabaseSync(arquivo);
const token = randomUUID();
const hash = createHash('sha256').update(token).digest('hex');
try {
  const usuario = db.prepare('SELECT id FROM users WHERE active=1 LIMIT 1').get();
  assert(usuario, 'Usuario de teste ausente');
  db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES(?,?,?,?)')
    .run(hash, usuario.id, new Date(Date.now() + 60000).toISOString(), new Date().toISOString());
  const consultar = async () => { const r = await fetch('http://127.0.0.1:3199/api/bootstrap', {
    headers: { cookie: `acordos_session=${token}` }, signal: AbortSignal.timeout(30000),
  }); await r.arrayBuffer(); return r; };
  assert.equal((await consultar()).status, 200, 'Controle: sessao valida deve autenticar');
  db.prepare('UPDATE sessions SET expires_at=? WHERE token=?')
    .run(new Date(Date.now() - 60000).toISOString(), hash);
  assert.equal((await consultar()).status, 401, 'A mesma sessao vencida deve ser recusada');
  console.log('Sessao valida: 200; mesma sessao vencida: 401');
  db.prepare('UPDATE sessions SET expires_at=? WHERE token=?').run(new Date(Date.now() + 60000).toISOString(), hash);
  const pedir = async (rota, cookie, body, method = body ? 'POST' : 'GET') => {
    const options = { method, headers: { cookie, 'content-type': 'application/json', connection: 'close' }, signal: AbortSignal.timeout(30000) };
    if (body && method !== 'GET') Object.assign(options, { body: JSON.stringify(body) });
    const r = await fetch(`http://127.0.0.1:3199${rota}`, options);
    await r.arrayBuffer();
    return r;
  };
    for (const perfil of ['viewer', 'editor', 'admin']) {
      const email = `${randomUUID()}@teste.local`, password = randomUUID();
      assert.equal((await pedir('/api/users', `acordos_session=${token}`, { name: 'Teste de perfil', email, password, role: perfil })).status, 201);
      const login = await pedir('/api/login', '', { email, password });
      assert.equal(login.status, 200);
      const cookie = login.headers.get('set-cookie').split(';')[0];
      for (const [rota, esperado] of [
        ['/api/search', 200], ['/api/tickets', perfil === 'viewer' ? 403 : 200],
        ['/api/audit', perfil === 'admin' ? 200 : 403],
      ]) {
        const r = await pedir(rota, cookie);
        assert.equal(r.status, esperado, `${perfil}: ${rota}`);
      }
      if (perfil !== 'admin') {
        const r = await pedir('/api/users', cookie, undefined, 'POST');
        assert.equal(r.status, 403, `${perfil} nao pode criar usuarios`);
      }
      console.log(`Permissoes ${perfil}: aprovadas`);
      assert.equal((await pedir('/api/logout', cookie, undefined, 'POST')).status, 200);
    }
} finally {
  db.prepare('DELETE FROM sessions WHERE token=?').run(hash);
  db.close();
}
