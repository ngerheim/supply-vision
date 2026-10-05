import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { MAX_EXPORT_AUDITORIA, erroExportacaoAuditoria, BUSCA_LITERAL_AUDITORIA_SQL } from '../lib/auditoria-limites.ts';

void test('busca de histórico trata porcentagem, sublinhado e barra como texto', () => {
 const db=new DatabaseSync(':memory:');
 try {
  db.exec('CREATE TABLE logs(details TEXT,entity TEXT);CREATE TABLE users(name TEXT);INSERT INTO users VALUES(NULL)');
  for(const value of ['100% concluido','1000 concluido','item_a','itemba',String.raw`pasta\arquivo`])db.prepare('INSERT INTO logs(details) VALUES (?)').run(value);
  const find=db.prepare(`SELECT details FROM logs l LEFT JOIN users u ON 1=1 WHERE ${BUSCA_LITERAL_AUDITORIA_SQL}`);
  for(const [q,expected] of [['%',['100% concluido']],['_',['item_a']],['\\',[String.raw`pasta\arquivo`]]])assert.deepEqual(find.all(String(q),String(q),String(q)).map(r=>r.details),expected);
 }finally{db.close();}
});
void test('exportação nunca trunca: aceita o limite e recusa antes de carregar acima dele', () => {
 assert.equal(erroExportacaoAuditoria(MAX_EXPORT_AUDITORIA),null);
 assert.match(erroExportacaoAuditoria(MAX_EXPORT_AUDITORIA+1)!,/Restrinja/);
});
