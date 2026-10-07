import assert from 'node:assert/strict';

// Executado somente pelo ensaio com servidor e banco descartáveis.
export async function verificarFiltrosBusca({ request, good, check, query }) {
  const catalog = async (tipo, body) => ({ ...body, ...await good(`/api/catalogs/${tipo}`, { method: 'POST', body }, 201) });
  const cnpj = base => {
    let digits = base;
    for (const weights of [[5,4,3,2,9,8,7,6,5,4,3,2],[6,5,4,3,2,9,8,7,6,5,4,3,2]]) {
      const resto = [...digits].reduce((sum, d, i) => sum + Number(d) * weights[i], 0) % 11;
      digits += resto < 2 ? '0' : String(11 - resto);
    }
    return digits;
  };
  const fornecedores = await Promise.all(['A','B','SEM CONDICOES'].map((nome, i) =>
    catalog('suppliers', { tradeName: `FILTROS ${nome}`, cnpj: cnpj(`9000000${i}0001`) })));
  const cidades = await Promise.all(['SP','MG'].map(state => catalog('locations', { city: 'CIDADE FILTROS', state })));
  const modelos = await Promise.all(['A','B','SEM CONDICOES'].map(nome => catalog('models', { name: `MODELO FILTROS ${nome}` })));
  const itens = await Promise.all(['A','B','SEM CONDICOES'].map(nome => catalog('items', { name: `PECA FILTROS ${nome}` })));
  const unit = query('SELECT id FROM units WHERE active=1 ORDER BY code LIMIT 1')[0].id;
  const criar = async (numero, fornecedor, status = 'active', startDate = '2020-01-01', endDate = null) => {
    const acordo = await good('/api/agreements', { method: 'POST', body: {
      number: `FILTROS-${numero}`, supplierId: fornecedores[fornecedor].id, status, startDate, endDate,
      locationIds: cidades.map(c => c.id),
    } }, 201);
    return acordo.id;
  };
  const condicao = (acordo, cidade, item, modelo) => good(`/api/agreements/${acordo}/items`, {
    method: 'POST', body: { locationId: cidades[cidade].id, catalogItemId: itens[item].id, modelIds: [modelos[modelo].id], unitId: unit, price: 10 },
  });
  const a = await criar('A', 0), b = await criar('B', 1);
  await condicao(a, 0, 0, 0); await condicao(a, 0, 1, 1); await condicao(a, 1, 0, 1);
  await condicao(b, 1, 1, 0);
  for (const [numero, status, inicio, fim] of [
    ['SUSPENSO','suspended','2020-01-01',null], ['FUTURO','active','2999-01-01',null],
    ['EXPIRADO','active','2020-01-01','2020-12-31'],
  ]) await condicao(await criar(numero, 2, status, inicio, fim), 0, 2, 2);
  const parametros = fields => {
    const p = new URLSearchParams();
    for (const [campo, values] of Object.entries(fields)) for (const value of values) p.append(campo, value);
    return p;
  };
  const options = async fields => (await good(`/api/search/options?${parametros(fields)}`)).options;
  const ids = options => options.map(o => o.id).sort();
  await check('Filtros: fornecedor restringe cidades, modelos e peças; seu próprio campo mantém alternativas', async () => {
    const r = await options({ supplier: [fornecedores[0].id] });
    assert.deepEqual(ids(r.location), ids(cidades));
    assert.deepEqual(ids(r.model), ids(modelos.slice(0,2)));
    assert.deepEqual(ids(r.item), ids(itens.slice(0,2)));
    assert.ok(r.supplier.some(s => s.id === fornecedores[1].id));
    assert.ok(!r.supplier.some(s => s.id === fornecedores[2].id));
    assert.deepEqual(ids(r.state), ['MG','SP']);
  });
  await check('Filtros: cidade cruza fornecedor, peça e modelo; nomes sem UF preservam IDs distintos', async () => {
    const r = await options({ location: [cidades[0].id], model: [modelos[0].id] });
    assert.deepEqual(ids(r.supplier), [fornecedores[0].id]);
    assert.deepEqual(ids(r.item), [itens[0].id]);
    assert.deepEqual(ids(r.state), ['SP']);
    assert.deepEqual(ids(r.location), ids(cidades));
    assert.ok(r.location.every(c => c.name === 'CIDADE FILTROS'));
    const porEstado = await options({ state: ['SP'], supplier: [fornecedores[0].id] });
    assert.deepEqual(ids(porEstado.location), [cidades[0].id]);
    assert.equal(porEstado.location[0].name, 'CIDADE FILTROS');
    const combinado = await options({ supplier: [fornecedores[0].id], location: [cidades[1].id] });
    assert.deepEqual(ids(combinado.item), [itens[0].id]);
    assert.deepEqual(ids(combinado.model), [modelos[1].id]);
  });
  await check('Filtros: múltiplas escolhas são alternativas e combinações impossíveis podem ser ajustadas', async () => {
    const fields = { supplier: fornecedores.slice(0,2).map(s => s.id), location: [cidades[1].id] };
    assert.deepEqual(ids((await options(fields)).item), ids(itens.slice(0,2)));
    assert.equal((await good(`/api/search?${parametros(fields)}`)).total, 2);
    const impossivel = await options({ supplier: [fornecedores[1].id], location: [cidades[0].id] });
    assert.deepEqual(impossivel.model, []); assert.deepEqual(impossivel.item, []);
    assert.deepEqual(ids(impossivel.supplier), [fornecedores[0].id]);
    assert.deepEqual(ids(impossivel.location), [cidades[1].id]);
    assert.ok((await options({})).model.some(m => m.id === modelos[1].id));
    assert.ok(!(await options({})).model.some(m => m.id === modelos[2].id));
  });
  await check('Filtros: validação e autenticação também protegem a consulta de opções', async () => {
    assert.equal((await request('/api/search/options', { session: '' })).status, 401);
    assert.equal((await request(`/api/search/options?item=${'a'.repeat(201)}`)).status, 400);
    const excesso = parametros({ item: Array.from({ length:81 }, (_, i) => String(i)) });
    assert.equal((await request(`/api/search/options?${excesso}`)).status, 400);
  });
  await check('Filtros: opções não são truncadas junto com as primeiras mil condições', async () => {
    const busca = await good('/api/search');
    assert.ok(busca.total > 1000); assert.equal(busca.truncated, true);
    assert.ok(!busca.rows.some(r => r.item === itens[1].name));
    const r = await options({});
    assert.ok(r.item.some(i => i.id === itens[1].id));
    assert.ok(r.location.some(l => l.id === cidades[1].id));
  });
}
