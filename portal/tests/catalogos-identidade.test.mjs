import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ATUALIZAR_UNIDADE_SQL, ATUALIZAR_LOCALIDADE_SQL } from '../lib/catalogos-sql.ts';
void test('referencias inclusive historicas impedem reinterpretar unidade e localidade',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE units(id TEXT,code TEXT,name TEXT,active INTEGER,revision INTEGER);
      CREATE TABLE locations(id TEXT,city TEXT,state TEXT,revision INTEGER);
      CREATE TABLE agreement_items(unit_id TEXT,location_id TEXT);
      CREATE TABLE import_unit_mappings(target_id TEXT);
      CREATE TABLE agreement_locations(location_id TEXT);
      INSERT INTO units VALUES('u','LITRO','LITRO',1,0);
      INSERT INTO locations VALUES('l','CIDADE','SP',0);
      INSERT INTO agreement_items VALUES('u','l')`);
    assert.equal(db.prepare(ATUALIZAR_UNIDADE_SQL).run('PAR','PAR',1,'u',0,'PAR').changes,0);
    assert.equal(db.prepare(ATUALIZAR_UNIDADE_SQL).run('LITRO','LITRO',0,'u',0,'LITRO').changes,1);
    assert.equal(db.prepare(ATUALIZAR_LOCALIDADE_SQL).run('OUTRA','RJ','l',0,'OUTRA','RJ').changes,0);
    db.exec('DELETE FROM agreement_items');
    assert.equal(db.prepare(ATUALIZAR_UNIDADE_SQL).run('PAR','PAR',1,'u',0,'PAR').changes,1);
    assert.equal(db.prepare(ATUALIZAR_LOCALIDADE_SQL).run('OUTRA','RJ','l',0,'OUTRA','RJ').changes,1);
  }finally{db.close()}
});
