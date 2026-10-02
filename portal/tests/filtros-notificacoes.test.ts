import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { filtrosNotificacoes } from '../lib/filtros-notificacoes.ts';

void test('filtros combinam destinatario situacao tipo texto e periodo sem interpolar entrada',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE tickets(id TEXT,code TEXT,supplier_name TEXT);
      CREATE TABLE email_notifications(ticket_id TEXT,status TEXT,type TEXT,recipient_user_id TEXT,recipient_name TEXT,recipient_email TEXT,created_at TEXT);
      INSERT INTO tickets VALUES('1','SUP-0001','OFICINA');
      INSERT INTO email_notifications VALUES('1','failed','atribuicao','u1','Pessoa','p@example.com','2026-10-02T12:00:00Z'),
      ('1','sent','atribuicao','u1','Pessoa','p@example.com','2026-10-01T12:00:00Z');`);
    const params=new URLSearchParams({recipient:'u1',status:'failed',type:'atribuicao',q:'OFICINA',from:'2026-10-02',to:'2026-10-02'});
    const {where,values}=filtrosNotificacoes(params);
    const query=`SELECT e.status FROM email_notifications e JOIN tickets t ON t.id=e.ticket_id ${where}`;
    assert.deepEqual(db.prepare(query).all(...values).map(r=>r.status),['failed']);
    params.set('recipient',"u1' OR 1=1 --");
    const hostile=filtrosNotificacoes(params);
    assert.equal(db.prepare(`SELECT e.status FROM email_notifications e JOIN tickets t ON t.id=e.ticket_id ${hostile.where}`).all(...hostile.values).length,0);
  } finally {db.close();}
});
void test('paginacao recusa numeros fracionarios infinitos e negativos',()=>{
  for(const value of ['-1','Infinity','1.5','NaN']){
    const result=filtrosNotificacoes(new URLSearchParams({page:value,pageSize:value}));
    assert.equal(result.page,1);assert.equal(result.pageSize,25);
  }
  assert.equal(filtrosNotificacoes(new URLSearchParams({pageSize:'999'})).pageSize,100);
});
