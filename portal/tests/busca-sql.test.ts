import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { padraoBuscaSql, textoBuscaSql } from '../lib/busca-sql.ts';
void test('busca paginada tolera acentos e caixa no SQLite real', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const query = db.prepare(`SELECT instr(${textoBuscaSql('?')},?)>0 matches`);
    for (const [value, term] of [
      ['São PAULO', 'sao paulo'],
      ['ÓLEO', 'óleo'],
      ['MANUTENÇÃO', 'manutencao'],
      ['texto '.repeat(30), 'texto '.repeat(25)],
    ])
      assert.equal(query.get(value, padraoBuscaSql(term))?.matches, 1);
  } finally {
    db.close();
  }
});
void test('caracteres especiais são literais e não expandem os resultados', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const query = db.prepare(`SELECT instr(${textoBuscaSql('?')},?)>0 matches`);
    for (const term of ['[', '[a]', '*', '?', '%', '_', "' OR 1=1 --"]) {
      assert.equal(query.get('abc', padraoBuscaSql(term))?.matches, 0);
      assert.equal(
        query.get('texto ' + term, padraoBuscaSql(term))?.matches,
        1,
      );
    }
  } finally {
    db.close();
  }
});
