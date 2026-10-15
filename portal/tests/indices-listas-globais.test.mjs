import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_RELATORIOS } from '../lib/relatorios.ts';
import { INDICES_LISTAS_GLOBAIS_SQL, migrarIndicesListasGlobais } from '../lib/operacao-dados.ts';

const fonte = fs.readFileSync(new URL('../lib/database.ts', import.meta.url), 'utf8');
const rota = fs.readFileSync(new URL('../lib/importacoes-api.ts', import.meta.url), 'utf8');
const relatorios = fs.readFileSync(new URL('../lib/relatorios-api.ts', import.meta.url), 'utf8');
// Executa as consultas REAIS das listas, com JOINs, projecoes e LIMIT originais.
const consultas = [
  rota.match(/async function importList\(\).*?all\(`([^`]+)`\)/)[1],
  relatorios.match(/`(SELECT j\.id,[^`]+LIMIT 100)`/)[1],
];
function banco() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for (const [, ddl] of fonte.matchAll(/`(CREATE (?:TABLE|(?:UNIQUE )?INDEX) IF NOT EXISTS [^`]+)`/g)) db.exec(ddl);
  for (const ddl of SCHEMA_RELATORIOS) db.exec(ddl);
  for (let v=1;v<=6;v++) db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(v,'antes');
  db.prepare('INSERT INTO users(id,name,email,password_salt,password_hash,role,created_at) VALUES(?,?,?,?,?,?,?)')
    .run('u','Pessoa','pessoa@example.com','salt','hash','admin','2026-01-01');
  for (let i=205;i>=1;i--) {
    const id=String(i).padStart(4,'0'), data=new Date(Date.UTC(2026,0,1)+i*1000).toISOString();
    db.prepare('INSERT INTO imports(id,filename,mode,status,created_by,created_at) VALUES(?,?,?,?,?,?)').run(id,'ficticio.xlsx','agreement','completed','u',data);
    db.prepare('INSERT INTO report_jobs(id,request_key,action,created_by,created_at) VALUES(?,?,?,?,?)').run(id,id,'recorte','u',data);
  }
  return db;
}
function d1(db, falhar=false) {
  return {
    prepare(sql) {
      let valores=[];
      return { bind(...args){valores=args;return this;},async first(){return db.prepare(sql).get(...valores);},executar(){return db.prepare(sql).run(...valores);} };
    },
    async batch(comandos) {
      db.exec('BEGIN');
      try { for (let i=0;i<comandos.length;i++){comandos[i].executar();if(falhar&&i===0)throw new Error('interrupcao');} db.exec('COMMIT'); }
      catch(erro){db.exec('ROLLBACK');throw erro;}
    },
  };
}
const plano = (db,sql) => db.prepare('EXPLAIN QUERY PLAN '+sql).all().map(r=>r.detail).join('\n');
void test('migracao 7 preserva banco existente e os 100 mais recentes, eliminando ordenacao temporaria',async()=>{
  const db=banco();
  try {
    const dados=['users','imports','report_jobs'].map(t=>db.prepare(`SELECT * FROM ${t} ORDER BY id`).all());
    const listas=consultas.map(sql=>db.prepare(sql).all());
    for(const sql of consultas)assert.match(plano(db,sql),/USE TEMP B-TREE FOR ORDER BY/);
    // Tambem aceita uma primeira tentativa com um indice ja criado.
    db.exec(INDICES_LISTAS_GLOBAIS_SQL[0]);
    await migrarIndicesListasGlobais(d1(db),'2026-10-13T12:00:00Z');
    for(let i=0;i<consultas.length;i++) {
      assert.doesNotMatch(plano(db,consultas[i]),/USE TEMP B-TREE FOR ORDER BY/);
      const rows=db.prepare(consultas[i]).all();
      assert.deepEqual(rows,listas[i]);
      assert.equal(rows.length,100);assert.equal(rows[0].id,'0205');assert.equal(rows.at(-1).id,'0106');
    }
    assert.deepEqual(['users','imports','report_jobs'].map(t=>db.prepare(`SELECT * FROM ${t} ORDER BY id`).all()),dados);
    await migrarIndicesListasGlobais(d1(db),'depois');
    assert.deepEqual(db.prepare('SELECT version,applied_at FROM schema_migrations ORDER BY version').all().map(r=>[r.version,r.applied_at]),[...Array.from({length:6},(_,i)=>[i+1,'antes']),[7,'2026-10-13T12:00:00Z']]);
  }finally{db.close();}
});
void test('interrupcao desfaz indices e marcador; retomada completa os dois indices',async()=>{
  const db=banco();
  try {
    await assert.rejects(migrarIndicesListasGlobais(d1(db,true),'primeira'),/interrupcao/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM schema_migrations WHERE version=7').get().n,0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE name LIKE '%created_global'").get().n,0);
    await migrarIndicesListasGlobais(d1(db),'segunda');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE name LIKE '%created_global'").get().n,2);
    for(const sql of consultas)assert.doesNotMatch(plano(db,sql),/USE TEMP B-TREE FOR ORDER BY/);
  }finally{db.close();}
});
