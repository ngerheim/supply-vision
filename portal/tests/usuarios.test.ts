import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { ATUALIZAR_USUARIO_SQL, ATUALIZAR_USUARIO_COM_SENHA_SQL, ENCERRAR_SESSOES_REDEFINIDAS_SQL, ENCERRAR_SESSOES_ALTERADAS_SQL } from '../lib/usuarios-sql.ts';

function banco() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,role TEXT,active INTEGER,daily_report_enabled INTEGER,daily_report_time TEXT,password_salt TEXT,password_hash TEXT,password_iterations INTEGER,revision INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE sessions(token TEXT,user_id TEXT);
    INSERT INTO users(id,name,role,active,daily_report_enabled,daily_report_time,password_salt,password_hash) VALUES ('a','A','admin',1,0,'17:45','sa','ha'),('b','B','admin',1,0,'17:45','sb','hb');
    INSERT INTO sessions VALUES ('ta','a'),('tb','b');`);
  return db;
}

for (const [role, active] of [['admin', 0], ['viewer', 1]] as const) {
  void test(`escritas concorrentes preservam ultimo administrador (${role}/${active})`, () => {
    const db = banco();
    try {
      const update = db.prepare(ATUALIZAR_USUARIO_SQL);
      assert.equal(update.run('B',role,active,0,'17:45','b',0,role,active).changes,1);
      assert.equal(update.run('A',role,active,0,'17:45','a',0,role,active).changes,0);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1").get()?.n,1);
      assert.equal(db.prepare(ENCERRAR_SESSOES_ALTERADAS_SQL).run('a','a',role,active).changes,0);
    } finally { db.close(); }
  });
}

void test('formulario antigo nao restaura privilegios nem encerra sessoes por coincidencia de valores', () => {
  const db = banco();
  try {
    const update=db.prepare(ATUALIZAR_USUARIO_SQL), encerrar=db.prepare(ENCERRAR_SESSOES_ALTERADAS_SQL);
    update.run('B','viewer',1,0,'17:45','b',0,'viewer',1);
    assert.equal(encerrar.run('b','b','viewer',1).changes,1);
    db.exec("INSERT INTO sessions VALUES('nova','b')");
    assert.equal(update.run('Antigo','admin',1,1,'18:00','b',0,'admin',1).changes,0);
    assert.equal(encerrar.run('b','b','viewer',1).changes,0);
    const row=db.prepare("SELECT role,name,revision FROM users WHERE id='b'").get();
    assert.equal(row?.role,'viewer');assert.equal(row?.name,'B');assert.equal(row?.revision,1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sessions WHERE user_id='b'").get()?.n,1);
  } finally { db.close(); }
});

void test('senha e cadastro revertem juntos se encerramento falha; revisao antiga nao redefine senha', () => {
  const db=banco();
  try {
    const update=db.prepare(ATUALIZAR_USUARIO_COM_SENHA_SQL), close=db.prepare(ENCERRAR_SESSOES_REDEFINIDAS_SQL);
    db.exec("CREATE TRIGGER impedir BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT,'falha sintetica'); END; BEGIN");
    update.run('Novo','admin',1,0,'18:00','sn','hn',600000,'a',0,'admin',1);
    assert.throws(()=>close.run('a','a','sn'),/falha sintetica/);db.exec('ROLLBACK');
    assert.equal(db.prepare("SELECT password_hash FROM users WHERE id='a'").get()?.password_hash,'ha');
    db.exec('DROP TRIGGER impedir; BEGIN');
    update.run('Novo','admin',1,0,'18:00','sn','hn',600000,'a',0,'admin',1);
    close.run('a','a','sn');db.exec('COMMIT');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sessions WHERE user_id='a'").get()?.n,0);
    db.exec("INSERT INTO sessions VALUES ('nova','a')");
    assert.equal(update.run('Antigo','admin',1,0,'18:00','sn','hn',600000,'a',0,'admin',1).changes,0);
    assert.equal(close.run('a','a','sn').changes,0);
  } finally { db.close(); }
});
