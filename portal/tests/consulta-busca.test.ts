import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { consultasOpcoesBusca, consultaBusca } from '../lib/consulta-busca.ts';

void test('busca e opções usam só a versão atual e respeitam vigência inclusive nas datas de início e fim', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`
      CREATE TABLE agreements(id TEXT,current_version_id TEXT,supplier_id TEXT,status TEXT,start_date TEXT,end_date TEXT);
      CREATE TABLE agreement_items(id TEXT,version_id TEXT,location_id TEXT,catalog_item_id TEXT,vehicle_model_id TEXT,unit_id TEXT);
      CREATE TABLE suppliers(id TEXT,trade_name TEXT);
      CREATE TABLE catalog_items(id TEXT,name TEXT);
      CREATE TABLE vehicle_models(id TEXT,name TEXT);
      CREATE TABLE locations(id TEXT,city TEXT,state TEXT);
      CREATE TABLE units(id TEXT);
      INSERT INTO suppliers VALUES('s','Fornecedor'); INSERT INTO vehicle_models VALUES('m','Modelo');
      INSERT INTO locations VALUES('l','Cidade','SP'); INSERT INTO units VALUES('u');
      INSERT INTO agreements VALUES
        ('a','atual','s','active','2026-10-07','2026-10-07'),
        ('suspenso','suspenso','s','suspended','2020-01-01',NULL),
        ('futuro','futuro','s','active','2026-10-08',NULL),
        ('expirado','expirado','s','active','2020-01-01','2026-10-06');
    `);
    for (const versao of ['atual','anterior','suspenso','futuro','expirado']) {
      db.prepare('INSERT INTO catalog_items VALUES(?,?)').run(versao, versao);
      db.prepare("INSERT INTO agreement_items VALUES(?,?,'l',?,'m','u')").run(versao, versao, versao);
    }
    const parametros = new URLSearchParams();
    const busca = consultaBusca(parametros, '2026-10-07');
    assert.deepEqual(db.prepare(`SELECT ai.id ${busca.sql}`).all(...busca.values).map(r=>r.id), ['atual']);
    const itens = consultasOpcoesBusca(parametros, '2026-10-07').find(c=>c.campo==='item')!;
    assert.deepEqual(db.prepare(itens.sql).all(...itens.values).map(r=>r.id), ['atual']);
    const modelo = consultasOpcoesBusca(new URLSearchParams({item:'atual'}), '2026-10-07').find(c=>c.campo==='model')!;
    assert.deepEqual(db.prepare(modelo.sql).all(...modelo.values).map(r=>r.id), ['m']);
  } finally { db.close(); }
});
