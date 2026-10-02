import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { MIGRAR_TITULOS_CHAMADOS_SQL, tituloChamado } from '../lib/chamados.ts';

void test('titulo e obrigatorio, aparado e limitado a 120 caracteres', () => {
  for (const value of ['', '  ', null, undefined, 42, {}]) assert.throws(() => tituloChamado(value), /título/);
  assert.equal(tituloChamado('  Negociar pneus  '), 'Negociar pneus');
  assert.equal(tituloChamado('A'.repeat(120)).length, 120);
  assert.throws(() => tituloChamado('A'.repeat(121)), /limite/);
});

void test('migracao preenche titulos antigos sem sobrescrever titulo ou dados legados', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE tickets (id TEXT PRIMARY KEY, code TEXT, supplier_name TEXT NOT NULL, cnpj TEXT, contact TEXT);
      INSERT INTO tickets VALUES ('antigo','SUP-0001','OFICINA','cnpj-legado','contato-legado'),('vazio','SUP-0002','','','');
      ALTER TABLE tickets ADD COLUMN title TEXT NOT NULL DEFAULT '';`);
    db.prepare(MIGRAR_TITULOS_CHAMADOS_SQL).run();
    assert.deepEqual({ ...db.prepare('SELECT title,cnpj,contact FROM tickets WHERE id=?').get('antigo') }, { title:'OFICINA', cnpj:'cnpj-legado', contact:'contato-legado' });
    assert.equal(db.prepare('SELECT title FROM tickets WHERE id=?').get('vazio')?.title, 'SUP-0002');
    db.prepare('UPDATE tickets SET title=? WHERE id=?').run('Titulo definido pelo usuario','antigo');
    db.prepare(MIGRAR_TITULOS_CHAMADOS_SQL).run();
    assert.equal(db.prepare('SELECT title FROM tickets WHERE id=?').get('antigo')?.title, 'Titulo definido pelo usuario');
  } finally { db.close(); }
});
