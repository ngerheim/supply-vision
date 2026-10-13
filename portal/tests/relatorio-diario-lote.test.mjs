import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dadosRelatorioDiario } from '../scripts/processar-emails.mjs';
import { montarEmailRelatorioDiario } from '../lib/email-relatorio-diario.ts';

const agora=new Date('2026-10-13T20:45:00.000Z');
const periodo={inicio:'2026-10-13T03:00:00.000Z',fim:agora.toISOString()};
// Oraculo congelado da main 9c83a0d: consulta antiga por chamado, independente
// da implementacao em lote. Compara inclusive o e-mail renderizado.
function dadosAntes(db, data, momento, janela){
  const inicio=janela?.inicio||`${data}T03:00:00.000Z`;
  const fim=janela?.fim||new Date(Math.min(momento.getTime(),Date.parse(inicio)+86400_000)).toISOString();
  const totais=db.prepare("SELECT SUM(status='aberto') aberto,SUM(status='aguardando_fornecedor') aguardando,SUM(status='fechado') fechado,SUM(status='cancelado') cancelado FROM tickets").get();
  const chamados=db.prepare("SELECT id,code codigo,supplier_name fornecedor,status situacao FROM tickets WHERE (created_at>=? AND created_at<?) OR EXISTS (SELECT 1 FROM ticket_events e WHERE e.ticket_id=tickets.id AND e.created_at>=? AND e.created_at<?) ORDER BY updated_at DESC").all(inicio,fim,inicio,fim);
  const eventos=db.prepare('SELECT e.kind,e.from_status,e.to_status,e.message,e.created_at,u.name autor FROM ticket_events e LEFT JOIN users u ON u.id=e.user_id WHERE e.ticket_id=? AND e.created_at>=? AND e.created_at<? ORDER BY e.created_at');
  const nomes={aberto:'Aberto',aguardando_fornecedor:'Aguardando fornecedor',fechado:'Fechado',cancelado:'Cancelado'};
  return {periodo:{inicio,fim},totais:{aberto:Number(totais.aberto||0),aguardando:Number(totais.aguardando||0),fechado:Number(totais.fechado||0),cancelado:Number(totais.cancelado||0)},chamados:chamados.map(c=>({...c,atualizacoes:eventos.all(c.id,inicio,fim).map(e=>({horario:new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'}).format(new Date(e.created_at)),autor:e.autor||'Sistema',descricao:e.kind==='status'?`Situação alterada para ${nomes[e.to_status]||e.to_status}${e.message?`: ${e.message}`:''}`:e.message||'Chamado atualizado'}))}))};
}
function banco(n){
  const db=new DatabaseSync(':memory:');
  for(const [,ddl] of fs.readFileSync(new URL('../lib/database.ts',import.meta.url),'utf8').matchAll(/`(CREATE TABLE IF NOT EXISTS [^`]+)`/g))db.exec(ddl);
  db.prepare('INSERT INTO users(id,name,email,password_salt,password_hash,created_at) VALUES(?,?,?,?,?,?)').run('u','Álvaro & Ana','pessoa@example.com','s','h','x');
  for(let i=0;i<n;i++){
    const id=String(i), data=i%2===0?periodo.inicio:'2026-10-12T03:00:00.000Z';
    db.prepare('INSERT INTO tickets(id,code,supplier_name,status,requested_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,'SUP-'+id,'Água <Peças>',['aberto','aguardando_fornecedor','fechado','cancelado'][i%4],'u',data,new Date(agora.getTime()-i*1000).toISOString());
    // Limites inclusivo/exclusivo, horarios empatados, usuario ausente e mensagem vazia.
    for(const [j,dataEvento] of ['2026-10-13T02:59:59.999Z',periodo.inicio,periodo.inicio,periodo.fim].entries()){
      db.prepare('INSERT INTO ticket_events(id,ticket_id,user_id,kind,to_status,message,created_at) VALUES(?,?,?,?,?,?,?)').run(`${id}-${j}`,id,j===1?'u':null,j===1?'status':'mensagem','aguardando_fornecedor',j===2?'':'Mudança & revisão',dataEvento);
    }
  }
  return db;
}
function contar(db){
  let consultas=0;
  return {get total(){return consultas;},db:{prepare(sql){const stmt=db.prepare(sql);return {get(...v){consultas++;return stmt.get(...v);},all(...v){consultas++;return stmt.all(...v);}};}}};
}
void test('conteudo e assunto/texto/HTML identicos ao legado; consultas 3/52/502 passam a 3/3/3',()=>{
  for(const n of [1,50,500]){
    const db=banco(n);
    try{
      const a=contar(db),b=contar(db);
      const antes=dadosAntes(a.db,'2026-10-13',agora,periodo),depois=dadosRelatorioDiario(b.db,'2026-10-13',agora,periodo);
      assert.equal(a.total,n+2);assert.equal(b.total,3);assert.deepEqual(depois,antes);
      const email=d=>montarEmailRelatorioDiario('2026-10-13',d.totais,d.chamados,'http://portal',d.periodo);
      assert.deepEqual(email(depois),email(antes));
      assert.deepEqual(dadosRelatorioDiario(db,'2026-10-13',agora),dadosAntes(db,'2026-10-13',agora,null));
      assert.equal(depois.chamados[0].atualizacoes.length,2);
    }finally{db.close();}
  }
});
void test('periodo vazio e chamado sem eventos preservam conteudo e nao criam consultas por chamado',()=>{
  const db=banco(0);
  try{
    let c=contar(db);assert.deepEqual(dadosRelatorioDiario(c.db,'2026-10-13',agora,periodo),dadosAntes(db,'2026-10-13',agora,periodo));assert.equal(c.total,2);
    db.prepare('INSERT INTO tickets(id,code,supplier_name,status,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('vazio','SUP-1','Fornecedor','aberto',periodo.inicio,periodo.inicio);
    c=contar(db);const dados=dadosRelatorioDiario(c.db,'2026-10-13',agora,periodo);assert.equal(c.total,3);assert.deepEqual(dados.chamados[0].atualizacoes,[]);
    assert.deepEqual(dados,dadosAntes(db,'2026-10-13',agora,periodo));
  }finally{db.close();}
});
