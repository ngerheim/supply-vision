import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { TRIGGERS_REVISAO, revisaoConfere } from '../lib/revisoes-sql.ts';

void test('revisões avançam em edição, publicação e UPSERT mesmo sem alterar o timestamp', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA recursive_triggers=ON; CREATE TABLE agreements(id TEXT PRIMARY KEY,revision INTEGER NOT NULL DEFAULT 0,notes TEXT); CREATE TABLE agreement_items(id TEXT PRIMARY KEY,revision INTEGER NOT NULL DEFAULT 0,price REAL); CREATE TABLE users(id TEXT PRIMARY KEY,revision INTEGER NOT NULL DEFAULT 0,name TEXT)');
    for (const sql of TRIGGERS_REVISAO) db.exec(sql);
    db.exec("INSERT INTO agreements(id,notes) VALUES('a','original'); INSERT INTO agreement_items(id,price) VALUES('i',10)");
    const stale = 0;
    db.exec("UPDATE agreements SET notes='nova' WHERE id='a'");
    const revision = Number(db.prepare("SELECT revision FROM agreements WHERE id='a'").get()!.revision);
    assert.equal(revision,1);
    assert.equal(revisaoConfere(stale,revision),false);
    assert.equal(revisaoConfere(undefined,revision),false);
    assert.equal(revisaoConfere(revision,revision),true);
    db.exec("INSERT INTO agreement_items(id,price) VALUES('i',20) ON CONFLICT(id) DO UPDATE SET price=excluded.price");
    assert.equal(db.prepare("SELECT revision FROM agreement_items WHERE id='i'").get()!.revision,1);
    db.exec("INSERT INTO users(id,name) VALUES('u','original'); UPDATE users SET name='novo' WHERE id='u'");
    assert.equal(db.prepare("SELECT revision FROM users WHERE id='u'").get()!.revision,1);
    db.exec("UPDATE users SET revision=revision+1 WHERE id='u'");
    assert.equal(db.prepare("SELECT revision FROM users WHERE id='u'").get()!.revision,2);
  } finally { db.close(); }
});
