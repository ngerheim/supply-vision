import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as esperar } from 'node:timers/promises';
import test from 'node:test';
import { criarTemporarioTeste } from './apoio/ambiente.mjs';
import { reservarPortaLoopback } from '../scripts/porta-teste.mjs';
import { localizarBanco } from '../scripts/banco-local.mjs';

const portal=path.resolve(import.meta.dirname,'..');
void test('Portal, consumidores, backup, expurgo, restauracao e semente compartilham o arquivo criado na partida', {
  skip:!fs.existsSync(path.join(portal,'dist/server/index.js')),timeout:90000,
}, async t=>{
  const raiz=criarTemporarioTeste('sv-banco-compartilhado-'), pastaPortal=path.join(raiz,'portal');
  const port=await reservarPortaLoopback(),relatorios=await reservarPortaLoopback(),url=`http://127.0.0.1:${port}`;
  const tokenA='a'.repeat(64),tokenB='b'.repeat(64), senha='senha-ficticia-banco-123';
  const env={...process.env,SUPPLY_VISION_PRIVADO:raiz,MODO_ENSAIO:'1',PORTAL_CRIAR_BANCO:'1',PORTAL_PORTA:String(port),RELATORIOS_PORTA:String(relatorios),INITIAL_ADMIN_PASSWORD:senha};
  delete env.PORTAL_API_TOKEN;
  for(const dir of ['portal/configuracao','comum','operacao','alertas/config','alertas/parametros'])fs.mkdirSync(path.join(raiz,dir),{recursive:true});
  fs.writeFileSync(path.join(raiz,'comum/operacao.env'),'MODO_ENSAIO=1\nEXPURGO_HABILITADO=1\nEXPURGO_EMAILS_DIAS=0\nEXPURGO_RELATORIOS_DIAS=0\nEXPURGO_IMPORTACOES_DIAS=1\n');
  fs.writeFileSync(path.join(raiz,'comum/smtp.env'),'SMTP_HOST=127.0.0.1\nSMTP_PORT=1\n');
  let filho,log='';
  const executar=(nome,args=[])=>execFileSync(process.execPath,[path.join(portal,'scripts',nome),...args],{cwd:portal,env,encoding:'utf8',timeout:20000});
  async function parar(){
    if(!filho||filho.exitCode!==null)return;
    const fim=new Promise(r=>filho.once('exit',r));fs.writeFileSync(path.join(raiz,'operacao/parar.sinal'),'parar');
    const prazo=new AbortController();
    try{
      await Promise.race([fim,esperar(6000,undefined,{signal:prazo.signal})]);
      assert.notEqual(filho.exitCode,null,'Launcher nao encerrou: '+log);
    }finally{prazo.abort();}
  }
  t.after(async()=>{try{await parar();}finally{if(filho?.exitCode===null)filho.kill();fs.rmSync(raiz,{recursive:true,force:true});}});
  async function iniciar(token){
    fs.rmSync(path.join(raiz,'operacao/parar.sinal'),{force:true});
    // A restauracao CLI le as portas do arquivo, sem sobrepor process.env.
    fs.writeFileSync(path.join(pastaPortal,'configuracao/portal.env'),`PORTAL_URL=${url}\nPORTAL_PORTA=${port}\nRELATORIOS_PORTA=${relatorios}\nPORTAL_API_TOKEN=${token}\n`);
    filho=spawn(process.execPath,['scripts/iniciar-portal.mjs','local'],{cwd:portal,env,stdio:['ignore','pipe','pipe']});
    filho.stdout.on('data',d=>log+=d);filho.stderr.on('data',d=>log+=d);
    for(let n=0;n<100;n++){
      assert.equal(filho.exitCode,null,log);
      try{const r=await fetch(url+'/api/health',{signal:AbortSignal.timeout(1000)});if(r.ok){await r.arrayBuffer();return;}}catch{}
      await esperar(100);
    }
    assert.fail('Health nao iniciou: '+log);
  }
  async function interna(token){const r=await fetch(url+'/api/internal/agreements',{headers:{authorization:'Bearer '+token}});await r.arrayBuffer();return r.status;}
  function ler(arquivo){const db=new DatabaseSync(arquivo,{readOnly:true});try{return db.prepare("SELECT name FROM units WHERE code='PROVA'").get()?.name;}finally{db.close();}}
  await iniciar(tokenA);
  const arquivo=localizarBanco(null,pastaPortal);
  assert.ok(arquivo);assert.equal(path.basename(arquivo),'portal.sqlite');
  assert.equal(executar('banco-local.mjs',['--pasta-portal',pastaPortal,'--exigir']).trim(),arquivo);
  assert.ok(fs.existsSync(path.join(pastaPortal,'restauracao.lock.sqlite')),'Fixture deve conter tambem o banco da trava');
  const admin=new DatabaseSync(arquivo);
  try{assert.equal(admin.prepare("UPDATE users SET email=?,name=? WHERE role='admin'").run('admin@example.com','Administrador Ficticio').changes,1);}
  finally{admin.close();}
  const login=await fetch(url+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'admin@example.com',password:senha})});
  assert.equal(login.status,200,await login.clone().text());const cookie=login.headers.get('set-cookie').split(';')[0];await login.arrayBuffer();
  const cadastro=await fetch(url+'/api/catalogs/units',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({code:'PROVA',name:'PROVA'})});
  assert.equal(cadastro.status,201,await cadastro.clone().text());await cadastro.arrayBuffer();
  assert.equal(ler(arquivo),'PROVA');
  assert.equal(await interna(tokenA),200);assert.equal(await interna(tokenB),401);
  for(const [nome,abrir] of [['processar-emails','abrirBanco'],['processar-relatorios','abrirBancoRelatorios']]){
    const codigo=`import assert from 'node:assert/strict';import fs from 'node:fs';import {${abrir}} from './scripts/${nome}.mjs';const db=${abrir}();assert.ok(db);try{assert.equal(fs.realpathSync(db.prepare('PRAGMA database_list').get().file),fs.realpathSync(process.argv[1]));assert.equal(db.prepare("SELECT name FROM units WHERE code='PROVA'").get().name,'PROVA');}finally{db.close()}`;
    execFileSync(process.execPath,['--input-type=module','-e',codigo,arquivo],{cwd:portal,env,timeout:10000});
  }
  const seed=new DatabaseSync(arquivo);try{seed.prepare("INSERT INTO imports(id,filename,mode,status,created_at,completed_at,summary_json) VALUES('prova-expurgo','fixture.xlsx','replace','completed','2000-01-01','2000-01-01','prova')").run();}finally{seed.close();}
  executar('expurgar-dados.mjs');
  const expurgado=new DatabaseSync(arquivo,{readOnly:true});try{assert.equal(expurgado.prepare("SELECT summary_json FROM imports WHERE id='prova-expurgo'").get().summary_json,null);}finally{expurgado.close();}
  executar('backup.mjs',['--somente-local']);assert.equal(ler(path.join(pastaPortal,'backups/pre-atualizacao.sqlite')),'PROVA');
  await parar();await iniciar(tokenB);
  assert.equal(localizarBanco(null,pastaPortal),arquivo);assert.equal(await interna(tokenA),401);assert.equal(await interna(tokenB),200);
  await parar();
  const mudar=new DatabaseSync(arquivo);try{mudar.exec("UPDATE units SET name='Depois do backup' WHERE code='PROVA'");}finally{mudar.close();}
  executar('restaurar-backup.mjs',['--sim','--pre-atualizacao']);assert.equal(localizarBanco(null,pastaPortal),arquivo);assert.equal(ler(arquivo),'PROVA');
  const snapshot=path.join(raiz,'semente.sqlite');executar('snapshot-banco.mjs',[arquivo,snapshot]);assert.equal(ler(snapshot),'PROVA');
  t.diagnostic('Semente integrada ao 7z: geracao e restauracao de configuracao exercitadas em backup-restauracao-e2e.test.mjs.');
});
