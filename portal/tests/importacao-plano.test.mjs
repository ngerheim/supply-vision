import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import * as XLSX from 'xlsx';
import { importacoesApi } from '../lib/importacoes-api.ts';
import { catalogosApi } from '../lib/catalogos-api.ts';
import { mapeamentosApi } from '../lib/mapeamentos-api.ts';
import { TABELAS_CADASTRO, TRIGGERS_REVISAO, TravaPerdida } from '../lib/controle-escrita.ts';
import { impressaoPlanoImportacao } from '../lib/plano-importacao.ts';
import { normalizeCnpj, normalizeText } from '../lib/domain.ts';

const mensagem = 'Os De/Para ou cadastros mudaram desde a conferência. Confira a planilha novamente antes de publicar.';
const user = { id: 'u', role: 'admin' };

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  for (const [, ddl] of fs.readFileSync(new URL('../lib/database.ts', import.meta.url), 'utf8').matchAll(/`(CREATE TABLE IF NOT EXISTS [^`]+)`/g)) if(!ddl.includes('${')) db.exec(ddl);
  db.exec("ALTER TABLE catalog_items ADD COLUMN unidade_estoque TEXT NOT NULL DEFAULT 'un' CHECK(unidade_estoque IN ('un','L','m','kg'))");
  for (const tabela of ['agreements', 'agreement_items', 'users', ...TABELAS_CADASTRO]) db.exec(`ALTER TABLE ${tabela} ADD COLUMN revision INTEGER NOT NULL DEFAULT 0`);
  for (const sql of TRIGGERS_REVISAO) db.exec(sql);
  db.exec(`INSERT INTO suppliers(id,legal_name,trade_name,cnpj,created_at,updated_at) VALUES('s','Fixture','Fixture','11222333000181','x','x');
    INSERT INTO users(id,name,email,password_salt,password_hash,role,created_at) VALUES('u','Fixture','u@example.com','s','h','admin','x');
    INSERT INTO agreements(id,number,supplier_id,status,start_date,end_date,created_at,updated_at) VALUES('a','A','s','active','2026-01-01','2026-12-31','x','x');
    INSERT INTO locations(id,city,state) VALUES('l','CIDADE','SP');
    INSERT INTO catalog_items(id,name,active) VALUES('i','ITEM',1),('i2','OUTRO ITEM',1);
    INSERT INTO vehicle_models(id,name,active) VALUES('m','MODELO',1),('m2','OUTRO MODELO',1);
    INSERT INTO units(id,code,name,active) VALUES('un','UN','UN',1),('un2','PAR','PAR',1);
    INSERT INTO import_item_mappings(id,source_text,source_key,target_id,active,created_at,updated_at) VALUES('mi','ITEM','ITEM','i',1,'x','x');
    INSERT INTO import_model_mappings(id,source_text,source_key,target_id,active,created_at,updated_at) VALUES('mm','MODELO','MODELO','m',1,'x','x');`);
  const prepare = (sql, values = []) => ({ sql, values, bind(...v) { return prepare(sql, v); }, async run() { return { meta: db.prepare(sql).run(...values) }; } });
  let antesDoLote = async () => {};
  let depoisDoCorpo = async () => {};
  const banco = { prepare, async batch(statements) {
    await antesDoLote(statements);
    db.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map(s => ({ meta: db.prepare(s.sql).run(...s.values) }));
      db.exec('COMMIT'); return results;
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  } };
  let n = 0;
  const contexto = { id: p => `${p}${n++}`, now: () => new Date().toISOString(), rawDb: () => banco,
    normalizeCnpj, normalizeText, jsonBody: async request => { const body = await request.json(); await depoisDoCorpo(); return body; },
    TRAVA_IMPORTACAO: 'importacao', adquirirTrava: async (chave, dono) => {
      if (db.prepare('SELECT 1 FROM travas WHERE chave=?').get(chave)) return false;
      db.prepare('INSERT INTO travas(chave,dono,adquirida_em) VALUES(?,?,?)').run(chave, dono, 'x'); return true;
    }, renovarTrava: async (chave, dono) => { if (!db.prepare('SELECT 1 FROM travas WHERE chave=? AND dono=?').get(chave, dono)) throw new TravaPerdida(); },
    liberarTrava: async (chave, dono) => { db.prepare('DELETE FROM travas WHERE chave=? AND dono=?').run(chave, dono); },
    all: async (sql, values = []) => db.prepare(sql).all(...values), first: async (sql, values = []) => db.prepare(sql).get(...values),
    ok: (v, init) => Response.json(v, init), fail: (error, status = 400) => Response.json({ error }, { status }) };
  const api = importacoesApi(contexto, { travarAcordo: async () => 'dono', soltarAcordo: async () => {} });
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{ CIDADE: 'CIDADE', UF: 'SP', MODELO: 'MODELO', PECA_SERVICO: 'ITEM', PRECO: 10, MEDIDA: 'UN', MARCAS: 'MARCA' }]), 'Fixture');
  const bytes = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
  const importar = async (previa) => {
    const form = new FormData(); form.set('file', new Blob([bytes]), 'fixture.xlsx');
    if (previa) { form.set('expectedRevision', String(previa.agreementRevision)); form.set('expectedPlanFingerprint', previa.planFingerprint); }
    return api.importWorkbook(new Request(`http://fixture/api/imports/agreement/a${previa ? '' : '?preview=1'}`, { method: 'POST', body: form }), user, 'a');
  };
  const snapshot = () => JSON.stringify(['agreements', 'agreement_versions', 'agreement_items', 'agreement_locations', 'audit_logs'].map(table => db.prepare(`SELECT * FROM ${table}`).all()));
  return { db, importar, snapshot, catalogos: catalogosApi(contexto), mappings: mapeamentosApi(contexto), noLote: fn => { antesDoLote = fn; }, noCorpo: fn => { depoisDoCorpo = fn; } };
}

