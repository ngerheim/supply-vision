import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

void test('limpeza de tentativas por data usa índice, sem varrer a tabela', () => {
  const db=new DatabaseSync(':memory:');
  try {
    const fonte=fs.readFileSync(new URL('../lib/database.ts',import.meta.url),'utf8');
    for(const [,sql] of fonte.matchAll(/`(CREATE (?:TABLE|INDEX) IF NOT EXISTS [^`]+)`/g))
      if(sql.includes('login_attempts'))db.exec(sql);
    const plano=db.prepare('EXPLAIN QUERY PLAN DELETE FROM login_attempts WHERE created_at<?').all('2026-01-01');
    assert.ok(plano.some(row=>row.detail.includes('idx_login_attempts_created_at')),JSON.stringify(plano));
  } finally { db.close(); }
});
