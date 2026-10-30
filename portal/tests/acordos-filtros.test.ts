import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { acordosApi } from '../lib/acordos-api.ts';
import { correspondeBusca } from '../lib/busca.ts';
import type { ContextoApi } from '../lib/api-compartilhada.ts';

void test('lista filtra localidades, fornecedor e condições da versão vigente em conjunto', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`
      CREATE TABLE agreements (id TEXT, number TEXT, status TEXT, start_date TEXT, end_date TEXT, updated_at TEXT, supplier_id TEXT, current_version_id TEXT);
      CREATE TABLE suppliers (id TEXT, trade_name TEXT, cnpj TEXT);
      CREATE TABLE locations (id TEXT, city TEXT, state TEXT);
      CREATE TABLE agreement_locations (agreement_id TEXT, location_id TEXT);
      CREATE TABLE catalog_items (id TEXT, name TEXT);
      CREATE TABLE vehicle_models (id TEXT, name TEXT);
      CREATE TABLE agreement_items (version_id TEXT, catalog_item_id TEXT, vehicle_model_id TEXT);
      INSERT INTO suppliers VALUES ('s', 'São João', '1'), ('outro', 'Outro', '2');
      INSERT INTO locations VALUES ('l', 'São Paulo', 'SP'), ('r', 'Rio', 'RJ');
      INSERT INTO catalog_items VALUES ('p', 'Peça'), ('q', 'Outro');
      INSERT INTO vehicle_models VALUES ('m', 'Ônibus'), ('n', 'Outro');
      INSERT INTO agreements VALUES
        ('a', 'A', 'active', '2020-01-01', NULL, '1', 's', 'v'),
        ('b', 'B', 'active', '2020-01-01', NULL, '2', 's', 'v2'),
        ('c', 'C', 'active', '2020-01-01', NULL, '3', 'outro', 'v3');
      INSERT INTO agreement_locations VALUES ('a','l'), ('b','l'), ('c','r');
      INSERT INTO agreement_items VALUES ('v','p','m'), ('old','p','m'), ('v2','q','n'), ('v3','p','m');
    `);
    const contexto = { all: async (sql: string, values: unknown[]) => db.prepare(sql).all(...values as string[]) } as unknown as ContextoApi;
    const listar = acordosApi(contexto).agreementList;
    const params = new URLSearchParams('state=sp&location=l&supplier=s&item=p&model=m');
    assert.deepEqual((await listar(params)).map(row => row.id), ['a']);
    assert.deepEqual((await listar(new URLSearchParams('supplier=s&item=p&model=n'))).map(row => row.id), []);
    assert.equal((await listar(new URLSearchParams())).length, 3);
    assert.equal(correspondeBusca('São João Ônibus Peça', 'sao joao onibus peca'), true);
  } finally {
    db.close();
  }
});
