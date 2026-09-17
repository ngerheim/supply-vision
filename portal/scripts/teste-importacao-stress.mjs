// Teste HTTP real, sempre em um banco novo e local. Nunca aceita URL/banco externo.
// npm run test:imports (requer npm run build). Evidências ficam em work/.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import * as XLSX from 'xlsx';
import { abrirRequisicao, multipart } from './cliente-http.mjs';

const portal = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.mkdirSync(path.join(portal, 'work'), { recursive: true });
const output = fs.mkdtempSync(path.join(portal, 'work', 'import-stress-'));
const state = path.join(output, 'state');
const runtime = path.join(output, 'runtime');
fs.cpSync(path.join(portal, 'dist'), runtime, { recursive: true });
const serverLog = fs.openSync(path.join(output, 'servidor.log'), 'a');
const senha = 'Teste-isolado-2026-0916';
const checks = [], metrics = [];
let child, cookie = '', sqlitePath, reader;
let seed = 20260916;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const socket = createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const base = `http://127.0.0.1:${port}`;

async function request(url, { method = 'GET', body, session = cookie, headers = {} } = {}) {
  const response = await fetch(base + url, {
    method, headers: { connection: 'close', ...(session ? { cookie: session } : {}), ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
    signal: AbortSignal.timeout(180000),
  });
  const text = await response.text();
  if (response.status >= 500) fs.writeFileSync(path.join(output, `http-error-${method}-${Date.now()}.txt`), text);
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function good(url, options, expected = 200) {
  const result = await request(url, options);
  assert.equal(result.status, expected, `${url}: ${JSON.stringify(result.data)}`);
  return result.data;
}
async function check(name, fn) {
  const start = performance.now();
  try { await fn(); checks.push({ name, ok: true, ms: Math.round(performance.now() - start) }); console.log(`OK ${name}`); }
  catch (error) { checks.push({ name, ok: false, error: error.message }); console.log(`FALHOU ${name}: ${error.message}`); }
}
function query(sql, ...args) { return reader.prepare(sql).all(...args); }
function businessSnapshot() {
  return Object.fromEntries(['suppliers', 'locations', 'catalog_items', 'vehicle_models', 'units', 'brands', 'agreements', 'agreement_locations', 'agreement_versions', 'agreement_items'].map(table => [table, query(`SELECT * FROM ${table} ORDER BY rowid`)]));
}
function locateSqlite(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { const result = locateSqlite(file); if (result) return result; }
    else if (file.endsWith('.sqlite') && entry.name !== 'metadata.sqlite') return file;
  }
}
const headers = ['CIDADE', 'UF', 'MODELO', 'PECA_SERVICO', 'PRECO', 'MEDIDA', 'MARCAS', 'CNPJ', 'FORNECEDOR'];
const row = (changes = {}) => ({ CIDADE: 'GOIANIA', UF: 'GO', MODELO: 'Hilux teste', PECA_SERVICO: 'Óleo teste', PRECO: 42.5, MEDIDA: 'litro', MARCAS: 'MARCA TESTE', CNPJ: '11.222.333/0001-81', FORNECEDOR: 'FORNECEDOR TESTE', ...changes });
function file(rows, { name = 'teste', format = 'xlsx', aoa, range, extraSheet } = {}) {
  const book = XLSX.utils.book_new();
  const sheet = aoa ? XLSX.utils.aoa_to_sheet(aoa) : XLSX.utils.json_to_sheet(rows);
  if (range) sheet['!ref'] = range;
  XLSX.utils.book_append_sheet(book, sheet, 'Acordos teste');
  if (extraSheet) XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(extraSheet), 'Ignorada');
  const bytes = XLSX.write(book, { type: 'buffer', bookType: format === 'xls' ? 'biff8' : 'xlsx', compression: true, bookSST: true });
  const filename = `${name}.${format}`;
  fs.writeFileSync(path.join(output, filename), bytes);
  return { bytes, filename };
}
async function upload(document, route = '/api/imports/legacy', session = cookie) {
  const form = new FormData(); form.set('file', new Blob([document.bytes]), document.filename);
  const start = performance.now();
  const result = await request(route, { method: 'POST', body: form, session });
  metrics.push({ file: document.filename, bytes: document.bytes.length, status: result.status, ms: Math.round(performance.now() - start), summary: result.data.summary });
  return result;
}
async function rejected(document, route, expected = 400, verify) {
  const before = businessSnapshot();
  const result = await upload(document, route);
  assert.equal(result.status, expected, JSON.stringify(result.data));
  assert.deepEqual(businessSnapshot(), before, 'Falha de importação alterou dados de negócio');
  assert.equal(query('SELECT COUNT(*) n FROM travas')[0].n, 0, 'Trava ficou presa');
  if (verify) await verify(result.data);
  return result;
}
async function catalog(type, data) { return good(`/api/catalogs/${type}`, { method: 'POST', body: data }, 201); }
async function mapping(type, source, targetId, extra = {}) { return good(`/api/mappings/${type}`, { method: 'POST', body: { source, targetId, ...extra } }, 201); }
function noise(text) {
  const gaps = [' ', '  ', '\t', '\n', '\u00a0', '\u202f'];
  return '\ufeff  ' + [...text.normalize(random() < .5 ? 'NFD' : 'NFC')].map(c => c === ' ' ? gaps[Math.floor(random() * gaps.length)] : random() < .5 ? c.toLowerCase() : c.toUpperCase()).join('') + '\u200b ';
}

