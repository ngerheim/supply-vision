// Filas ociosas nao abrem transacao de escrita. O banco e o mesmo arquivo do
// portal (miniflare/D1), que nao espera lock: cada BEGIN IMMEDIATE externo sem
// necessidade era uma chance de o portal responder 500 a um usuario.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_RELATORIOS } from '../lib/relatorios.ts';
import { reservar, reservarRelatoriosDiarios } from '../scripts/processar-emails.mjs';
import { reservarRelatorio } from '../scripts/processar-relatorios.mjs';

function comBanco(sql, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-filas-ociosas-'));
  const db = new DatabaseSync(path.join(dir, 'banco.sqlite'));
  db.exec(sql);
  const escritas = [];
  const exec = db.exec.bind(db);
  db.exec = (comando) => { if (/BEGIN/i.test(comando)) escritas.push(comando); return exec(comando); };
  try { fn(db, escritas); } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}

const EMAILS = `CREATE TABLE email_notifications (id TEXT PRIMARY KEY, status TEXT, attempts INTEGER, next_attempt_at TEXT, locked_at TEXT, sent_at TEXT, last_error TEXT, created_at TEXT, updated_at TEXT, dedupe_key TEXT UNIQUE);`;
const DIARIOS = `CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, active INTEGER, daily_report_enabled INTEGER);
  CREATE TABLE daily_report_deliveries (id TEXT PRIMARY KEY, user_id TEXT, report_date TEXT, status TEXT, attempts INTEGER, next_attempt_at TEXT, locked_at TEXT, sent_at TEXT, last_error TEXT, created_at TEXT, updated_at TEXT);`;

void test('fila de e-mails vazia ou ja enviada nao abre escrita', () => comBanco(EMAILS + `
  INSERT INTO email_notifications VALUES ('ok','sent',1,'2000-01-01T00:00:00.000Z',NULL,'2000-01-01T00:00:00.000Z',NULL,'2000-01-01T00:00:00.000Z','2000-01-01T00:00:00.000Z','a');
  INSERT INTO email_notifications VALUES ('futuro','pending',1,'2999-01-01T00:00:00.000Z',NULL,NULL,NULL,'2000-01-01T00:00:00.000Z','2000-01-01T00:00:00.000Z','b');`, (db, escritas) => {
  assert.deepEqual(reservar(db), []);
  assert.deepEqual(escritas, []);
}));

void test('e-mail pendente ou trava vencida ainda abrem a escrita', () => comBanco(EMAILS + `
  INSERT INTO email_notifications VALUES ('preso','processing',1,'2000-01-01T00:00:00.000Z','2000-01-01T00:00:00.000Z',NULL,NULL,'2000-01-01T00:00:00.000Z','2000-01-01T00:00:00.000Z','c');
  INSERT INTO email_notifications VALUES ('novo','pending',0,'2000-01-01T00:00:00.000Z',NULL,NULL,NULL,'2000-01-01T00:00:00.000Z','2000-01-01T00:00:00.000Z','d');`, (db, escritas) => {
  assert.equal(reservar(db).length, 1);
  assert.equal(escritas.length, 1);
  assert.equal(db.prepare("SELECT status FROM email_notifications WHERE id='preso'").get().status, 'failed');
}));

void test('relatorio diario sem entrega devida nao abre escrita', () => comBanco(DIARIOS + `
  INSERT INTO users VALUES ('u','Ana','ana@exemplo.com',1,1);
  INSERT INTO daily_report_deliveries VALUES ('r','u','2026-10-05','sent',1,'2000-01-01T00:00:00.000Z',NULL,'2026-10-05T20:00:00.000Z',NULL,'2026-10-05T20:00:00.000Z','2026-10-05T20:00:00.000Z');`, (db, escritas) => {
  assert.deepEqual(reservarRelatoriosDiarios(db), []);
  assert.deepEqual(escritas, []);
}));

void test('fila de relatorios sem pedido aguardando nao abre escrita', () => comBanco(SCHEMA_RELATORIOS.join(';'), (db, escritas) => {
  assert.equal(reservarRelatorio(db), null);
  assert.deepEqual(escritas, []);
}));
