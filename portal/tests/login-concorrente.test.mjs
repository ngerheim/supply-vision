import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { CRIAR_SESSAO_AUTENTICADA_SQL, MIGRAR_SENHA_AUTENTICADA_SQL } from '../lib/login-sql.ts';

for (const mudanca of [null, 'senha', 'desativacao', 'perfil']) {
  void test(`login protege snapshot: ${mudanca || 'sem mudanca'}`, () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(`CREATE TABLE users(id TEXT,active INTEGER,revision INTEGER,password_salt TEXT,password_hash TEXT,password_iterations INTEGER);
        CREATE TABLE sessions(token TEXT,user_id TEXT,expires_at TEXT,last_seen_at TEXT);
        INSERT INTO users VALUES('u',1,0,'antigo','hash-antigo',120000)`);
      if (mudanca === 'senha') db.exec("UPDATE users SET revision=1,password_salt='novo',password_hash='senha-nova'");
      if (mudanca === 'desativacao') db.exec('UPDATE users SET active=0,revision=1');
      if (mudanca === 'perfil') db.exec('UPDATE users SET revision=1');
      db.exec('BEGIN');
      const inserida = db.prepare(CRIAR_SESSAO_AUTENTICADA_SQL).run('token','futuro','agora','u',0,'antigo','hash-antigo').changes;
      db.prepare(MIGRAR_SENHA_AUTENTICADA_SQL).run('migrado','hash-migrado',600000,'u',0,'antigo','hash-antigo','token');
      db.exec('COMMIT');
      assert.equal(inserida, mudanca ? 0 : 1);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get().n, mudanca ? 0 : 1);
      assert.equal(db.prepare('SELECT password_hash h FROM users').get().h, mudanca === 'senha' ? 'senha-nova' : mudanca ? 'hash-antigo' : 'hash-migrado');
    } finally { db.close(); }
  });
}
