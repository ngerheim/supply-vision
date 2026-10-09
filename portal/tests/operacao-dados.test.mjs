import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { configurarExpurgo, executarExpurgo, expurgar } from '../scripts/expurgar-dados.mjs';
import { CRIAR_CONTADOR_CHAMADOS_SQL, MIGRAR_CONTADOR_CHAMADOS_SQL, RESERVAR_CODIGO_CHAMADO_SQL, filtroChamados, joinContagemHistorico } from '../lib/operacao-dados.ts';
import { IpConcurrencyGate, KeyedConcurrencyGate } from '../lib/concurrency.ts';
const agora = new Date('2026-10-09T12:00:00Z');
const dias = n => new Date(agora.getTime() - n * 86400_000).toISOString();
function banco(arquivo = ':memory:') {
  const db = new DatabaseSync(arquivo);
  db.exec(`CREATE TABLE email_notifications(id TEXT,status TEXT,updated_at TEXT);
    CREATE TABLE daily_report_deliveries(id TEXT,status TEXT,updated_at TEXT);
    CREATE TABLE report_jobs(id TEXT,status TEXT,completed_at TEXT);
    CREATE TABLE imports(id TEXT,status TEXT,completed_at TEXT,summary_json TEXT);
    CREATE TABLE audit_logs(id TEXT); INSERT INTO audit_logs VALUES('preservar');
    CREATE TABLE ticket_events(id TEXT); INSERT INTO ticket_events VALUES('preservar')`);
  for (const tabela of ['email_notifications', 'daily_report_deliveries']) {
    for (const [id, status, tempo] of [['velho','sent',dias(181)],['falha','failed',dias(181)],['limite','sent',dias(180)],['novo','sent',dias(179)],['pendente','pending',dias(181)],['ativo','processing',dias(181)]]) db.prepare(`INSERT INTO ${tabela} VALUES(?,?,?)`).run(id,status,tempo);
  }
  for (const [id, status, tempo] of [['velho','done',dias(91)],['limite','done',dias(90)],['ativo','running',dias(91)],['revisao','review',dias(91)]]) db.prepare('INSERT INTO report_jobs VALUES(?,?,?)').run(id,status,tempo);
  for (const [id, status, tempo] of [['velho','completed',dias(181)],['limite','completed',dias(180)],['ativo','processing',dias(181)]]) db.prepare('INSERT INTO imports VALUES(?,?,?,?)').run(id,status,tempo,'{"resumo":1}');
  return db;
}
void test('expurgo: limites exatos e preservacao de pendentes, auditoria e eventos', () => {
  const db = banco();
  try {
    assert.deepEqual(expurgar(db, configurarExpurgo({}), agora), {});
    assert.deepEqual(expurgar(db, configurarExpurgo({ EXPURGO_HABILITADO:'1' }), agora), { email_notifications:2, daily_report_deliveries:2, report_jobs:1, imports:1 });
    for (const tabela of ['email_notifications','daily_report_deliveries']) assert.deepEqual(db.prepare(`SELECT id FROM ${tabela} ORDER BY id`).all().map(r=>r.id), ['ativo','limite','novo','pendente']);
    assert.equal(db.prepare("SELECT summary_json FROM imports WHERE id='velho'").get().summary_json, null);
    assert.equal(db.prepare("SELECT summary_json FROM imports WHERE id='limite'").get().summary_json, '{"resumo":1}');
    for (const tabela of ['audit_logs','ticket_events']) assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${tabela}`).get().n, 1);
  } finally { db.close(); }
});
void test('prazo zero preserva tipo; configuracao invalida bloqueia', () => {
  const db = banco();
  try { assert.deepEqual(expurgar(db, configurarExpurgo({EXPURGO_HABILITADO:'1',EXPURGO_EMAILS_DIAS:'0',EXPURGO_RELATORIOS_DIAS:'0',EXPURGO_IMPORTACOES_DIAS:'0'}), agora), {}); }
  finally { db.close(); }
  for (const valor of ['-1','1.5','invalido']) assert.throws(()=>configurarExpurgo({EXPURGO_EMAILS_DIAS:valor}));
});
void test('backup antes do primeiro expurgo e trava compartilhada; falha nao exclui', async t => {
  const pasta = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'sv-expurgo-'));
  t.after(()=>fs.rmSync(pasta,{recursive:true,force:true}));
  const arquivo=path.join(pasta,'banco.sqlite');banco(arquivo).close();
  const opcoes={config:{EXPURGO_HABILITADO:'1'},arquivo,pasta,agora};
  await assert.rejects(executarExpurgo({...opcoes,backup(){throw new Error('copia falhou');}}),/copia falhou/);
  let db=new DatabaseSync(arquivo);assert.equal(db.prepare('SELECT COUNT(*) n FROM email_notifications').get().n,6);db.close();
  const lock=new DatabaseSync(path.join(pasta,'backup.lock.sqlite'));lock.exec('BEGIN EXCLUSIVE');
  await assert.rejects(executarExpurgo({...opcoes,backup(){assert.fail('nao ultrapassa trava');}}));lock.close();
  await executarExpurgo({...opcoes,backup(origem){fs.copyFileSync(origem,path.join(pasta,'portal-atual.sqlite'));}});
  db=new DatabaseSync(path.join(pasta,'pre-expurgo.sqlite'));assert.equal(db.prepare('SELECT COUNT(*) n FROM email_notifications').get().n,6);db.close();
});
void test('contador migra existentes uma vez e reserva numeros sem varrer chamados', () => {
  const db=new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE tickets(code TEXT); INSERT INTO tickets VALUES('SUP-0001'),('SUP-0042');");db.exec(CRIAR_CONTADOR_CHAMADOS_SQL);db.exec(MIGRAR_CONTADOR_CHAMADOS_SQL);
    assert.equal(db.prepare(RESERVAR_CODIGO_CHAMADO_SQL).get().value,43);
    db.exec(MIGRAR_CONTADOR_CHAMADOS_SQL);assert.equal(db.prepare(RESERVAR_CODIGO_CHAMADO_SQL).get().value,44);
    assert.ok(!RESERVAR_CODIGO_CHAMADO_SQL.includes('tickets'));
  }finally{db.close();}
});
void test('busca e situacao filtram antes da paginacao; contagem historico usa users somente com busca', () => {
  const db=new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE tickets(id TEXT,code TEXT,supplier_name TEXT,city TEXT,state TEXT,status TEXT,updated_at TEXT);CREATE INDEX idx_updated ON tickets(updated_at DESC,id DESC)');
    for(let i=0;i<125;i++)db.prepare('INSERT INTO tickets VALUES(?,?,?,?,?,?,?)').run(String(i),`SUP-${i}`,'Fornecedor',null,null,i<120?'aberto':'fechado',String(i).padStart(3,'0'));
    const {where,values}=filtroChamados(new URLSearchParams('group=ativos&q=Fornecedor'));
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM tickets t ${where}`).get(...values).n,120);
    assert.equal(db.prepare(`SELECT id FROM tickets t ${where} ORDER BY updated_at DESC,id DESC LIMIT 50 OFFSET 100`).all(...values).length,20);
    assert.equal(joinContagemHistorico(null),'');assert.match(joinContagemHistorico('busca'),/JOIN users/);
  }finally{db.close();}
});
void test('um IP com varios emails nao esgota a fila global e vagas sao liberadas', async () => {
  const ip=new IpConcurrencyGate(2), global=new KeyedConcurrencyGate(4,16), releases=[];
  for(const email of ['a','b']){const ri=ip.acquire('cliente-a');assert.ok(ri);const rg=await global.acquire(email);assert.ok(rg);releases.push(()=>{rg();ri();});}
  for(const email of ['c','d','e','f']){assert.equal(ip.acquire('cliente-a'),null,email);}
  const outro=ip.acquire('cliente-b');assert.ok(outro);const livre=await global.acquire('outro');assert.ok(livre);livre();outro();
  releases.forEach(r=>{r();r();});assert.ok(ip.acquire('cliente-a'));
});
