import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { TRIGGERS_REVISAO, TRIGGERS_REVISAO_LISTA_ACORDO } from '../lib/controle-escrita.ts';

void test('condicoes vigentes avancam revisao uma vez; historico e preparo nao invalidam paginas', () => {
  const db = new DatabaseSync(':memory:');
  try {
    for (const [, ddl] of fs.readFileSync(new URL('../lib/database.ts', import.meta.url), 'utf8').matchAll(/`(CREATE TABLE IF NOT EXISTS [^`]+)`/g)) db.exec(ddl);
    db.exec('ALTER TABLE agreements ADD COLUMN revision INTEGER DEFAULT 0; ALTER TABLE agreement_items ADD COLUMN revision INTEGER DEFAULT 0; PRAGMA recursive_triggers=ON');
    for (const sql of TRIGGERS_REVISAO.filter(sql => /AFTER UPDATE ON (agreements|agreement_items)\n/.test(sql))) db.exec(sql);
    for (const sql of TRIGGERS_REVISAO_LISTA_ACORDO) { db.exec(sql); db.exec(sql); }
    db.exec(`INSERT INTO suppliers(id,legal_name,trade_name,cnpj,created_at,updated_at) VALUES('s','Fixture','Fixture','11222333000181','x','x');
      INSERT INTO locations VALUES('l','CIDADE','SP'); INSERT INTO catalog_items(id,name) VALUES('i','ITEM');
      INSERT INTO vehicle_models(id,name) VALUES('m','MODELO'); INSERT INTO units(id,code,name) VALUES('u','UN','UN')`);
    db.exec("INSERT INTO agreements(id,number,supplier_id,current_version_id,start_date,created_at,updated_at) VALUES('a','A','s','v','2026-01-01','x','x')");
    db.exec("INSERT INTO agreement_versions(id,agreement_id,version_number,created_at) VALUES('v','a',1,'x'),('outra','a',2,'x')");
    const inserir = db.prepare("INSERT INTO agreement_items(id,version_id,location_id,catalog_item_id,vehicle_model_id,unit_id,price,created_at,updated_at) VALUES(?,?,'l','i','m','u',10,'x','x')");
    const revisao = () => db.prepare('SELECT revision FROM agreements').get().revision;
    inserir.run('i', 'v'); assert.equal(revisao(), 1);
    db.exec("UPDATE agreement_items SET price=20 WHERE id='i'"); assert.equal(revisao(), 2);
    inserir.run('em-preparo', 'outra'); assert.equal(revisao(), 2);
    db.exec("UPDATE agreement_items SET notes='historico' WHERE id='em-preparo'"); assert.equal(revisao(), 2);
    db.exec("DELETE FROM agreement_items WHERE id='i'"); assert.equal(revisao(), 3);
    inserir.run('novo', 'v'); assert.equal(revisao(), 4);
  } finally { db.close(); }
});
