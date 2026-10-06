import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepararRestauracao } from '../scripts/restauracao-segura.mjs';

for (const falha of [null, 'email_notifications', 'daily_report_deliveries']) {
  void test(`restauracao prepara ambas as filas sem tocar origem/alvo: ${falha || 'sucesso'}`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-restauracao-'));
    const origem = path.join(dir, 'origem.sqlite'), temporario = path.join(dir, 'novo.sqlite');
    const db = new DatabaseSync(origem);
    for (const tabela of ['email_notifications', 'daily_report_deliveries']) {
      db.exec(`CREATE TABLE ${tabela}(id TEXT,status TEXT,locked_at TEXT,last_error TEXT,updated_at TEXT);
        INSERT INTO ${tabela} VALUES ('a','pending',NULL,NULL,'x')`);
    }
    if (falha) db.exec(`CREATE TRIGGER recusar BEFORE UPDATE ON ${falha} BEGIN SELECT RAISE(ABORT,'falha injetada'); END`);
    db.close();
    const antes = fs.readFileSync(origem);
    try {
      if (falha) {
        assert.throws(() => prepararRestauracao(origem, temporario, () => ({})), /falha injetada/);
        assert.equal(fs.existsSync(temporario), false);
      } else {
        assert.equal(prepararRestauracao(origem, temporario, () => ({})).marcados, 2);
        const copia = new DatabaseSync(temporario, { readOnly: true });
        try {
          for (const tabela of ['email_notifications', 'daily_report_deliveries']) assert.equal(copia.prepare(`SELECT status FROM ${tabela}`).get().status, 'failed');
        } finally { copia.close(); }
      }
      assert.deepEqual(fs.readFileSync(origem), antes);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
