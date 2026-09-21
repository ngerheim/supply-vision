import assert from 'node:assert/strict';

// Chamado somente pelo ensaio que cria seu próprio servidor e banco descartável.
export async function verificarAcessoConsulta({ request, good, check, senha, agreementId, metrics }) {
  const email = 'consulta-carga@teste.local';
  const user = await good('/api/users', { method: 'POST', body: { name: 'Consulta carga', email, password: senha, role: 'viewer' } }, 201);
  const login = () => request('/api/login', { method: 'POST', body: { email, password: senha }, session: '' });
  let sessions = [];
  await check('Consulta: dez logins simultâneos criam sessões independentes', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, login));
    for (const r of results) { assert.equal(r.status, 200); assert.ok(r.cookie); }
    sessions = results.map(r => r.cookie);
    assert.equal(new Set(sessions).size, 10);
    for (const session of sessions) assert.equal((await request('/api/bootstrap', { session })).status, 200);
  });
  assert.ok(sessions.length, 'Sem sessões para verificar consulta');
  const session = sessions[0];
  await check('Consulta: rotas administrativas não podem ser lidas diretamente', async () => {
    for (const path of ['/api/imports', '/api/imports/inexistente', '/api/mappings', '/api/audit', '/api/email-notifications', '/api/users', '/api/tickets', '/api/tickets/inexistente', '/api/export']) {
      assert.equal((await request(path, { session })).status, 403, path);
    }
    const initial = (await request('/api/bootstrap', { session })).data;
    assert.deepEqual(initial.imports, []);
    assert.deepEqual(initial.catalogs.units, []);
    assert.deepEqual(initial.catalogs.brands, []);
    assert.ok(initial.catalogs.suppliers.every(s => !('legalName' in s) && !('cnpj' in s)));
    const agreement = initial.agreements.find(a => a.id === agreementId);
    assert.equal(agreement.itemCount, 10000);
    assert.equal(agreement.locationCount, 10000);
    const detail = (await request(`/api/agreements/${agreementId}`, { session })).data;
    assert.ok(!('notes' in detail.agreement) && !('owner_user_id' in detail.agreement));
    assert.ok(detail.items.every(item => !('notes' in item)));
    assert.equal(detail.totalItems, 10000);
    assert.equal(detail.items.length, 500);
    const secondPage = (await request(`/api/agreements/${agreementId}?offset=500`, { session })).data;
    assert.equal(secondPage.items.length, 500);
    assert.equal(new Set([...detail.items, ...secondPage.items].map(item => item.id)).size, 1000);
    assert.equal(secondPage.version, detail.version);
  });
  await check('Consulta: todas as famílias de escrita são bloqueadas', async () => {
    const paths = ['/api/agreements', `/api/agreements/${agreementId}`, `/api/agreements/${agreementId}/items`, '/api/agreements/confirmar-provisorios', '/api/items/inexistente', '/api/catalogs/units', '/api/catalogs/units/inexistente', '/api/users', `/api/users/${user.id}`, '/api/tickets', '/api/tickets/inexistente/events', '/api/email-notifications/inexistente/retry', '/api/imports/legacy', `/api/imports/agreement/${agreementId}`, '/api/mappings/items/inexistente'];
    for (const method of ['POST', 'PUT', 'DELETE']) for (const path of paths) {
      assert.equal((await request(path, { method, session, ...(method === 'DELETE' ? {} : { body: {} }) })).status, 403, `${method} ${path}`);
    }
  });
  await check('Consulta: sair de um navegador não encerra os outros', async () => {
    assert.equal((await request('/api/logout', { method: 'POST', session })).status, 200);
    assert.equal((await request('/api/search', { session })).status, 401);
    for (const other of sessions.slice(1)) assert.equal((await request('/api/search', { session: other })).status, 200);
  });
  // Medição curta e reproduzível. Não é uma certificação do notebook-servidor.
  for (const concurrency of [10, 25, 50, 100]) await check(`Consulta: ${concurrency} requisições concorrentes com sessões distintas`, async () => {
    const timings = [], start = performance.now();
    const paths = ['/api/search', `/api/agreements/${agreementId}`, '/api/bootstrap'];
    await Promise.all(Array.from({ length: concurrency }, async (_, index) => {
      for (let round = 0; round < 3; round++) {
        const began = performance.now();
        const r = await request(paths[(index + round) % paths.length], { session: sessions[1 + index % (sessions.length - 1)] });
        assert.equal(r.status, 200);
        timings.push(performance.now() - began);
      }
    }));
    timings.sort((a, b) => a - b);
    metrics.push({ scenario: 'consulta-concorrente', concurrency, sessions: sessions.length - 1, requests: timings.length, elapsedMs: Math.round(performance.now() - start), p50Ms: Math.round(timings[Math.ceil(timings.length * .5) - 1]), p95Ms: Math.round(timings[Math.ceil(timings.length * .95) - 1]), maxMs: Math.round(timings.at(-1)) });
  });
  await check('Consulta: trocar senha invalida todas as sessões anteriores', async () => {
    await good(`/api/users/${user.id}`, { method: 'PUT', body: { password: senha + '-nova' } });
    for (const s of sessions) assert.equal((await request('/api/search', { session: s })).status, 401);
  });
  await check('Consulta: desativar conta bloqueia sessão já aberta', async () => {
    const fresh = await request('/api/login', { method: 'POST', body: { email, password: senha + '-nova' }, session: '' });
    assert.equal(fresh.status, 200);
    await good(`/api/users/${user.id}`, { method: 'PUT', body: { active: false } });
    assert.equal((await request('/api/search', { session: fresh.cookie })).status, 401);
  });
}
