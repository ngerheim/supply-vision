import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { ATUALIZAR_USUARIO_SQL, ATUALIZAR_USUARIO_COM_SENHA_SQL, ENCERRAR_SESSOES_REDEFINIDAS_SQL, ENCERRAR_SESSOES_ALTERADAS_SQL } from '../lib/usuarios-sql.ts';

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

void test('redefinição muda cadastro e senha juntos; guarda recusada preserva sessões', () => {
 const db=new DatabaseSync(':memory:');
 try {
  db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,role TEXT,active INTEGER,daily_report_enabled INTEGER,daily_report_time TEXT,password_salt TEXT,password_hash TEXT,password_iterations INTEGER);
    CREATE TABLE sessions(user_id TEXT);
    INSERT INTO users VALUES('a','original','admin',1,0,'17:45','salt-antigo','hash-antigo',1);
    INSERT INTO sessions VALUES('a')`);
  const update=db.prepare(ATUALIZAR_USUARIO_COM_SENHA_SQL),close=db.prepare(ENCERRAR_SESSOES_REDEFINIDAS_SQL);
  db.exec('BEGIN');
  assert.equal(update.run('novo','viewer',0,0,'17:45','salt-novo','hash-novo',600000,'a','viewer',0).changes,0);
  close.run('a','a','salt-novo');db.exec('COMMIT');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get()?.n,1);
  assert.equal(db.prepare('SELECT password_hash FROM users').get()?.password_hash,'hash-antigo');
  db.exec("CREATE TRIGGER impedir_encerramento BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT, 'falha sintetica'); END; BEGIN");
  update.run('novo','admin',1,1,'18:00','salt-novo','hash-novo',600000,'a','admin',1);
  assert.throws(()=>close.run('a','a','salt-novo'));db.exec('ROLLBACK');
  const unchanged=db.prepare('SELECT name,password_hash FROM users').get();
  assert.equal(unchanged?.name,'original');assert.equal(unchanged?.password_hash,'hash-antigo');
  db.exec('DROP TRIGGER impedir_encerramento; BEGIN');
  update.run('novo','admin',1,1,'18:00','salt-novo','hash-novo',600000,'a','admin',1);close.run('a','a','salt-novo');db.exec('COMMIT');
  assert.equal(db.prepare('SELECT name FROM users').get()?.name,'novo');
  assert.equal(db.prepare('SELECT password_hash FROM users').get()?.password_hash,'hash-novo');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get()?.n,0);
 }finally{db.close();}
});

void test('desativar ou trocar perfil encerra sessões só quando a alteração foi gravada', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, role TEXT, active INTEGER, daily_report_enabled INTEGER, daily_report_time TEXT);
      CREATE TABLE sessions (token TEXT, user_id TEXT);
      INSERT INTO users (id,role,active) VALUES ('a','admin',1),('e','editor',1);
      INSERT INTO sessions VALUES ('t1','a'),('t2','e')`);
    const update = db.prepare(ATUALIZAR_USUARIO_SQL), encerrar = db.prepare(ENCERRAR_SESSOES_ALTERADAS_SQL);
    // Último administrador: a guarda recusa e as sessões continuam.
    assert.equal(update.run('A', 'admin', 0, 0, '17:45', 'a', 'admin', 0).changes, 0);
    assert.equal(encerrar.run('a', 'a', 'admin', 0).changes, 0);
    // Rebaixamento gravado: sessões do usuário saem, as dos outros ficam.
    assert.equal(update.run('E', 'viewer', 1, 0, '17:45', 'e', 'viewer', 1).changes, 1);
    assert.equal(encerrar.run('e', 'e', 'viewer', 1).changes, 1);
    assert.deepEqual(db.prepare('SELECT token FROM sessions').all().map(r => r.token), ['t1']);
  } finally { db.close(); }
});