for (const [nome, sql] of [
  ['De/Para de item', "UPDATE import_item_mappings SET target_id='i2'"],
  ['De/Para de modelo', "UPDATE import_model_mappings SET target_id='m2'"],
  ['De/Para de unidade', "INSERT INTO import_unit_mappings(id,source_text,source_key,target_id,active,created_at,updated_at) VALUES('mu','UN','UN','un2',1,'x','x')"],
  ['cadastro desativado', 'UPDATE catalog_items SET active=0'],
  ['modelo desativado', 'UPDATE vehicle_models SET active=0'],
  ['unidade desativada', 'UPDATE units SET active=0'],
  ['localidade alterada', "UPDATE locations SET city='OUTRA CIDADE'"],
]) void test(`${nome} entre previa e publicacao gera conflito sem gravar condicoes`, async t => {
  const f = fixture(t), previa = await (await f.importar()).json();
  assert.equal(previa.valid, true);
  f.db.exec(sql);
  const antes = f.snapshot(), resposta = await f.importar(previa);
  assert.equal(resposta.status, 409);
  assert.equal((await resposta.json()).error, mensagem);
  assert.equal(f.snapshot(), antes);
  assert.equal(f.db.prepare('SELECT status FROM imports').get().status, 'conflict');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM travas').get().n, 0);
});

for (const [nome, sql] of [
  ['plano inalterado', 'SELECT 1'],
  ['observacao e revisao do De/Para', "UPDATE import_item_mappings SET notes='OBSERVACAO FICTICIA'"],
  ['nome de exibicao', "UPDATE catalog_items SET name='NOME CORRIGIDO' WHERE id='i'"],
  ['cadastro nao utilizado', "UPDATE catalog_items SET active=0 WHERE id='i2'"],
]) void test(`${nome} conserva impressao e publica`, async t => {
  const f = fixture(t), previa = await (await f.importar()).json();
  f.db.exec(sql);
  const nova = await (await f.importar()).json();
  assert.equal(nova.planFingerprint, previa.planFingerprint);
  assert.equal((await f.importar(previa)).status, 200);
  const item = f.db.prepare('SELECT location_id,catalog_item_id,vehicle_model_id,unit_id,price,courtesy,brands_text FROM agreement_items').get();
  assert.deepEqual({ ...item }, { location_id: 'l', catalog_item_id: 'i', vehicle_model_id: 'm', unit_id: 'un', price: 10, courtesy: 0, brands_text: 'MARCA' });
});

void test('impressao canonica ignora ordem e rotulos; inclui cada valor persistido', () => {
  const row = { locationId: 'l', itemId: 'i', modelId: 'm', unitId: 'u', price: 10, brands: 'MARCA' };
  const outro = { ...row, itemId: 'i2' };
  const hash = rows => impressaoPlanoImportacao('a', rows);
  assert.match(hash([row]), /^[a-f0-9]{64}$/);
  assert.equal(hash([row, outro]), hash([outro, { ...row, rowNumber: 99, item: 'OUTRO ROTULO' }]));
  for (const campo of ['locationId', 'itemId', 'modelId', 'unitId', 'price', 'brands']) {
    assert.notEqual(hash([row]), hash([{ ...row, [campo]: campo === 'price' ? 0 : 'OUTRO' }]), campo);
  }
  assert.equal(hash([{ ...row, brands: '' }]), hash([{ ...row, brands: null }]));
});

