import './apoio/logs-email.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { prepararRelatoriosDiarios, processarRelatoriosDiarios } from '../scripts/processar-emails.mjs';

void test('preparacao congela conteudo e migra entrega legada uma unica vez', () => {
  const db = new DatabaseSync(':memory:');
  try {
    for (const [, ddl] of fs.readFileSync(new URL('../lib/database.ts', import.meta.url), 'utf8').matchAll(/`(CREATE TABLE IF NOT EXISTS [^`]+)`/g)) db.exec(ddl);
    db.exec("ALTER TABLE users ADD COLUMN daily_report_enabled INTEGER DEFAULT 0; ALTER TABLE users ADD COLUMN daily_report_time TEXT DEFAULT '17:00'");
    db.exec(`INSERT INTO users(id,name,email,password_salt,password_hash,created_at,role,daily_report_enabled,daily_report_time) VALUES('u','Fixture','u@example.com','s','h','x','admin',1,'00:00');
      INSERT INTO tickets(id,code,supplier_name,status,created_at,updated_at) VALUES('t','SUP-1','Antes','aberto','2026-10-20T10:00:00Z','2026-10-20T10:00:00Z');
      INSERT INTO daily_report_deliveries(id,user_id,report_date,next_attempt_at,created_at,updated_at) VALUES('legado','u','2026-10-19','x','2026-10-19T20:00:00Z','x');`);
    prepararRelatoriosDiarios(db, new Date('2026-10-20T20:00:00Z'));
    const antes = db.prepare('SELECT id,payload_json FROM daily_report_deliveries ORDER BY id').all();
    assert.equal(antes.length, 2);
    assert.equal(JSON.parse(antes.find(d => d.id !== 'legado').payload_json).chamados[0].fornecedor, 'Antes');
    db.exec("UPDATE tickets SET supplier_name='Depois',status='fechado'");
    prepararRelatoriosDiarios(db, new Date('2026-10-20T21:00:00Z'));
    assert.deepEqual(db.prepare('SELECT id,payload_json FROM daily_report_deliveries ORDER BY id').all(), antes);
    assert.ok(JSON.parse(antes.find(d => d.id === 'legado').payload_json).periodo.fim);
  } finally { db.close(); }
});

void test('retentativa SMTP reutiliza assunto, texto e HTML depois de alterar chamados', async t => {
  const db = new DatabaseSync(':memory:'), ensaio = process.env.MODO_ENSAIO;
  process.env.MODO_ENSAIO = '0'; // Transporte em memoria, sem conectar SMTP.
  t.after(() => { db.close(); if (ensaio === undefined) delete process.env.MODO_ENSAIO; else process.env.MODO_ENSAIO = ensaio; });
  for (const [, ddl] of fs.readFileSync(new URL('../lib/database.ts', import.meta.url), 'utf8').matchAll(/`(CREATE TABLE IF NOT EXISTS [^`]+)`/g)) db.exec(ddl);
  db.exec("ALTER TABLE users ADD COLUMN daily_report_enabled INTEGER DEFAULT 0; ALTER TABLE users ADD COLUMN daily_report_time TEXT DEFAULT '00:00'");
  db.exec("INSERT INTO users(id,name,email,password_salt,password_hash,created_at,role,daily_report_enabled) VALUES('u','Fixture','u@example.com','s','h','x','admin',1)");
  const agora = new Date(Date.now() - 1000).toISOString();
  db.prepare("INSERT INTO tickets(id,code,supplier_name,status,created_at,updated_at) VALUES('t','SUP-1','Antes','aberto',?,?)").run(agora, agora);
  const tentativas = [], transporte = { async sendMail(email) {
    tentativas.push(email);
    if (tentativas.length === 1) throw Object.assign(new Error('fixture sem conexao'), { code: 'ECONNECTION', command: 'CONN' });
  } };
  const config = { PORTAL_URL: 'http://fixture', SMTP_USER: 'fixture@example.com', EMAIL_FROM_NAME: 'Fixture' };
  await processarRelatoriosDiarios(db, config, transporte);
  assert.equal(tentativas.length, 1);
  db.exec("UPDATE tickets SET supplier_name='Depois',status='fechado'; UPDATE daily_report_deliveries SET next_attempt_at='2000-01-01'");
  await processarRelatoriosDiarios(db, config, transporte);
  assert.equal(tentativas.length, 2);
  assert.deepEqual(tentativas[1], tentativas[0]);
  assert.equal(db.prepare('SELECT status FROM daily_report_deliveries').get().status, 'sent');
});
