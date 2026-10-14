// Instalacao descartavel real: troca somente portal.env e reinicia o launcher
// de producao; compara o mesmo arquivo/dataset e exercita as rotinas existentes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as esperar } from 'node:timers/promises';
const projeto=path.resolve(import.meta.dirname,'..'),raiz=fs.mkdtempSync(path.join(os.tmpdir(),'portal-teste-modos-'));
const persistencia=path.join(raiz,'portal/banco/estado/state');
const envFile=path.join(raiz,'portal/configuracao/portal.env'),porta=3000,url=`http://127.0.0.1:${porta}`;
const destino=path.resolve(process.argv[2]||path.join(projeto,'work','modos-banco-local'));
fs.mkdirSync(destino,{recursive:true});
const ambiente={...process.env,SUPPLY_VISION_PRIVADO:raiz,MINIFLARE_REGISTRY_PATH:path.join(raiz,'registry'),WRANGLER_REGISTRY_PATH:path.join(raiz,'wrangler-registry'),WRANGLER_LOG_PATH:path.join(raiz,'logs'),WRANGLER_SEND_METRICS:'false',XDG_CONFIG_HOME:path.join(raiz,'config'),XDG_CACHE_HOME:path.join(raiz,'cache')};
let servidor,log='',arquivo,cookie;const etapas=[],medicoes=[];
function banco(){const db=new DatabaseSync(arquivo);db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON');return db;}
function configurar(modo){
 fs.mkdirSync(path.dirname(envFile),{recursive:true});
 fs.writeFileSync(envFile,`PORTAL_URL=${url}\nINITIAL_ADMIN_PASSWORD=senha-descartavel-12345\n${modo?`PORTAL_BANCO_LOCAL=${modo}\n`:''}`);
}
async function parar(){
 if(!servidor)return;
 const atual=servidor;
 if(atual.exitCode===null){
  const fim=new Promise(r=>atual.once('exit',r));
  fs.writeFileSync(path.join(raiz,'operacao/parar.sinal'),'parar');
  const encerrou=await Promise.race([fim.then(()=>true),esperar(6000).then(()=>false)]);
  if(!encerrou){
   if(process.platform==='win32')spawnSync('taskkill.exe',['/PID',String(atual.pid),'/T','/F'],{stdio:'ignore',timeout:5000});
   else process.kill(-atual.pid,'SIGKILL');
   throw new Error('Launcher nao encerrou em 6 s ao receber parar.sinal.');
  }
  await esperar(300);
 }
 fs.writeFileSync(path.join(destino,`servidor-${etapas.length}.log`),log);
 servidor=null;
}
async function iniciar(modo){
 configurar(modo);log='';fs.mkdirSync(path.join(raiz,'operacao'),{recursive:true});fs.rmSync(path.join(raiz,'operacao/parar.sinal'),{force:true});
 servidor=spawn(process.execPath,[path.join(projeto,'scripts/iniciar-portal.mjs'),'local'],{cwd:projeto,env:ambiente,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
 servidor.stdout.on('data',d=>log+=d);servidor.stderr.on('data',d=>log+=d);
 let pronto=false;
 for(let i=0;i<120;i++){
  if(servidor.exitCode!==null)throw new Error('Launcher encerrou: '+log.slice(-1000));
  try{const r=await fetch(url+'/api/health',{signal:AbortSignal.timeout(1000)});if(r.ok){pronto=true;break;}}catch{}
  await esperar(250);
 }
 assert(pronto,'Instancia nao iniciou');
 const dir=path.join(persistencia,'v3/d1/miniflare-D1DatabaseObject');
 const atual=path.join(dir,fs.readdirSync(dir).find(n=>n.endsWith('.sqlite')&&n!=='metadata.sqlite'));
 if(arquivo)assert.equal(atual,arquivo,'Troca mudou arquivo/identidade');else arquivo=atual;
 assert.equal(fs.readFileSync(arquivo).subarray(0,16).toString(),'SQLite format 3\0');
 const db=banco();
 try{
  assert.equal(db.prepare('SELECT COUNT(*) n FROM schema_migrations WHERE version=7').get().n,1);
  for(const nome of ['idx_imports_created_global','idx_report_jobs_created_global'])assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE type='index' AND name=?").get(nome).n,1);
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode,'wal');
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 }finally{db.close();}
 etapas.push(modo||'sqlite-padrao');
 console.log('[OK] Iniciar por portal.env: '+(modo||'sqlite padrao')+'; arquivo, WAL e migracao 7 preservados.');
}
function voltarMigracao7(){
 const db=banco();try{db.exec('DROP INDEX idx_imports_created_global; DROP INDEX idx_report_jobs_created_global; DELETE FROM schema_migrations WHERE version=7');}finally{db.close();}
}
async function medir(modo){
 const rotas=['/api/health','/api/search/options','/api/tickets?pageSize=50'];
 for(const rota of rotas){
  const tempos=[];
  for(let i=0;i<110;i++){
   const inicio=performance.now();
   const r=await fetch(url+rota,{headers:{cookie,'x-portal-poll':'1'},signal:AbortSignal.timeout(5000)});
   assert.equal(r.status,200,await r.clone().text());await r.arrayBuffer();
   if(i>=10)tempos.push(performance.now()-inicio);
  }
  tempos.sort((a,b)=>a-b);
  const m={modo,rota,amostras:tempos.length,medianaMs:Number(tempos[49].toFixed(2)),p95Ms:Number(tempos[94].toFixed(2))};medicoes.push(m);console.log(JSON.stringify(m));
 }
}
function executarScript(nome,args=[]){
 return execFileSync(process.execPath,['--experimental-strip-types',path.join(projeto,'scripts',nome),...args],{cwd:projeto,env:{...ambiente,PORTAL_TESTE_DESCARTAVEL:'SIM',PORTAL_TESTE_PORTA:String(porta),PORTAL_TESTE_COOKIE:cookie},encoding:'utf8',timeout:120000});
}
function snapshot(modo){
 const r=execFileSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',"import { criarCopiaIntegra } from './scripts/backup.mjs'; criarCopiaIntegra(process.argv[1]);",arquivo],{cwd:projeto,env:ambiente,encoding:'utf8'});
 const copy=new DatabaseSync(path.join(raiz,'portal/backups/portal-atual.sqlite'),{readOnly:true});
 try{assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(copy.prepare('SELECT COUNT(*) n FROM tickets').get().n,contagens.tickets);}finally{copy.close();}
 console.log('[OK] Backup real enquanto '+modo+' esta aberto. '+r.split('\n')[0]);
}
function expurgo(modo){
 const db=banco();try{
  const usuario=db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get().id;
  db.prepare("INSERT INTO imports(id,filename,mode,status,created_by,created_at,completed_at,summary_json) VALUES(?,?,'replace','completed',?,?,?,?)").run('exp_'+modo,'fixture.xlsx',usuario,'2000-01-01','2000-01-01','fixture');
 }finally{db.close();}
 const r=execFileSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',"import {DatabaseSync} from 'node:sqlite';import {expurgar} from './scripts/expurgar-dados.mjs';const db=new DatabaseSync(process.argv[1]);try{db.exec('PRAGMA busy_timeout=5000');console.log(JSON.stringify(expurgar(db,{ativo:true,emails:1,relatorios:1,importacoes:1})));}finally{db.close();}",arquivo],{cwd:projeto,env:ambiente,encoding:'utf8'});
 assert.equal(JSON.parse(r).imports,1);console.log('[OK] Expurgo real em '+modo+'.');
}
let contagens;
try{
 const reserva=createServer();await new Promise((r,j)=>reserva.once('error',j).listen(porta,'127.0.0.1',r));await new Promise(r=>reserva.close(r));
 await iniciar(null);
 const db=banco();try{db.prepare("UPDATE users SET email='admin@portal.test',name='Antes' WHERE role='admin'").run();}finally{db.close();}
 const login=await fetch(url+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'admin@portal.test',password:'senha-descartavel-12345'})});assert.equal(login.status,200);await login.arrayBuffer();cookie=login.headers.get('set-cookie').split(';')[0];
 const teste=executarScript('teste-exclusao-concorrente.mjs',[raiz,arquivo]);fs.writeFileSync(path.join(destino,'exclusoes-sqlite.log'),teste);
 // Dados de busca reais no schema, ainda sinteticos: uma condicao por
 // acordo da fixture, para medir opcoes com resultados e nao uma lista vazia.
 const volume=banco();try{
  const loc=volume.prepare('SELECT id FROM locations LIMIT 1').get().id;
  const item=volume.prepare('SELECT id FROM catalog_items LIMIT 1').get().id;
  const modelo=volume.prepare('SELECT id FROM vehicle_models LIMIT 1').get().id;
  const unidade=volume.prepare('SELECT id FROM units LIMIT 1').get().id;
  volume.exec('BEGIN IMMEDIATE');
  try{
   for(const acordo of volume.prepare("SELECT id FROM agreements WHERE id GLOB 'conc_*_lista_*'").all()){
    const versao='bench_version_'+acordo.id;
    volume.prepare('INSERT INTO agreement_versions(id,agreement_id,version_number,created_at) VALUES(?,?,1,?)').run(versao,acordo.id,'2000-01-01');
    volume.prepare('INSERT OR IGNORE INTO agreement_locations(agreement_id,location_id) VALUES(?,?)').run(acordo.id,loc);
    volume.prepare('UPDATE agreements SET current_version_id=? WHERE id=?').run(versao,acordo.id);
    volume.prepare('INSERT INTO agreement_items(id,version_id,location_id,catalog_item_id,vehicle_model_id,unit_id,price,created_at,updated_at) VALUES(?,?,?,?,?,?,10,?,?)').run('bench_condition_'+acordo.id,versao,loc,item,modelo,unidade,'2000-01-01','2000-01-01');
   }
   volume.exec('COMMIT');
  }catch(erro){volume.exec('ROLLBACK');throw erro;}
 }finally{volume.close();}
 const counts=banco();try{contagens={tickets:counts.prepare('SELECT COUNT(*) n FROM tickets').get().n,agreements:counts.prepare('SELECT COUNT(*) n FROM agreements').get().n,conditions:counts.prepare('SELECT COUNT(*) n FROM agreement_items').get().n};}finally{counts.close();}
 snapshot('sqlite');expurgo('sqlite');await parar();
 voltarMigracao7();await iniciar('d1');
 assert.equal((await (await fetch(url+'/api/session',{headers:{cookie,'x-portal-poll':'1'}})).json()).user.email,'admin@portal.test');
 await medir('d1');snapshot('d1');expurgo('d1');await parar();
 voltarMigracao7();await iniciar('sqlite');await medir('sqlite');
 // Tambem valida as exclusoes no D1, depois da comparacao no mesmo dataset.
 snapshot('sqlite');await parar();
 // O teste original usa uma faixa fixa de codigos em sua fixture de 501
 // chamados. Remove apenas essa fixture sintetica antes da segunda execucao.
 const limpeza=banco();try{limpeza.exec("DELETE FROM agreement_items WHERE id GLOB 'bench_condition_*'; UPDATE agreements SET current_version_id=NULL WHERE id GLOB 'conc_*_lista_*'; DELETE FROM agreement_versions WHERE id GLOB 'bench_version_*'; DELETE FROM agreement_locations WHERE agreement_id GLOB 'conc_*_lista_*'; DELETE FROM tickets WHERE id GLOB 'conc_*_lista_*'; DELETE FROM agreements WHERE id GLOB 'conc_*_lista_*'");}finally{limpeza.close();}
 await iniciar('d1');
 fs.writeFileSync(path.join(destino,'exclusoes-d1.log'),executarScript('teste-exclusao-concorrente.mjs',[raiz,arquivo]));
 await parar();
 const mudou=banco();try{mudou.prepare("UPDATE users SET name='Depois' WHERE role='admin'").run();}finally{mudou.close();}
 const restauracao=executarScript('restaurar-backup.mjs',['--sim']);assert.match(restauracao,/Restauracao concluida/);
 fs.writeFileSync(path.join(destino,'restauracao.log'),restauracao);
 const restaurado=banco();try{assert.equal(restaurado.prepare("SELECT name FROM users WHERE role='admin'").get().name,'Antes');assert.equal(restaurado.prepare('SELECT COUNT(*) n FROM tickets').get().n,contagens.tickets);assert.equal(restaurado.prepare('PRAGMA journal_mode').get().journal_mode,'delete');}finally{restaurado.close();}
 await iniciar('sqlite');await parar();await iniciar('d1');
 assert.equal((await (await fetch(url+'/api/session',{headers:{cookie,'x-portal-poll':'1'}})).json()).user.email,'admin@portal.test');
 console.log('[OK] Restauracao CLI, retorno a WAL, indices e reversao sqlite -> d1 -> sqlite sem rebuild.');
 fs.writeFileSync(path.join(destino,'resultado.json'),JSON.stringify({node:process.version,plataforma:process.platform,contagens,etapas,medicoes},null,2));
}finally{await parar();fs.rmSync(raiz,{recursive:true,force:true});}
