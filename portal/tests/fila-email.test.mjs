import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { concluir, falhar, prepararRelatoriosDiarios, reservar } from '../scripts/processar-emails.mjs';

function comBanco(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-fila-email-'));
  const db = new DatabaseSync(path.join(dir, 'fila.sqlite'));
  db.exec(`CREATE TABLE email_notifications (id TEXT PRIMARY KEY, status TEXT, attempts INTEGER, next_attempt_at TEXT, locked_at TEXT, sent_at TEXT, last_error TEXT, created_at TEXT, updated_at TEXT, dedupe_key TEXT UNIQUE);
    INSERT INTO email_notifications VALUES ('um','pending',0,'2000-01-01T00:00:00.000Z',NULL,NULL,NULL,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z','evento:um');`);
  try { fn(db); } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}

void test('reserva uma mensagem uma vez e incrementa a tentativa', () => comBanco((db) => {
  const primeira = reservar(db);
  assert.equal(primeira.length, 1);
  assert.equal(primeira[0].attempts, 1);
  assert.equal(reservar(db).length, 0);
}));

void test('confirmacao marca como enviada e limpa a trava', () => comBanco((db) => {
  const item = reservar(db)[0];
  concluir(db, item);
  const registro = db.prepare('SELECT status,sent_at,locked_at FROM email_notifications WHERE id=?').get('um');
  assert.equal(registro.status, 'sent');
  assert.ok(registro.sent_at);
  assert.equal(registro.locked_at, null);
}));

void test('falha agenda nova tentativa e a quinta falha encerra', () => comBanco((db) => {
  let item = reservar(db)[0];
  falhar(db, item, new Error('SMTP indisponível'));
  let registro = db.prepare('SELECT * FROM email_notifications WHERE id=?').get('um');
  assert.equal(registro.status, 'pending');
  assert.match(registro.last_error, /SMTP indisponível/);
  db.prepare("UPDATE email_notifications SET attempts=4,next_attempt_at='2000-01-01T00:00:00.000Z'").run();
  item = reservar(db)[0];
  falhar(db, item, new Error('continua fora'));
  registro = db.prepare('SELECT * FROM email_notifications WHERE id=?').get('um');
  assert.equal(registro.status, 'failed');
  assert.equal(registro.attempts, 5);
}));

void test('trava abandonada volta para a fila', () => comBanco((db) => {
  db.prepare("UPDATE email_notifications SET status='processing',locked_at='2000-01-01T00:00:00.000Z'").run();
  assert.equal(reservar(db).length, 1);
}));

void test('chave de deduplicacao impede duas copias', () => comBanco((db) => {
  assert.throws(() => db.prepare("INSERT INTO email_notifications VALUES ('dois','pending',0,'2000-01-01',NULL,NULL,NULL,'2026-01-01','2026-01-01','evento:um')").run(), /UNIQUE/);
}));

void test('relatório diário respeita horário e não duplica o envio do dia',()=>comBanco((db)=>{
  db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY,active INTEGER,daily_report_enabled INTEGER,daily_report_time TEXT);
    INSERT INTO users VALUES ('u1',1,1,'17:45');
    CREATE TABLE daily_report_deliveries (id TEXT PRIMARY KEY,user_id TEXT,report_date TEXT,status TEXT,attempts INTEGER,next_attempt_at TEXT,locked_at TEXT,sent_at TEXT,last_error TEXT,created_at TEXT,updated_at TEXT,UNIQUE(user_id,report_date));`);
  prepararRelatoriosDiarios(db,new Date('2026-09-09T20:44:00.000Z'));
  assert.equal(db.prepare('SELECT COUNT(*) total FROM daily_report_deliveries').get().total,0);
  prepararRelatoriosDiarios(db,new Date('2026-09-09T20:45:00.000Z'));
  prepararRelatoriosDiarios(db,new Date('2026-09-09T21:00:00.000Z'));
  const registro=db.prepare('SELECT report_date,status FROM daily_report_deliveries').get();
  assert.equal(registro.report_date,'2026-09-09');
  assert.equal(registro.status,'pending');
}));
