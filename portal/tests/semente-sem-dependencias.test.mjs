import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { criarTemporarioTeste } from './apoio/ambiente.mjs';

void test('restaura banco e neutraliza filas sem node_modules nem SMTP', () => {
  const dir = criarTemporarioTeste('sv-semente-limpa-');
  try {
    const scripts = path.join(dir, 'portal/scripts');
    fs.mkdirSync(scripts, { recursive: true });
    for (const nome of ['restaurar-banco-semente', 'restauracao-segura', 'validar-banco', 'filas-restauradas', 'pedidos-interrompidos']) {
      fs.copyFileSync(new URL(`../scripts/${nome}.mjs`, import.meta.url), path.join(scripts, `${nome}.mjs`));
    }
    const origem = path.join(dir, 'origem.sqlite'), destino = path.join(dir, 'destino.sqlite');
    const db = new DatabaseSync(origem);
    for (const [, ddl] of fs.readFileSync(new URL('../lib/database.ts', import.meta.url), 'utf8').matchAll(/`(CREATE TABLE IF NOT EXISTS [^`]+)`/g)) db.exec(ddl);
    db.exec("INSERT INTO users VALUES('u','Ficticio','ficticio@example.com','salt','hash','admin',1,'x'); INSERT INTO tickets(id,code,supplier_name,status,created_at,updated_at) VALUES('t','SUP-1','Ficticio','aberto','x','x'); INSERT INTO email_notifications(id,ticket_id,event_id,type,recipient_name,recipient_email,payload_json,status,next_attempt_at,dedupe_key,created_at,updated_at) VALUES('e','t','v','atribuicao','Ficticio','ficticio@example.com','{}','pending','x','d','x','x')");
    db.exec("CREATE TABLE report_jobs(id TEXT,status TEXT,created_by TEXT,completed_at TEXT,log TEXT); INSERT INTO report_jobs VALUES('r','queued','u',NULL,'')");
    db.close();
    assert.equal(fs.existsSync(path.join(dir, 'portal/node_modules')), false);
    execFileSync(process.execPath, [path.join(scripts, 'restaurar-banco-semente.mjs'), origem, destino], { cwd: dir });
    const restaurado = new DatabaseSync(destino);
    try {
      assert.equal(restaurado.prepare('SELECT status FROM email_notifications').get().status, 'failed');
      assert.equal(restaurado.prepare('SELECT status FROM report_jobs').get().status, 'review');
      assert.equal(restaurado.prepare('SELECT count(*) AS n FROM audit_logs').get().n, 1);
    } finally { restaurado.close(); }
    assert.equal(fs.existsSync(destino + '.restaurando'), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
