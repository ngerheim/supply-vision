import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { exportarTabelas } from '../lib/exportacao-snapshot.ts';
import { SCHEMA_RELATORIOS } from '../lib/relatorios.ts';

void test('exportacao mantem referencias quando exclusao ocorre durante leituras',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sv-export-snapshot-')),arquivo=path.join(dir,'db.sqlite');
  const reader=new DatabaseSync(arquivo),writer=new DatabaseSync(arquivo);
  try {
    reader.exec('PRAGMA journal_mode=WAL');
    for(const [,ddl] of fs.readFileSync(new URL('../lib/database.ts',import.meta.url),'utf8').matchAll(/`(CREATE TABLE IF NOT EXISTS [^`]+)`/g))reader.exec(ddl);
    for(const ddl of SCHEMA_RELATORIOS)reader.exec(ddl);
    reader.exec(`ALTER TABLE users ADD COLUMN daily_report_enabled INTEGER DEFAULT 0; ALTER TABLE users ADD COLUMN daily_report_time TEXT;
      INSERT INTO suppliers(id,legal_name,trade_name,cnpj,created_at,updated_at) VALUES('s','Ficticio','Ficticio','0','x','x');
      INSERT INTO agreements(id,number,supplier_id,start_date,current_version_id,created_at,updated_at) VALUES('a','1','s','2026-10-01','v','x','x');
      INSERT INTO agreement_versions(id,agreement_id,version_number,created_at) VALUES('v','a',1,'x')`);
    let lotes=0;
    const db={prepare:sql=>sql,batch:async queries=>{
      lotes++;reader.exec('BEGIN');
      try {
        const results=queries.map(sql=>{
          const rows=reader.prepare(sql).all();
          if(sql.startsWith('SELECT * FROM agreements '))writer.exec("BEGIN; DELETE FROM agreement_versions; DELETE FROM agreements; COMMIT");
          return {results:rows};
        });reader.exec('COMMIT');return results;
      }catch(e){reader.exec('ROLLBACK');throw e;}
    }};
    const tables=await exportarTabelas(db);
    assert.equal(lotes,1);assert.equal(tables.agreements.length,1);assert.equal(tables.agreementVersions.length,1);
    assert.equal(tables.agreements[0].current_version_id,tables.agreementVersions[0].id);
    assert.equal(writer.prepare('SELECT COUNT(*) n FROM agreements').get().n,0);
    assert.equal(tables.users.some(u=>'password_hash' in u),false);
  } finally { reader.close();writer.close();fs.rmSync(dir,{recursive:true,force:true}); }
});