async function stopServer() {
  if (child?.pid && child.exitCode === null) {
    if (process.platform === 'win32') { try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* processo já encerrado */ } }
    else child.kill('SIGTERM');
    if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));
    await pause(300);
  }
}
async function startServer() {
  child = spawn(process.execPath, [path.join(portal, 'node_modules/wrangler/bin/wrangler.js'), 'dev', '--local', '--config', path.join(runtime, 'server/wrangler.json'), '--persist-to', state, '--var', `INITIAL_ADMIN_PASSWORD:${senha}`, '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', '0'], {
    cwd: output, windowsHide: true, stdio: ['ignore', serverLog, serverLog],
    env: { ...process.env, NODE_ENV: 'development', WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'true', WRANGLER_LOG_PATH: path.join(output, 'wrangler.log'), MINIFLARE_REGISTRY_PATH: path.join(output, 'registry') },
  });
  console.log(`Instância descartável: ${base}; evidências: ${output}`);
  let ready = false;
  for (let i = 0; i < 90; i++) {
    if (child.exitCode !== null) throw new Error(`Servidor encerrou: ${child.exitCode}`);
    try { const res = await fetch(base + '/api/health', { signal: AbortSignal.timeout(2000) }); if (res.ok) { ready = true; break; } } catch { /* aguardando apenas a instância criada */ }
    await pause(500);
  }
  assert.ok(ready, 'Servidor não iniciou. Veja servidor.log.');
}
try {
  await startServer();
  const login = await request('/api/login', { method: 'POST', body: { email: 'admin@portal.local', password: senha } });
  assert.equal(login.status, 200); cookie = login.cookie;
  sqlitePath = locateSqlite(state); assert.ok(sqlitePath);
  reader = new DatabaseSync(sqlitePath, { readOnly: true });

  await check('De/Para inicia vazio', async () => assert.deepEqual(await good('/api/mappings'), { items: [], models: [] }));
  await check('Base vazia recusa nomenclatura sem criar cadastros', () => rejected(file([row()], { name: 'sem-de-para' })));
  const item = await catalog('items', { name: 'OLEO DE MOTOR TESTE' });
  const model = await catalog('models', { name: 'HILUX 2.8 TESTE' });
  const itemMap = await mapping('items', 'Óleo teste', item.id);
  await mapping('models', 'Hilux teste', model.id);
  const unit = query("SELECT * FROM units WHERE code='LITRO'")[0];
  let agreementId;
  await check('Carga inicial válida publica referências e preço corretos', async () => {
    const result = await upload(file([row()], { name: 'valida-inicial' }));
    assert.equal(result.status, 200, JSON.stringify(result.data));
    agreementId = query('SELECT id FROM agreements')[0].id;
    const published = query('SELECT ai.* FROM agreement_items ai JOIN agreements a ON a.current_version_id=ai.version_id')[0];
    assert.equal(published.catalog_item_id, item.id); assert.equal(published.vehicle_model_id, model.id);
    assert.equal(published.unit_id, unit.id); assert.equal(published.price, 42.5);
  });
  assert.ok(agreementId, 'Pré-condição: primeira importação');
  const replace = `/api/imports/agreement/${agreementId}`;
  for (const route of ['/api/imports/legacy', replace]) {
    const mode = route === replace ? 'substituir' : 'inicial';
    const invalidCases = /** @type {Array<[string, Record<string, unknown>, RegExp]>} */ ([
      ['item-desconhecido', { PECA_SERVICO: 'PEÇA inexistente' }, /PECA_SERVICO.*PEÇA inexistente/],
      ['modelo-desconhecido', { MODELO: 'MODELO inexistente' }, /MODELO.*MODELO inexistente/],
      ['lirto', { MEDIDA: 'lirto' }, /UNIDADE.*lirto/],
      ['unidade-vazia', { MEDIDA: '' }, /MEDIDA|UNIDADE/],
      ['preco-vazio', { PRECO: '' }, /PRECO/],
      ['preco-negativo', { PRECO: -10 }, /negativo/i],
      ['preco-texto', { PRECO: 'a combinar' }, /Preço/],
      ['preco-malformado', { PRECO: '12.34,56' }, /Preço/],
      ['uf-invalida', { UF: 'XX' }, /UF/],
    ]);
    for (const [label, changes, match] of invalidCases) await check(`${mode}: ${label} aborta tudo e localiza linha`, () => rejected(file([row(), row(changes)], { name: `${mode}-${label}` }), route, 400, data => {
      assert.equal(data.sampleErrors?.[0].row, 3); assert.match(data.sampleErrors[0].error, match);
    }));
  }
  await check('Linha real após vazios e cabeçalho deslocado', () => rejected(file([], { name: 'linha-real', aoa: [[], [], headers, Object.values(row()), [], Object.values(row({ MEDIDA: 'lirto' }))] }), replace, 400, data => assert.equal(data.sampleErrors?.[0].row, 6)));
  await check('Cabeçalhos equivalentes duplicados são rejeitados', () => rejected(file([], { name: 'cabecalhos-duplicados', aoa: [[...headers, ' Peça/Serviço '], [...Object.values(row()), 'OUTRO ITEM']] }), replace));
  await check('500 ruídos aleatórios reproduzíveis mantêm nomenclaturas e valores', async () => {
    const noisyHeaders = headers.map(noise);
    const rows = Array.from({ length: 500 }, (_, index) => headers.map(key => { const value = row({ CIDADE: `CIDADE ${index}` })[key]; return typeof value === 'string' && key !== 'CNPJ' ? noise(value) : value; }));
    const result = await upload(file([], { name: 'ruidos-semente-20260916', aoa: [noisyHeaders, ...rows] }), replace);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    const actual = query('SELECT ai.*,l.city FROM agreement_items ai JOIN agreements a ON a.current_version_id=ai.version_id JOIN locations l ON l.id=ai.location_id WHERE a.id=?', agreementId);
    assert.equal(actual.length, 500);
    for (const r of actual) { assert.equal(r.catalog_item_id, item.id); assert.equal(r.vehicle_model_id, model.id); assert.equal(r.unit_id, unit.id); assert.equal(r.price, 42.5); assert.match(r.city, /^CIDADE \d+$/); }
  });
  await check('Cabeçalhos com acentos, barra e espaços são aceitos', async () => {
    const result = await upload(file([], { name: 'cabecalhos', aoa: [[' cidade ', 'uf', 'modélo', 'Peça/Serviço', 'Preço', 'Unidade'], ['São Paulo', 'sp', 'hilux teste', 'óleo teste', 'R$ 1.234,56', 'LITRO']] }), replace);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(query('SELECT price FROM agreement_items WHERE version_id=(SELECT current_version_id FROM agreements WHERE id=?)', agreementId)[0].price, 1234.56);
  });
  await check('XLS legado também passa pela validação', async () => assert.equal((await upload(file([row()], { name: 'legado', format: 'xls' }), replace)).status, 200));
  await check('Cortesia explícita zero é preservada', async () => {
    assert.equal((await upload(file([row({ PRECO: 0 })], { name: 'cortesia' }), replace)).status, 200);
    const actual = query('SELECT price,courtesy FROM agreement_items WHERE version_id=(SELECT current_version_id FROM agreements WHERE id=?)', agreementId)[0];
    assert.equal(actual.price, 0); assert.equal(actual.courtesy, 1);
  });
  await check('Mapeamento inativo bloqueia', async () => {
    await good(`/api/mappings/items/${itemMap.id}`, { method: 'PUT', body: { source: 'Óleo teste', targetId: item.id, active: false } });
    try { await rejected(file([row()], { name: 'de-para-inativo' }), replace); }
    finally { await good(`/api/mappings/items/${itemMap.id}`, { method: 'PUT', body: { source: 'Óleo teste', targetId: item.id, active: true } }); }
  });
  for (const [type, target, values] of [['items', item, { name: 'OLEO DE MOTOR TESTE' }], ['models', model, { name: 'HILUX 2.8 TESTE' }], ['units', unit, { code: 'LITRO', name: 'Litro' }]]) {
    await check(`Destino ${type} inativo bloqueia`, async () => {
      await good(`/api/catalogs/${type}/${target.id}`, { method: 'PUT', body: { ...values, active: false } });
      try { await rejected(file([row()], { name: `${type}-inativo` }), replace); }
      finally { await good(`/api/catalogs/${type}/${target.id}`, { method: 'PUT', body: { ...values, active: true } }); }
    });
  }
  await check('Duplicidade de origem após normalização é rejeitada', async () => {
    assert.equal((await request('/api/mappings/items', { method: 'POST', body: { source: 'oLEO\u00a0 TESTE', targetId: item.id } })).status, 400);
  });
  await check('Editar origem para chave existente é recusado', async () => {
    const temporary = await mapping('items', 'OUTRA ORIGEM', item.id);
    try { assert.equal((await request(`/api/mappings/items/${temporary.id}`, { method: 'PUT', body: { source: 'Óleo teste', targetId: item.id } })).status, 400); }
    finally { await good(`/api/mappings/items/${temporary.id}`, { method: 'DELETE' }); }
  });
  await check('Editar observação de De/Para inativo conserva inatividade', async () => {
    const inactive = await mapping('items', 'INATIVO', item.id, { active: false });
    try {
      const entry = (await good('/api/mappings')).items.find(r => r.id === inactive.id);
      await good(`/api/mappings/items/${inactive.id}`, { method: 'PUT', body: { ...entry, notes: 'ALTERADA' } });
      assert.equal((await good('/api/mappings')).items.find(r => r.id === inactive.id).active, 0);
    } finally { await good(`/api/mappings/items/${inactive.id}`, { method: 'DELETE' }); }
  });
  await check('Excluir De/Para elimina aceitação da origem sem alterar acordos', async () => {
    const temporary = await mapping('items', 'ORIGEM TEMPORARIA', item.id);
    await good(`/api/mappings/items/${temporary.id}`, { method: 'DELETE' });
    await rejected(file([row({ PECA_SERVICO: 'ORIGEM TEMPORARIA' })], { name: 'origem-excluida' }), replace);
  });
  await check('Nome canônico também exige De/Para explícito', () => rejected(file([row({ PECA_SERVICO: 'OLEO DE MOTOR TESTE' })], { name: 'nome-sem-de-para' }), replace));
  await check('Mesmo nome normalizado em dois cadastros não troca destino do De/Para', async () => {
    const targetA = await catalog('items', { name: 'PEÇA COLISAO' });
    const targetB = await catalog('items', { name: 'PECA COLISAO' });
    await mapping('items', 'ALIAS COLISAO A', targetA.id); await mapping('items', 'ALIAS COLISAO B', targetB.id);
    const result = await upload(file([row({ PECA_SERVICO: 'ALIAS COLISAO A' }), row({ PECA_SERVICO: 'ALIAS COLISAO B' })], { name: 'colisao-destinos' }), replace);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    const ids = query('SELECT catalog_item_id FROM agreement_items WHERE version_id=(SELECT current_version_id FROM agreements WHERE id=?)', agreementId).map(r => r.catalog_item_id).sort();
    assert.deepEqual(ids, [targetA.id, targetB.id].sort((a,b) => a.localeCompare(b)));
  });
  await check('Unidade com descrição ambígua é recusada', async () => {
    const ambiguous = await catalog('units', { code: 'L2', name: 'Litro' });
    try { await rejected(file([row()], { name: 'unidade-ambigua' }), replace); }
    finally { await good(`/api/catalogs/units/${ambiguous.id}`, { method: 'PUT', body: { code: 'L2', name: 'Litro', active: false } }); }
  });
  await check('Destino usado por De/Para tem exclusão bloqueada com 409', async () => {
    const target = await catalog('models', { name: 'DESTINO PROTEGIDO' });
    await mapping('models', 'ORIGEM PROTEGIDA', target.id);
    assert.equal((await request(`/api/catalogs/models/${target.id}`, { method: 'DELETE' })).status, 409);
  });
  for (const role of ['editor', 'viewer']) {
    await good('/api/users', { method: 'POST', body: { name: role, email: `${role}@teste.local`, password: senha, role } }, 201);
    const session = (await request('/api/login', { method: 'POST', body: { email: `${role}@teste.local`, password: senha } })).cookie;
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) await check(`${role}: ${method} De/Para negado`, async () => {
      const url = method === 'GET' ? '/api/mappings' : '/api/mappings/items' + (['PUT', 'DELETE'].includes(method) ? `/${itemMap.id}` : '');
      const result = await request(url, { method, session, ...(method === 'POST' || method === 'PUT' ? { body: { source: 'X', targetId: item.id } } : {}) });
      assert.equal(result.status, 403, String(JSON.stringify(result.data)).slice(0, 500));
    });
    await check(`${role}: permissão de importar respeitada`, async () => assert.equal((await upload(file([row()], { name: `perfil-${role}` }), replace, session)).status, role === 'editor' ? 200 : 403));
  }
  await check('Duplicatas de mesmo preço unificam marcas', async () => {
    const result = await upload(file([row({ MARCAS: 'A' }), row({ MARCAS: 'B' })], { name: 'duplicatas-iguais' }), replace);
    assert.equal(result.status, 200); assert.equal(result.data.summary.items, 1);
    assert.equal(query('SELECT brands_text FROM agreement_items WHERE version_id=(SELECT current_version_id FROM agreements WHERE id=?)', agreementId)[0].brands_text, 'A / B');
  });
  await check('Medidas diferentes para o mesmo item são rejeitadas na substituição', () => rejected(file([row(), row({ MEDIDA: 'par' })], { name: 'medidas-divergentes' }), replace, 400, data => {
    assert.match(String(data.error), /[Mm]edidas diferentes/);
    assert.match(String(data.error), /"litro"|"par"/);
  }));
  await check('Medidas diferentes para o mesmo item são rejeitadas na carga inicial', () => rejected(file([row(), row({ MEDIDA: 'par' })], { name: 'medidas-divergentes-legado' }), undefined, 400, data => assert.match(String(data.error), /[Mm]edidas diferentes/)));
  await check('Mesma medida escrita de outro jeito continua sendo duplicata', async () => {
    const result = await upload(file([row({ MARCAS: 'C' }), row({ MEDIDA: ' LITRO ', MARCAS: 'D' })], { name: 'medida-grafia' }), replace);
    assert.equal(result.status, 200); assert.equal(result.data.summary.items, 1);
  });
  await check('UF fora da chave: mesma cidade e item não duplicam por estado', async () => {
    const result = await upload(file([row(), row({ UF: 'MG' })], { name: 'uf-fora-da-chave' }), replace);
    assert.equal(result.status, 200); assert.equal(result.data.summary.items, 1);
  });
  await check('Preços conflitantes na substituição não alteram versão', () => rejected(file([row(), row({ PRECO: 70 })], { name: 'precos-conflitantes' }), replace));
  await check('Carga inicial inteira aborta se o segundo fornecedor contiver erro', () => rejected(file([row({ CIDADE: 'CIDADE NOVA NAO CRIAR' }), row({ CNPJ: '04.252.011/0001-10', FORNECEDOR: 'OUTRO', MEDIDA: 'lirto' })], { name: 'dois-fornecedores-falha' })));
  await check('100 erros preservam contagem e amostra', () => rejected(file(Array.from({ length: 100 }, () => row({ MEDIDA: 'lirto' })), { name: 'cem-erros' }), replace, 400, async data => {
    assert.equal(data.sampleErrors.length, 50); const detail = await good(`/api/imports/${data.importId}`); assert.equal(detail.errorRows, 100); assert.equal(detail.totalRows, 100);
  }));
  await check('100 erros aleatórios de nomenclatura são todos rejeitados', () => rejected(file(Array.from({ length: 100 }, () => {
    const field = ['MODELO', 'PECA_SERVICO', 'MEDIDA'][Math.floor(random() * 3)];
    return row({ [field]: `${row()[field]} ERRO-${Math.floor(random() * 999999)}` });
  }), { name: 'cem-erros-aleatorios' }), replace, 400, async data => assert.equal((await good(`/api/imports/${data.importId}`)).errorRows, 100)));
  const invalidFiles = /** @type {Array<[string, {filename: string, bytes: Buffer}]>} */ ([
    ['arquivo-falso', { filename: 'falso.xlsx', bytes: Buffer.from('isto nao e excel') }],
    ['arquivo-vazio', { filename: 'vazio.xlsx', bytes: Buffer.alloc(0) }],
    ['extensao-invalida', { ...file([row()], { name: 'extensao' }), filename: 'tabela.csv' }],
    ['zip-truncado', { ...file([row()], { name: 'antes-truncar' }), bytes: file([row()], { name: 'truncar' }).bytes.subarray(0, 100) }],
    ['15mb-excedido', { filename: 'excessivo.xlsx', bytes: Buffer.alloc(15 * 1024 * 1024 + 1, 65) }],
    ['linhas-excedidas', file([row()], { name: 'linhas-excedidas', range: 'A1:I50001' })],
    ['colunas-excedidas', file([row()], { name: 'colunas-excedidas', range: 'A1:CW2' })],
    ['area-excedida', file([row()], { name: 'area-excedida', range: 'A1:U50000' })],
  ]);
  for (const [name, document] of invalidFiles) await check(`${name}: rejeição preserva banco e libera trava`, () => rejected(document, replace));
  await check('Primeira aba é a única importada', async () => {
    const result = await upload(file([row()], { name: 'duas-abas', extraSheet: [row({ MEDIDA: 'lirto' })] }), replace);
    assert.equal(result.status, 200); assert.equal(result.data.summary.items, 1);
  });
  await check('Limite real: 49.999 registros + cabeçalho passam', async () => {
    const large = file(Array.from({ length: 49999 }, () => row()), { name: 'limite-50000-linhas' });
    const result = await upload(large, replace); assert.equal(result.status, 200, JSON.stringify(result.data)); assert.equal(result.data.summary.items, 1);
  });
  await check('Erro na última das 49.999 linhas aborta a carga inteira', () => rejected(file(Array.from({ length: 49999 }, (_, index) => row(index === 49998 ? { MEDIDA: 'lirto' } : {})), { name: 'erro-no-fim-50000' }), replace, 400, data => assert.equal(data.sampleErrors[0].row, 50000)));
  await check('Carga de 10.000 condições distintas publica todas', async () => {
    const large = file(Array.from({ length: 10000 }, (_, index) => row({ CIDADE: `STRESS ${index}`, PRECO: index / 100 })), { name: 'dez-mil-condicoes' });
    const result = await upload(large, replace); assert.equal(result.status, 200, JSON.stringify(result.data)); assert.equal(result.data.summary.items, 10000);
    assert.equal(query('SELECT COUNT(*) n FROM agreement_items WHERE version_id=(SELECT current_version_id FROM agreements WHERE id=?)', agreementId)[0].n, 10000);
  });
  await check('20 concorrentes recebem 409 enquanto uma importação segura a trava', async () => {
    const doc = file([row()], { name: 'concorrencia' }), m = multipart(doc.filename, doc.bytes);
    const first = abrirRequisicao({ porta: port, caminho: replace, timeoutMs: 60000, cabecalhos: { cookie, 'content-type': m.tipo, 'transfer-encoding': 'chunked' } });
    await first.escrever(m.corpo.subarray(0, m.corpo.length - 20));
    try {
      for (let i = 0; i < 100 && !query('SELECT COUNT(*) n FROM travas')[0].n; i++) await pause(50);
      assert.equal(query('SELECT COUNT(*) n FROM travas')[0].n, 1);
      const results = await Promise.all(Array.from({ length: 20 }, () => upload(doc, replace)));
      assert.ok(results.every(r => r.status === 409), results.map(r => r.status).join(','));
    } finally { first.terminar(m.corpo.subarray(m.corpo.length - 20)); }
    assert.equal((await first.resposta).status, 200); assert.equal(query('SELECT COUNT(*) n FROM travas')[0].n, 0);
  });
  await check('Depois do estresse uma nova importação funciona', async () => assert.equal((await upload(file([row()], { name: 'apos-estresse' }), replace)).status, 200));
  await check('Exportação conserva os De/Para', async () => {
    const exported = await good('/api/export');
    assert.equal(exported.tables.importItemMappings.length, query('SELECT COUNT(*) n FROM import_item_mappings')[0].n);
    assert.equal(exported.tables.importModelMappings.length, query('SELECT COUNT(*) n FROM import_model_mappings')[0].n);
  });
  await check('Reinicialização conserva acordos e correspondências', async () => {
    const before = businessSnapshot(), mappings = await good('/api/mappings');
    reader.close(); reader = null; await stopServer(); await startServer(); reader = new DatabaseSync(sqlitePath, { readOnly: true });
    assert.deepEqual(businessSnapshot(), before); assert.deepEqual(await good('/api/mappings'), mappings);
  });
  await check('Atualização de banco anterior cria tabelas vazias e preserva dados', async () => {
    const before = businessSnapshot();
    reader.close(); reader = null; await stopServer();
    assert.ok(sqlitePath.startsWith(state + path.sep), 'Só permite alterar o banco desta execução');
    execFileSync(process.execPath, [path.join(portal, 'node_modules/wrangler/bin/wrangler.js'), 'd1', 'execute', 'DB', '--local', '--config', path.join(runtime, 'server/wrangler.json'), '--persist-to', state, '--command', 'DROP TABLE import_item_mappings; DROP TABLE import_model_mappings;'], { cwd: output, windowsHide: true, stdio: ['ignore', serverLog, serverLog], env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false' } });
    await startServer(); reader = new DatabaseSync(sqlitePath, { readOnly: true });
    assert.deepEqual(await good('/api/mappings'), { items: [], models: [] });
    assert.deepEqual(businessSnapshot(), before);
  });
  await check('Integridade final: sem órfãos, versões pendentes ou travas', async () => {
    assert.deepEqual(query('PRAGMA foreign_key_check'), []);
    assert.equal(query('PRAGMA integrity_check')[0].integrity_check, 'ok');
    assert.equal(query("SELECT COUNT(*) n FROM agreement_versions WHERE status='processing'")[0].n, 0);
    assert.equal(query('SELECT COUNT(*) n FROM travas')[0].n, 0);
    assert.equal(query("SELECT COUNT(*) n FROM imports WHERE status='processing'")[0].n, 0);
  });
} catch (error) {
  checks.push({ name: 'Infraestrutura/pré-condições', ok: false, error: error.stack });
  console.error(error);
} finally {
  reader?.close();
  await stopServer();
  fs.closeSync(serverLog);
  const report = { seed: 20260916, timestamp: new Date().toISOString(), output, passed: checks.filter(c => c.ok).length, failed: checks.filter(c => !c.ok).length, checks, metrics };
  fs.writeFileSync(path.join(output, 'resultado.json'), JSON.stringify(report, null, 2));
  console.log(`RESULTADO: ${report.passed} passaram; ${report.failed} falharam. ${path.join(output, 'resultado.json')}`);
  process.exitCode = report.failed ? 1 : 0;
}
