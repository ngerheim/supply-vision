import { criarTemporarioTeste } from './apoio/ambiente.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

void test('semente apaga credenciais temporarias no sucesso e na falha', { skip: process.platform !== 'win32' }, () => {
  const dir=criarTemporarioTeste('sv-semente-teste-');
  const root=path.resolve(import.meta.dirname,'../..'), privado=path.join(dir,'privado');
  try {
    for(const nome of ['comum','portal/configuracao','alertas/config','alertas/parametros']) {
      const pasta=path.join(privado,nome);fs.mkdirSync(pasta,{recursive:true});
      fs.writeFileSync(path.join(pasta,nome==='comum'?'smtp.env':nome==='portal/configuracao'?'portal.env':'ficticio.txt'),'ficticio');
    }
    fs.mkdirSync(path.join(privado,'operacao'),{recursive:true});
    fs.mkdirSync(path.join(privado,'alertas/estado-envios'),{recursive:true});
    const estadoSlots = '{"alertas-2026-10-07-08:00":"ok"}';
    const estadoEntrega = '{"estado":"enviado"}';
    fs.writeFileSync(path.join(privado,'operacao/estado.json'),estadoSlots);
    fs.writeFileSync(path.join(privado,'alertas/estado-envios/slot.json'),estadoEntrega);
    fs.writeFileSync(path.join(privado,'comum/operacao.env'),'ALERTAS_HORARIOS=08:00');
    const d1=path.join(privado,'portal/banco/estado/state/v3/d1/miniflare-D1DatabaseObject');fs.mkdirSync(d1,{recursive:true});
    const banco=path.join(d1,'fixture.sqlite'),db=new DatabaseSync(banco);
    for(const [,ddl] of fs.readFileSync(path.join(root,'portal/lib/database.ts'),'utf8').matchAll(/`(CREATE TABLE IF NOT EXISTS [^`]+)`/g))db.exec(ddl);
    db.exec("INSERT INTO users VALUES('u','Ficticio','ficticio@example.com','salt','hash','admin',1,'x'); INSERT INTO tickets(id,code,supplier_name,status,created_at,updated_at) VALUES('t','SUP-1','Ficticio','aberto','x','x'); INSERT INTO email_notifications(id,ticket_id,event_id,type,recipient_name,recipient_email,payload_json,status,next_attempt_at,dedupe_key,created_at,updated_at) VALUES('e','t','v','atribuicao','Ficticio','ficticio@example.com','{}','pending','x','d','x','x')");
    db.close();
    // Nao herdar o caminho de modulos do PowerShell 7 em Windows PowerShell 5.
    const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>k.toLowerCase()!=='psmodulepath'));
    const executar=()=>execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/preparar-semente.ps1'),'-Destino',dir],{cwd:root,env:{...env,TEMP:dir,SUPPLY_VISION_PRIVADO:privado},stdio:'pipe'});
    executar();
    assert.equal(fs.readdirSync(dir).some(n=>n.startsWith('semente-')),false);
    const zip=path.join(dir,fs.readdirSync(dir).find(n=>n.endsWith('.zip'))), destino=path.join(dir,'restaurado');
    execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/restaurar-semente.ps1'),'-Zip',zip],{cwd:root,env:{...env,TEMP:dir,SUPPLY_VISION_PRIVADO:destino},stdio:'pipe'});
    assert.equal(fs.readFileSync(path.join(destino,'operacao/estado.json'),'utf8'),estadoSlots);
    assert.equal(fs.readFileSync(path.join(destino,'alertas/estado-envios/slot.json'),'utf8'),estadoEntrega);
    const restaurado=new DatabaseSync(path.join(destino,'portal/banco/estado/state/v3/d1/miniflare-D1DatabaseObject/fixture.sqlite'));
    try { assert.equal(restaurado.prepare("SELECT status FROM email_notifications WHERE id='e'").get().status,'failed'); }
    finally { restaurado.close(); }
    assert.equal(fs.readdirSync(dir).some(n=>n.startsWith('semente-restauro-')),false);
    const extraido=path.join(dir,'extraido');
    const ps=(comando)=>execFileSync('powershell.exe',['-NoProfile','-Command',comando],{env:{...env,SV_ZIP:zip,SV_EXTRAIDO:extraido},stdio:'pipe'});
    ps('Expand-Archive -LiteralPath $env:SV_ZIP -DestinationPath $env:SV_EXTRAIDO');
    const metadata=path.join(extraido,'semente.json');
    const meta=JSON.parse(fs.readFileSync(metadata,'utf8').replace(/^\uFEFF/,''));
    meta.banco.arquivo='../invalido.sqlite';fs.writeFileSync(metadata,JSON.stringify(meta));
    fs.rmSync(zip);ps("Compress-Archive -Path (Join-Path $env:SV_EXTRAIDO '*') -DestinationPath $env:SV_ZIP");
    const preservado=path.join(dir,'config-existente');fs.mkdirSync(path.join(preservado,'comum'),{recursive:true});
    fs.writeFileSync(path.join(preservado,'comum/smtp.env'),'preservar');
    assert.throws(()=>execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/restaurar-semente.ps1'),'-Zip',zip],{env:{...env,TEMP:dir,SUPPLY_VISION_PRIVADO:preservado},stdio:'pipe'}));
    assert.equal(fs.readFileSync(path.join(preservado,'comum/smtp.env'),'utf8'),'preservar');
    // Hash valido nao basta: um SQLite de outro produto deve ser rejeitado.
    const origemBanco=path.join(extraido,'banco/portal.sqlite');fs.rmSync(origemBanco);
    const estranho=new DatabaseSync(origemBanco);estranho.exec('CREATE TABLE outro_produto(id TEXT)');estranho.close();
    meta.banco.arquivo='fixture.sqlite';meta.banco.sha256=createHash('sha256').update(fs.readFileSync(origemBanco)).digest('hex');
    fs.writeFileSync(metadata,JSON.stringify(meta));fs.rmSync(zip);
    ps("Compress-Archive -Path (Join-Path $env:SV_EXTRAIDO '*') -DestinationPath $env:SV_ZIP");
    assert.throws(()=>execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/restaurar-semente.ps1'),'-Zip',zip],{env:{...env,TEMP:dir,SUPPLY_VISION_PRIVADO:preservado},stdio:'pipe'}));
    assert.equal(fs.readFileSync(path.join(preservado,'comum/smtp.env'),'utf8'),'preservar');
    for(const n of fs.readdirSync(dir).filter(n=>n.endsWith('.zip')))fs.rmSync(path.join(dir,n));
    fs.rmSync(banco);
    assert.throws(executar);
    assert.equal(fs.readdirSync(dir).some(n=>n.startsWith('semente-')||n.endsWith('.zip')),false);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
