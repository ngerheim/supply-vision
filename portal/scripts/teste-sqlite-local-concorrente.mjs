import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { relative, isAbsolute } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';

const [raiz,arquivo]=process.argv.slice(2), porta=Number(process.env.PORTAL_TESTE_PORTA);
if(process.env.PORTAL_TESTE_DESCARTAVEL!=='SIM'||!raiz||!arquivo||!Number.isInteger(porta)||porta<1024||porta>65534)throw new Error('Exige banco descartavel e porta de teste.');
const rel=relative(realpathSync.native(raiz),realpathSync.native(arquivo));
assert(realpathSync.native(raiz).includes('portal-teste-')&&rel&&!rel.startsWith('..')&&!isAbsolute(rel));
const db=new DatabaseSync(arquivo),id='conc_sqlite_'+crypto.randomUUID();
db.exec('PRAGMA busy_timeout=5000');
db.prepare('INSERT INTO audit_logs(id,action,entity,details,created_at) VALUES(?,?,?,?,?)').run(id,'TEST','test','fixture',new Date().toISOString());
const controle=new Int32Array(new SharedArrayBuffer(4));
const escritor=new Worker(`const {workerData,parentPort}=require('node:worker_threads');const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(workerData.arquivo);db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');db.prepare('UPDATE audit_logs SET details=? WHERE id=?').run('escritor externo',workerData.id);parentPort.postMessage('ocupado');Atomics.wait(new Int32Array(workerData.controle),0,0);db.exec('COMMIT');db.close();`,{eval:true,workerData:{arquivo,id,controle:controle.buffer}});
const fim=new Promise(r=>{let erro;escritor.once('error',e=>{erro=e;});escritor.once('exit',codigo=>r({codigo,erro}));});
try{
 await new Promise((r,j)=>{escritor.once('message',r);escritor.once('error',j);});
 const respostas=await Promise.all(Array.from({length:20},(_,i)=>fetch(`http://127.0.0.1:${porta}/api/${i%2?'search/options':'health'}`,{headers:{cookie:process.env.PORTAL_TESTE_COOKIE,'x-portal-poll':'1'},signal:AbortSignal.timeout(4000)})));
 for(const r of respostas){assert.equal(r.status,200,await r.clone().text());await r.arrayBuffer();}
 console.log('[OK] Health e opcoes respondem durante transacao SQLite externa, sem erro de lock nem novas tentativas.');
}finally{
 Atomics.store(controle,0,1);Atomics.notify(controle,0);const resultado=await fim;
 try{db.prepare('DELETE FROM audit_logs WHERE id=?').run(id);}finally{db.close();}
 assert.ifError(resultado.erro);assert.equal(resultado.codigo,0,'Escritor externo precisa concluir com sucesso.');
}
