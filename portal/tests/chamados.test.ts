import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { MIGRAR_FORNECEDORES_CHAMADOS_SQL, fornecedorChamado } from '../lib/chamados.ts';

void test('fornecedor e obrigatorio, normalizado e limitado a 120 caracteres', () => {
  for (const value of ['', '  ', null, undefined, 42, {}]) assert.throws(() => fornecedorChamado(value), /fornecedor/);
  assert.equal(fornecedorChamado('  Oficina   exemplo  '), 'OFICINA EXEMPLO');
  assert.equal(fornecedorChamado('A'.repeat(120)).length, 120);
  assert.throws(() => fornecedorChamado('A'.repeat(121)), /limite/);
});

void test('migracao identifica chamados sem fornecedor e preserva titulo e dados legados', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE tickets (id TEXT PRIMARY KEY, code TEXT, supplier_name TEXT NOT NULL, cnpj TEXT, contact TEXT);
      INSERT INTO tickets VALUES ('antigo','SUP-0001','OFICINA','cnpj-legado','contato-legado'),('vazio','SUP-0002','','','');
      ALTER TABLE tickets ADD COLUMN title TEXT NOT NULL DEFAULT '';`);
    db.prepare('UPDATE tickets SET title=? WHERE id=?').run('Titulo definido pelo usuario','antigo');
    db.prepare('INSERT INTO tickets VALUES (?,?,?,?,?,?)').run('so-titulo','SUP-0003','','cnpj','contato','Negociacao existente');
    db.prepare(MIGRAR_FORNECEDORES_CHAMADOS_SQL).run();
    assert.deepEqual({ ...db.prepare('SELECT supplier_name,title,cnpj,contact FROM tickets WHERE id=?').get('antigo') }, { supplier_name:'OFICINA', title:'Titulo definido pelo usuario', cnpj:'cnpj-legado', contact:'contato-legado' });
    assert.equal(db.prepare('SELECT supplier_name FROM tickets WHERE id=?').get('vazio')?.supplier_name, 'SUP-0002');
    assert.equal(db.prepare('SELECT supplier_name FROM tickets WHERE id=?').get('so-titulo')?.supplier_name, 'Negociacao existente');
    db.prepare('UPDATE tickets SET supplier_name=? WHERE id=?').run('Fornecedor definido depois','so-titulo');
    db.prepare(MIGRAR_FORNECEDORES_CHAMADOS_SQL).run();
    assert.equal(db.prepare('SELECT supplier_name FROM tickets WHERE id=?').get('so-titulo')?.supplier_name, 'Fornecedor definido depois');
    assert.equal(db.prepare('SELECT title FROM tickets WHERE id=?').get('so-titulo')?.title, 'Negociacao existente');
  } finally { db.close(); }
});
