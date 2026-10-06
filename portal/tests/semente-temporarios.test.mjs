import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

void test('semente apaga credenciais temporarias no sucesso e na falha', { skip: process.platform !== 'win32' }, () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sv-semente-teste-'));
  const root=path.resolve(import.meta.dirname,'../..'), privado=path.join(dir,'privado');
  try {
    for(const nome of ['comum','portal/configuracao','alertas/config','alertas/parametros']) {
      const pasta=path.join(privado,nome);fs.mkdirSync(pasta,{recursive:true});
      fs.writeFileSync(path.join(pasta,nome==='comum'?'smtp.env':nome==='portal/configuracao'?'portal.env':'ficticio.txt'),'ficticio');
    }
    const d1=path.join(privado,'portal/banco/estado/state/v3/d1/miniflare-D1DatabaseObject');fs.mkdirSync(d1,{recursive:true});
    const banco=path.join(d1,'fixture.sqlite'),db=new DatabaseSync(banco);
    for(const [,ddl] of fs.readFileSync(path.join(root,'portal/lib/database.ts'),'utf8').matchAll(/`(CREATE TABLE IF NOT EXISTS [^`]+)`/g))db.exec(ddl);
    db.close();
    // Nao herdar o caminho de modulos do PowerShell 7 em Windows PowerShell 5.
    const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>k.toLowerCase()!=='psmodulepath'));
    const executar=()=>execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/preparar-semente.ps1'),'-Destino',dir],{cwd:root,env:{...env,TEMP:dir,SUPPLY_VISION_PRIVADO:privado},stdio:'pipe'});
    executar();
    assert.equal(fs.readdirSync(dir).some(n=>n.startsWith('semente-')),false);
    for(const n of fs.readdirSync(dir).filter(n=>n.endsWith('.zip')))fs.rmSync(path.join(dir,n));
    fs.rmSync(banco);
    assert.throws(executar);
    assert.equal(fs.readdirSync(dir).some(n=>n.startsWith('semente-')||n.endsWith('.zip')),false);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
