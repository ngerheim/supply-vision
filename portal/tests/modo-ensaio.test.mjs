import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { modoEnsaio } from '../scripts/modo-ensaio.mjs';
import { processarNotificacoes, processarRelatoriosDiarios } from '../scripts/processar-emails.mjs';

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
    CREATE TABLE daily_report_deliveries(id TEXT,user_id TEXT,report_date TEXT,status TEXT,attempts INTEGER,locked_at TEXT,updated_at TEXT,period_start TEXT,period_end TEXT,sent_at TEXT,created_at TEXT,next_attempt_at TEXT);
    INSERT INTO email_notifications VALUES('chamado','pending',0,NULL,'original');
    INSERT INTO daily_report_deliveries(id,status,attempts,updated_at) VALUES('diario','pending',0,'original');`);
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

for(const existente of [true,false])void test(`backup em ensaio valida copia local e nao toca rede ${existente?'existente':'ausente'}, sem SMTP`,(t)=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sv-ensaio-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const arquivo=path.join(dir,'portal/banco/estado/state/v3/d1/miniflare-D1DatabaseObject/a.sqlite');
  fs.mkdirSync(path.dirname(arquivo),{recursive:true});
  const db=new DatabaseSync(arquivo);db.exec("CREATE TABLE teste(valor TEXT); INSERT INTO teste VALUES('ensaio')");db.close();
  const rede=path.join(dir,'rede'),config=path.join(dir,'portal/configuracao');
  fs.mkdirSync(config,{recursive:true});
  fs.writeFileSync(path.join(config,'portal.env'),`BACKUP_NETWORK_DIR=${rede}\n`);
  if(existente){fs.mkdirSync(rede);fs.writeFileSync(path.join(rede,'portal-atual.sqlite'),'backup do notebook');}
  const resultado=spawnSync(process.execPath,['--experimental-strip-types','scripts/backup.mjs'],{
    cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,SUPPLY_VISION_PRIVADO:dir,MODO_ENSAIO:'1'},encoding:'utf8',timeout:15_000,
  });
  assert.equal(resultado.status,0,resultado.stderr);
  assert.match(resultado.stdout,/ensaio: envio suprimido/);
  const copia=new DatabaseSync(path.join(dir,'portal/backups/portal-atual.sqlite'),{readOnly:true});
  try{assert.equal(copia.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(copia.prepare('SELECT valor FROM teste').get().valor,'ensaio');}finally{copia.close();}
  assert.equal(fs.readdirSync(path.join(dir,'portal/backups/historico')).length,1);
  if(existente){assert.deepEqual(fs.readdirSync(rede),['portal-atual.sqlite']);assert.equal(fs.readFileSync(path.join(rede,'portal-atual.sqlite'),'utf8'),'backup do notebook');}
  else assert.equal(fs.existsSync(rede),false);
});

void test('processador CLI em ensaio nao exige SMTP nem tenta verificar conexao',(t)=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sv-email-ensaio-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  for(const args of [[],['--test-connection']]){
    const resultado=spawnSync(process.execPath,['--experimental-strip-types','scripts/processar-emails.mjs',...args],{
      cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,SUPPLY_VISION_PRIVADO:dir,MODO_ENSAIO:'1'},encoding:'utf8',timeout:15_000,
    });
    assert.equal(resultado.status,0,resultado.stderr);
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
    CREATE TABLE daily_report_deliveries(id TEXT,user_id TEXT,report_date TEXT,status TEXT,attempts INTEGER,locked_at TEXT,updated_at TEXT,period_start TEXT,period_end TEXT,sent_at TEXT,created_at TEXT,next_attempt_at TEXT);`);
  const transporte={sendMail(){assert.fail('SMTP nao pode ser chamado');}};
  await processarRelatoriosDiarios(db,{},transporte);
  const item=db.prepare('SELECT * FROM daily_report_deliveries').get();
  assert.equal(item.status,'pending');assert.equal(item.attempts,0);assert.equal(item.locked_at,null);assert.equal(item.sent_at,null);
  assert.ok(item.period_start);assert.ok(item.period_end);
  await processarRelatoriosDiarios(db,{},transporte);
  assert.deepEqual(db.prepare('SELECT * FROM daily_report_deliveries').all(),[item]);
});
