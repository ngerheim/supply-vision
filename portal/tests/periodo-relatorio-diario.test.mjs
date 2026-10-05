import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { dadosRelatorioDiario } from '../scripts/processar-emails.mjs';
void test('relatorio atrasado conserva o dia e as mensagens mesmo apos novas edicoes',()=>{
 const db=new DatabaseSync(':memory:');
 try{
 db.exec(`CREATE TABLE users(id TEXT,name TEXT);CREATE TABLE tickets(id TEXT,code TEXT,supplier_name TEXT,status TEXT,created_at TEXT,updated_at TEXT);CREATE TABLE ticket_events(ticket_id TEXT,user_id TEXT,kind TEXT,from_status TEXT,to_status TEXT,message TEXT,created_at TEXT);
 INSERT INTO tickets VALUES ('a','SUP-1','Oficina','aberto','2026-09-01T10:00:00Z','2026-10-03T15:00:00Z');
 INSERT INTO ticket_events VALUES ('a',NULL,'status','aberto','aguardando_fornecedor','Proposta recebida','2026-10-02T15:00:00Z');
 INSERT INTO ticket_events VALUES ('a',NULL,'note',NULL,NULL,'Dia seguinte','2026-10-03T03:00:00.000Z');
 INSERT INTO tickets VALUES ('b','SUP-2','Outra','aberto','2026-10-03T03:00:00.000Z','2026-10-03T03:00:00.000Z');`);
 const dados=dadosRelatorioDiario(db,'2026-10-02',new Date('2026-10-03T16:00:00Z'));
 assert.equal(dados.chamados.length,1);assert.equal(dados.chamados[0].atualizacoes.length,1);
 assert.match(dados.chamados[0].atualizacoes[0].descricao,/Proposta recebida/);
 }finally{db.close();}
});
