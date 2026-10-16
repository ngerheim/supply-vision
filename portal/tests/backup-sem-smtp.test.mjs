import { destinoBanco } from '../scripts/banco-local.mjs';
import { criarTemporarioTeste } from './apoio/ambiente.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { reservarPortaLoopback } from '../scripts/porta-teste.mjs';

for (const rede of [true, false]) void test(`backup sem SMTP ${rede ? 'replica na rede' : 'não declara redundância'}`, async (t) => {
  const dir=criarTemporarioTeste('backup-sem-smtp-');
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const arquivo=destinoBanco('a.sqlite',path.join(dir,'portal'));
  fs.mkdirSync(path.dirname(arquivo),{recursive:true});
  const db=new DatabaseSync(arquivo);
  db.exec("CREATE TABLE teste(valor TEXT); INSERT INTO teste VALUES('original')");db.close();
  const pastaRede=path.join(dir,'rede'), config=path.join(dir,'portal/configuracao');
  fs.mkdirSync(config,{recursive:true});
  fs.writeFileSync(path.join(config,'portal.env'),`PORTAL_PORTA=${await reservarPortaLoopback()}\nRELATORIOS_PORTA=${await reservarPortaLoopback()}\n`+(rede?`BACKUP_NETWORK_DIR=${pastaRede}\n`:''));
  const resultado=spawnSync(process.execPath,['--experimental-strip-types','scripts/backup.mjs'],{
    cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,MODO_ENSAIO:'0',SUPPLY_VISION_PRIVADO:dir},encoding:'utf8',
  });
  assert.equal(resultado.status,rede?0:1,resultado.stderr);
  assert.ok(fs.existsSync(path.join(dir,'portal/backups/portal-atual.sqlite')));
  if(rede){
    assert.match(resultado.stderr,/comprovante não enviado/);
    const copia=new DatabaseSync(path.join(pastaRede,'portal-atual.sqlite'),{readOnly:true});
    try { assert.equal(copia.prepare('SELECT valor FROM teste').get().valor,'original'); }
    finally { copia.close(); }
    assert.equal(fs.readdirSync(path.join(pastaRede,'historico')).length,1);
  }
});

void test('CONCLUIR replica snapshot anterior mesmo se backup diario substituir portal-atual', async (t) => {
  const dir = criarTemporarioTeste('backup-snapshot-h1-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const backups = path.join(dir, 'portal/backups');
  const config = path.join(dir, 'portal/configuracao');
  const rede = path.join(dir, 'rede');
  fs.mkdirSync(backups, { recursive: true });
  fs.mkdirSync(config, { recursive: true });
  fs.writeFileSync(path.join(config, 'portal.env'), `PORTAL_PORTA=${await reservarPortaLoopback()}\nRELATORIOS_PORTA=${await reservarPortaLoopback()}\nBACKUP_NETWORK_DIR=${rede}\n`);
  for (const [nome, versao] of [['pre-atualizacao', 'anterior'], ['portal-atual', 'diario-novo']]) {
    const db = new DatabaseSync(path.join(backups, `${nome}.sqlite`));
    try { db.exec('CREATE TABLE teste(valor TEXT)'); db.prepare('INSERT INTO teste VALUES(?)').run(versao); }
    finally { db.close(); }
  }
  const resultado = spawnSync(process.execPath, [
    '--experimental-strip-types', 'scripts/backup.mjs', '--pre-atualizacao', '--somente-rede', '--snapshot-pre-atualizacao',
  ], { cwd: path.resolve(import.meta.dirname, '..'), env: { ...process.env, MODO_ENSAIO: '0', SUPPLY_VISION_PRIVADO: dir }, encoding: 'utf8' });
  assert.equal(resultado.status, 0, resultado.stderr);
  const copia = new DatabaseSync(path.join(rede, 'portal-atual.sqlite'), { readOnly: true });
  try { assert.equal(copia.prepare('SELECT valor FROM teste').get().valor, 'anterior'); }
  finally { copia.close(); }
  const atual = new DatabaseSync(path.join(backups, 'portal-atual.sqlite'), { readOnly: true });
  try { assert.equal(atual.prepare('SELECT valor FROM teste').get().valor, 'diario-novo'); }
  finally { atual.close(); }
});
