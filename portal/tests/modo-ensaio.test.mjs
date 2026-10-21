import './apoio/logs-email.mjs';
import { bancoFicticio } from './apoio/backup.mjs';
import { destinoBanco } from '../scripts/banco-local.mjs';
import { criarTemporarioTeste } from './apoio/ambiente.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { modoEnsaio } from '../scripts/modo-ensaio.mjs';
import { processarNotificacoes, processarRelatoriosDiarios } from '../scripts/processar-emails.mjs';
import { portaSemServico } from '../scripts/porta-teste.mjs';

void test('somente MODO_ENSAIO=1 ativa o ensaio; as duas filas ficam intactas sem SMTP', async (t) => {
  const anterior=process.env.MODO_ENSAIO;
  t.after(()=>{if(anterior===undefined)delete process.env.MODO_ENSAIO;else process.env.MODO_ENSAIO=anterior;});
  for(const valor of [undefined,'0','true','']){
    if(valor===undefined)delete process.env.MODO_ENSAIO;else process.env.MODO_ENSAIO=valor;
    assert.equal(modoEnsaio(),false);
  }
  process.env.MODO_ENSAIO='1';assert.equal(modoEnsaio(),true);
  const db=new DatabaseSync(':memory:');
  t.after(()=>db.close());
  db.exec(`CREATE TABLE email_notifications(id TEXT,status TEXT,attempts INTEGER,locked_at TEXT,updated_at TEXT);
    CREATE TABLE users(id TEXT,active INTEGER,role TEXT,daily_report_enabled INTEGER,daily_report_time TEXT);
    CREATE TABLE daily_report_deliveries(id TEXT,user_id TEXT,report_date TEXT,status TEXT,attempts INTEGER,locked_at TEXT,updated_at TEXT,period_start TEXT,period_end TEXT,sent_at TEXT,created_at TEXT,next_attempt_at TEXT,payload_json TEXT);
    INSERT INTO email_notifications VALUES('chamado','pending',0,NULL,'original');
    INSERT INTO daily_report_deliveries(id,status,attempts,updated_at,payload_json) VALUES('diario','pending',0,'original','{}');`);
  const antes= ['email_notifications','daily_report_deliveries'].map(tabela=>db.prepare(`SELECT * FROM ${tabela}`).all());
  const transporte={sendMail(){assert.fail('SMTP nao pode ser chamado em ensaio');}};
  const logs=[],original=console.log;console.log=(linha)=>logs.push(linha);
  try{
    await processarNotificacoes(db,{},transporte);
    await processarRelatoriosDiarios(db,{},transporte);
  }finally{console.log=original;}
  assert.deepEqual(['email_notifications','daily_report_deliveries'].map(tabela=>db.prepare(`SELECT * FROM ${tabela}`).all()),antes);
  assert.equal(logs.filter(linha=>linha.includes('ensaio: envio suprimido')).length,2);
});

for(const existente of [true,false])void test(`backup em ensaio valida copia local e nao toca rede ${existente?'existente':'ausente'}, sem SMTP`,async(t)=>{
  const dir=criarTemporarioTeste('sv-ensaio-');
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const arquivo=destinoBanco('a.sqlite',path.join(dir,'portal'));
  fs.mkdirSync(path.dirname(arquivo),{recursive:true});
  const db=bancoFicticio(arquivo);db.close();
  const rede=path.join(dir,'rede'),config=path.join(dir,'portal/configuracao');
  fs.mkdirSync(config,{recursive:true});
  fs.writeFileSync(path.join(config,'portal.env'),`PORTAL_PORTA=${await portaSemServico()}\nRELATORIOS_PORTA=${await portaSemServico()}\nBACKUP_NETWORK_DIR=${rede}\n`);
  if(existente){fs.mkdirSync(rede);fs.writeFileSync(path.join(rede,'portal-atual.sqlite'),'backup do notebook');}
  const resultado=spawnSync(process.execPath,['--experimental-strip-types','scripts/backup.mjs'],{
    cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,SUPPLY_VISION_PRIVADO:dir,MODO_ENSAIO:'1'},encoding:'utf8',timeout:15_000,
  });
  assert.equal(resultado.status,0,resultado.stderr);
  assert.match(resultado.stdout,/ensaio: envio suprimido/);
  assert.equal(fs.existsSync(path.join(dir,'portal/backups/portal-atual.sqlite')),false);
  assert.equal(fs.existsSync(path.join(dir,'portal/backups/historico')),false);
  if(existente){assert.deepEqual(fs.readdirSync(rede),['portal-atual.sqlite']);assert.equal(fs.readFileSync(path.join(rede,'portal-atual.sqlite'),'utf8'),'backup do notebook');}
  else assert.equal(fs.existsSync(rede),false);
});

