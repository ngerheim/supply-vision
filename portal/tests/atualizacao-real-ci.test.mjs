import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { conferirAmostras, conferirBanco, versoesEsperadas, semearBanco } from '../../scripts/ci/atualizacao-real.mjs';
import path from 'node:path';
import fs from 'node:fs';

const ok = fase => ({ fase, health: true, supervisor: true, consumidores: true });
void test('H2 reprova quedas no PREPARAR/CONCLUIR e atualizacao sem parada', () => {
  assert.doesNotThrow(() => conferirAmostras([ok('PREPARAR'), { ...ok('TROCAR'), health: false }, ok('CONCLUIR')]));
  for (const fase of ['PREPARAR', 'CONCLUIR']) {
    assert.throws(() => conferirAmostras([{ ...ok(fase), health: false }]), /Operacao caiu|PREPARAR nao/);
  }
  assert.throws(() => conferirAmostras([ok('PREPARAR'), ok('TROCAR'), ok('CONCLUIR')]), /Nenhuma parada/);
  assert.throws(() => conferirAmostras([ok('PREPARAR'), { ...ok('PREPARAR'), consumidores: false }], true), /Operacao caiu/);
});
void test('H2 detecta dados perdidos e migracoes ausentes, permitindo coluna nova', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE tickets(id TEXT PRIMARY KEY, scope TEXT, nova TEXT); INSERT INTO tickets VALUES('h2','preservar',NULL); CREATE TABLE schema_migrations(version INTEGER); INSERT INTO schema_migrations VALUES(1)");
    const antes = { tickets: { colunas: ['id', 'scope'], linhas: [{ id: 'h2', scope: 'preservar' }] } };
    assert.doesNotThrow(() => conferirBanco(db, antes, [1]));
    assert.throws(() => conferirBanco(db, antes, [1, 2]), /Migracao 2 nao aplicada/);
    db.exec("UPDATE tickets SET scope='perdido'");
    assert.throws(() => conferirBanco(db, antes, [1]), /Dados alterados/);
  } finally { db.close(); }
});
void test('H2 deriva as migracoes do codigo de destino incluindo indices', () => {
  const raiz = path.resolve(import.meta.dirname, '../..');
  const versoes = versoesEsperadas(raiz);
  assert.ok(versoes.includes(1) && versoes.includes(7));
  assert.deepEqual(versoes, [...new Set(versoes)].sort((a, b) => a - b));
});

void test('H2 semeia dados ficticios usando o schema real da aplicacao', () => {
  const fonte = fs.readFileSync(path.resolve(import.meta.dirname, '../lib/database.ts'), 'utf8');
  const db = new DatabaseSync(':memory:');
  try {
    for (const nome of ['users', 'suppliers', 'agreements', 'tickets', 'ticket_events']) {
      const sql = [...fonte.matchAll(/`(CREATE TABLE IF NOT EXISTS [^`]+)`/g)].map(m => m[1]).find(sql => sql.startsWith(`CREATE TABLE IF NOT EXISTS ${nome} (`));
      assert.ok(sql, `Schema real ausente: ${nome}`);
      db.exec(sql);
    }
    db.exec("INSERT INTO users(id,name,email,password_salt,password_hash,role,created_at) VALUES('admin','Ficticio','admin@portal.local','salt','hash','admin','2026-01-01')");
    semearBanco(db);
    assert.equal(db.prepare('SELECT email FROM users').get().email, 'admin@h2.test');
    assert.equal(db.prepare('SELECT legal_name FROM suppliers').get().legal_name, 'Fornecedor ficticio H2');
    assert.equal(db.prepare('SELECT scope FROM tickets').get().scope, 'Dado a preservar');
  } finally { db.close(); }
});