const pedido = () => new Request('http://fixture', { method: 'POST', body: '{}' });
void test('todos os escritores de cadastros e De/Para respeitam a reserva ate o ultimo lote', { timeout: 10000 }, async t => {
  const f = fixture(t), previa = await (await f.importar()).json();
  let anunciar, continuar;
  const chegou = new Promise(resolve => { anunciar = resolve; });
  const aguardar = new Promise(resolve => { continuar = resolve; });
  f.noLote(async statements => {
    if (statements.some(s => s.sql.includes('INSERT INTO agreement_items'))) { anunciar(); await aguardar; }
  });
  const publicacao = f.importar(previa);
  await chegou;
  try {
    const antes = f.snapshot();
    for (const type of ['suppliers', 'items', 'models', 'units', 'locations']) {
      for (const r of [await f.catalogos.createCatalog(pedido(), user, type), await f.catalogos.updateCatalog(pedido(), user, type, 'i'), await f.catalogos.deleteCatalog(user, type, 'i', 0)]) assert.equal(r.status, 409);
    }
    for (const type of ['items', 'models', 'units']) {
      for (const r of [await f.mappings.createMapping(pedido(), user, type), await f.mappings.updateMapping(pedido(), user, type, 'mi'), await f.mappings.deleteMapping(user, type, 'mi', 0)]) assert.equal(r.status, 409);
    }
    assert.equal(f.snapshot(), antes);
  } finally { continuar(); }
  assert.equal((await publicacao).status, 200);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM travas').get().n, 0);
  // A falha de validacao tambem libera a reserva para a proxima importacao.
  assert.equal((await f.catalogos.createCatalog(pedido(), user, 'items')).status, 400);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM travas').get().n, 0);
});

void test('cadastro em andamento impede a importacao de resolver um plano parcial', { timeout: 10000 }, async t => {
  const f = fixture(t);
  let anunciar, continuar;
  const chegou = new Promise(resolve => { anunciar = resolve; });
  const aguardar = new Promise(resolve => { continuar = resolve; });
  f.noLote(async statements => {
    if (statements.some(s => s.sql.includes('INSERT INTO catalog_items'))) { anunciar(); await aguardar; }
  });
  const cadastro = f.catalogos.createCatalog(new Request('http://fixture', { method: 'POST', body: JSON.stringify({ name: 'NOVO ITEM FICTICIO', unidadeEstoque:'kg' }) }), user, 'items');
  await chegou;
  try { assert.equal((await f.importar()).status, 409); }
  finally { continuar(); }
  assert.equal((await cadastro).status, 201);
  assert.equal(f.db.prepare("SELECT unidade_estoque FROM catalog_items WHERE name='NOVO ITEM FICTICIO'").get().unidade_estoque,'kg');
  assert.equal((await f.importar()).status, 200);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM travas').get().n, 0);
});

void test('falha de escrita em cadastro libera a reserva sem gravar parcialmente', async t => {
  const f = fixture(t);
  f.db.exec("CREATE TRIGGER falha_fixture BEFORE INSERT ON catalog_items BEGIN SELECT RAISE(ABORT, 'falha sintetica'); END");
  const antes = f.snapshot();
  await assert.rejects(f.catalogos.createCatalog(new Request('http://fixture', { method: 'POST', body: JSON.stringify({ name: 'NOVO ITEM FICTICIO', unidadeEstoque:'un' }) }), user, 'items'), /falha sintetica/);
  assert.equal(f.snapshot(), antes);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM travas').get().n, 0);
});

void test('catálogo de itens cria e edita unidade de estoque', async t => {
  const f=fixture(t);
  const criar=await f.catalogos.createCatalog(new Request('http://fixture',{method:'POST',body:JSON.stringify({name:'Item com unidade fictício',unidadeEstoque:'L'})}),user,'items');
  assert.equal(criar.status,201);
  const criado=await criar.json();
  assert.equal(f.db.prepare('SELECT unidade_estoque FROM catalog_items WHERE id=?').get(criado.id).unidade_estoque,'L');
  const editar=await f.catalogos.updateCatalog(new Request('http://fixture',{method:'PUT',body:JSON.stringify({name:'Item com unidade fictício',unidadeEstoque:'kg',expectedRevision:0})}),user,'items',criado.id);
  assert.equal(editar.status,200);
  assert.equal(f.db.prepare('SELECT unidade_estoque FROM catalog_items WHERE id=?').get(criado.id).unidade_estoque,'kg');
  assert.equal((await f.catalogos.createCatalog(new Request('http://fixture',{method:'POST',body:JSON.stringify({name:'Unidade inválida',unidadeEstoque:'cx'})}),user,'items')).status,400);
});

void test('escritor que perdeu a reserva durante a leitura do corpo nao altera referencias', async t => {
  const f = fixture(t), antes = f.snapshot();
  f.noCorpo(async () => { f.db.exec("UPDATE travas SET dono='outro-dono'"); });
  await assert.rejects(f.mappings.updateMapping(new Request('http://fixture', { method: 'PUT', body: JSON.stringify({ source: 'ITEM', targetId: 'i2', expectedRevision: 0 }) }), user, 'items', 'mi'), TravaPerdida);
  assert.equal(f.db.prepare("SELECT target_id FROM import_item_mappings WHERE id='mi'").get().target_id, 'i');
  assert.equal(f.snapshot(), antes);
  assert.equal(f.db.prepare('SELECT dono FROM travas').get().dono, 'outro-dono');
});