void test('processador CLI em ensaio nao exige SMTP nem tenta verificar conexao',async(t)=>{
  const dir=criarTemporarioTeste('sv-email-ensaio-');
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.mkdirSync(path.join(dir,'portal/configuracao'),{recursive:true});
  fs.mkdirSync(path.join(dir,'portal/logs'),{recursive:true});
  fs.writeFileSync(path.join(dir,'portal/configuracao/portal.env'),`PORTAL_PORTA=${await portaSemServico()}\nRELATORIOS_PORTA=${await portaSemServico()}\n`);
  for(const args of [[],['--test-connection']]){
    const resultado=spawnSync(process.execPath,['--experimental-strip-types','scripts/processar-emails.mjs',...args],{
      cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,SUPPLY_VISION_PRIVADO:dir,MODO_ENSAIO:'1'},encoding:'utf8',timeout:15_000,
    });
    assert.equal(resultado.status,0,resultado.stderr);
    assert.doesNotMatch(resultado.stderr, /Nao foi possivel gravar o log/);
    assert.ok(fs.statSync(path.join(dir, 'portal/logs/portal-email.log')).size > 0);
    assert.match(resultado.stdout,args.length?/ensaio: envio suprimido/:/Fila ainda nao disponivel/);
  }
});

void test('relatorio diario e preparado em ensaio e permanece pendente sem tentativa',async(t)=>{
  const anterior=process.env.MODO_ENSAIO;
  t.after(()=>{if(anterior===undefined)delete process.env.MODO_ENSAIO;else process.env.MODO_ENSAIO=anterior;});
  process.env.MODO_ENSAIO='1';
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  db.exec(`CREATE TABLE users(id TEXT,active INTEGER,role TEXT,daily_report_enabled INTEGER,daily_report_time TEXT);
    INSERT INTO users VALUES('u',1,'admin',1,'00:00');
    CREATE TABLE daily_report_deliveries(id TEXT,user_id TEXT,report_date TEXT,status TEXT,attempts INTEGER,locked_at TEXT,updated_at TEXT,period_start TEXT,period_end TEXT,sent_at TEXT,created_at TEXT,next_attempt_at TEXT,payload_json TEXT);`);
  db.exec(`CREATE TABLE tickets(id TEXT,code TEXT,supplier_name TEXT,status TEXT,created_at TEXT,updated_at TEXT); CREATE TABLE ticket_events(ticket_id TEXT,user_id TEXT,kind TEXT,from_status TEXT,to_status TEXT,message TEXT,created_at TEXT);`);
  const transporte={sendMail(){assert.fail('SMTP nao pode ser chamado');}};
  await processarRelatoriosDiarios(db,{},transporte);
  const item=db.prepare('SELECT * FROM daily_report_deliveries').get();
  assert.equal(item.status,'pending');assert.equal(item.attempts,0);assert.equal(item.locked_at,null);assert.equal(item.sent_at,null);
  assert.ok(item.period_start);assert.ok(item.period_end);
  await processarRelatoriosDiarios(db,{},transporte);
  assert.deepEqual(db.prepare('SELECT * FROM daily_report_deliveries').all(),[item]);
});
