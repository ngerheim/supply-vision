import { criarTemporarioTeste } from './apoio/ambiente.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

for (const rede of [true, false]) void test(`backup sem SMTP ${rede ? 'replica na rede' : 'não declara redundância'}`, (t) => {
  const dir=criarTemporarioTeste('backup-sem-smtp-');
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const arquivo=path.join(dir,'portal/banco/estado/state/v3/d1/miniflare-D1DatabaseObject/a.sqlite');
  fs.mkdirSync(path.dirname(arquivo),{recursive:true});
  const db=new DatabaseSync(arquivo);
  db.exec("CREATE TABLE teste(valor TEXT); INSERT INTO teste VALUES('original')");db.close();
  const pastaRede=path.join(dir,'rede'), config=path.join(dir,'portal/configuracao');
  fs.mkdirSync(config,{recursive:true});
  fs.writeFileSync(path.join(config,'portal.env'),rede?`BACKUP_NETWORK_DIR=${pastaRede}\n`:'');
  const resultado=spawnSync(process.execPath,['--experimental-strip-types','scripts/backup.mjs'],{
    cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,SUPPLY_VISION_PRIVADO:dir},encoding:'utf8',
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
