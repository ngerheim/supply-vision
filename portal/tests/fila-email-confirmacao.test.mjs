import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { MENSAGEM_NAO_CONFIRMADO, concluir, processarNotificacoes, reservar } from '../scripts/processar-emails.mjs';

const config={PORTAL_URL:'http://portal',EMAIL_FROM_NAME:'Portal',SMTP_USER:'portal@exemplo.com'};
const payload=JSON.stringify({ticketId:'t1',codigo:'SUP-1',fornecedor:'Oficina',prioridade:'media',situacao:'aberto',solicitante:'Ana',responsavel:'Bia',autor:'Ana',resumo:'Teste',alteracoes:[],mensagem:null});
function banco(){
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users(id TEXT,email TEXT,active INTEGER,role TEXT); INSERT INTO users VALUES('bia','bia@exemplo.com',1,'editor'); CREATE TABLE email_notifications (id TEXT PRIMARY KEY,type TEXT,recipient_name TEXT,recipient_email TEXT,payload_json TEXT,status TEXT,attempts INTEGER,next_attempt_at TEXT,locked_at TEXT,sent_at TEXT,last_error TEXT,created_at TEXT,updated_at TEXT)`);
  db.prepare("INSERT INTO email_notifications VALUES ('um','atribuicao','Bia','bia@exemplo.com',?,'pending',0,'2000-01-01T00:00:00.000Z',NULL,NULL,NULL,'2026-01-01','2026-01-01')").run(payload);
  return db;
}
const transporte=()=>{const t={enviados:0,async sendMail(){t.enviados++}};return t};

void test('falha momentanea na confirmacao nao reenvia e conclui na nova tentativa',async()=>{
  const db=banco(),t=transporte();let falhas=1;
  try{
    await processarNotificacoes(db,config,t,{esperas:[0,0],concluir:(banco,item)=>{if(falhas-->0)throw new Error('database is locked');concluir(banco,item)}});
    assert.equal(t.enviados,1);
    assert.equal(db.prepare('SELECT status FROM email_notifications').get().status,'sent');
  }finally{db.close()}
});

void test('confirmacao que nunca grava vira falha explicita e nao volta para a fila',async()=>{
  const db=banco(),t=transporte();
  try{
    await processarNotificacoes(db,config,t,{esperas:[0,0],concluir:()=>{throw new Error('disk I/O error')}});
    assert.equal(t.enviados,1);
    const r=db.prepare('SELECT status,last_error,locked_at FROM email_notifications').get();
    assert.equal(r.status,'failed');assert.equal(r.last_error,MENSAGEM_NAO_CONFIRMADO);assert.equal(r.locked_at,null);
    assert.equal(reservar(db).length,0);
  }finally{db.close()}
});

for (const caso of ['desativado', 'viewer', 'email alterado', 'identidade alterada']) {
  void test(`notificacao pendente nao envia para destinatario ${caso}`, async () => {
    const db=banco(), t=transporte();
    try {
      if(caso==='desativado')db.exec('UPDATE users SET active=0');
      if(caso==='viewer')db.exec("UPDATE users SET role='viewer'");
      if(caso==='email alterado')db.exec("UPDATE users SET email='outro@exemplo.com'");
      if(caso==='identidade alterada')db.exec("ALTER TABLE email_notifications ADD COLUMN recipient_user_id TEXT; UPDATE email_notifications SET recipient_user_id='antigo'");
      await processarNotificacoes(db,config,t);
      assert.equal(t.enviados,0);
      assert.equal(db.prepare('SELECT status FROM email_notifications').get().status,'failed');
    }finally{db.close()}
  });
}
