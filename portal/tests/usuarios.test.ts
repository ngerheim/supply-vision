import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { ATUALIZAR_USUARIO_SQL } from '../lib/usuarios-sql.ts';

for (const [role, active] of [['admin', 0], ['viewer', 1]] as const) {
  void test(`escritas baseadas no mesmo snapshot preservam um administrador (${role}/${active})`, () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, role TEXT, active INTEGER, daily_report_enabled INTEGER, daily_report_time TEXT);
        INSERT INTO users (id,role,active) VALUES ('a','admin',1),('b','admin',1)`);
      // Ambas as requisições já leram os dois administradores ativos.
      const snapshot = db.prepare("SELECT id FROM users WHERE role='admin' AND active=1").all();
      assert.equal(snapshot.length, 2);
      const update = db.prepare(ATUALIZAR_USUARIO_SQL);
      assert.equal(update.run('B', role, active, 0, '17:45', 'b', role, active).changes, 1);
      assert.equal(update.run('A', role, active, 0, '17:45', 'a', role, active).changes, 0);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1").get()?.n, 1);
      assert.equal(update.run('Novo nome', 'admin', 1, 1, '18:00', 'a', 'admin', 1).changes, 1);
      assert.equal(update.run('B', 'viewer', 0, 0, '17:45', 'b', 'viewer', 0).changes, 1);
    } finally { db.close(); }
  });
}
