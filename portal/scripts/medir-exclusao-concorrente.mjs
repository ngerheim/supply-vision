// Executa o teste real uma vez por banco novo, sem repetir requisicoes.
// --bloqueio-ms simula o cliente ocupado no SQLite, como no CI Windows.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as esperar } from 'node:timers/promises';
import { createServer } from 'node:net';

const args = process.argv.slice(2);
function valor(nome, padrao) { const i=args.indexOf(nome);return i<0?padrao:args[i+1]; }
const projeto=path.resolve(import.meta.dirname,'..'), porta=Number(valor('--porta','3299'));
const total=Number(valor('--execucoes','30')), bloqueio=Number(valor('--bloqueio-ms','0'));
if (!Number.isInteger(total)||total<1||total>100||!Number.isInteger(porta)||porta<1024||porta>65534||!Number.isInteger(bloqueio)||bloqueio<0||bloqueio>30000) throw new Error('Parametros do ensaio invalidos.');
const destino=path.resolve(valor('--saida',path.join(projeto,'work','medicao-exclusao')));
fs.mkdirSync(destino,{recursive:true});
if (!fs.existsSync(path.join(projeto,'dist/server/wrangler.json'))) throw new Error('Compile o portal antes de medir.');
const direto=args.includes('--direto'), completo=args.includes('--completo');
const executavel=path.join(projeto,direto?'node_modules/wrangler/bin/wrangler.js':'scripts/runtime-local.mjs');
const resultados=[];
const reserva=createServer();await new Promise((r,j)=>reserva.once('error',j).listen(porta,'127.0.0.1',r));await new Promise(r=>reserva.close(r));
function sqlite(dir) { for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory()){const a=sqlite(p);if(a)return a;}else if(e.name.endsWith('.sqlite')&&e.name!=='metadata.sqlite')return p;} }
function encerrar(processo) {
  if(process.platform==='win32') spawnSync('taskkill.exe',['/PID',String(processo.pid),'/T','/F'],{stdio:'ignore',timeout:5000});
  else try {process.kill(-processo.pid,'SIGTERM');}catch{}
}
for(let n=1;n<=total;n++) {
  const raiz=fs.mkdtempSync(path.join(os.tmpdir(),'portal-teste-concorrencia-'));
  const ambiente={...process.env,MINIFLARE_REGISTRY_PATH:path.join(raiz,'registry'),WRANGLER_REGISTRY_PATH:path.join(raiz,'wrangler-registry'),WRANGLER_LOG_PATH:path.join(raiz,'wrangler-logs'),WRANGLER_SEND_METRICS:'false',XDG_CONFIG_HOME:path.join(raiz,'config'),XDG_CACHE_HOME:path.join(raiz,'cache'),SUPPLY_VISION_PRIVADO:path.join(raiz,'fixture-privada')};
  let log='',teste='',saida=null,sinal=null,erro=null,codigo=null,saude=null;
  const inicio=Date.now(), url=`http://127.0.0.1:${porta}`;
  const servidor=spawn(process.execPath,[executavel,'dev','--config','dist/server/wrangler.json','--persist-to',raiz,'--var','INITIAL_ADMIN_PASSWORD:senha-descartavel-12345','--var','PORTAL_API_TOKEN:relatorios-token-ci','--var',`RELATORIOS_PORTA:${porta+1}`,'--ip','127.0.0.1','--port',String(porta)],{cwd:projeto,env:ambiente,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
  servidor.stdout.on('data',d=>log+=d);servidor.stderr.on('data',d=>log+=d);servidor.on('exit',(c,s)=>{saida=c;sinal=s;});servidor.on('error',e=>{erro=String(e);});
  try {
    let pronto=false;
    for(let i=0;i<120;i++){
      if(erro||saida!==null||sinal)throw new Error('Servidor encerrou na partida.');
      try { const r=await fetch(url+'/api/health',{signal:AbortSignal.timeout(1000)});if(r.ok){pronto=true;break;} }catch{}
      await esperar(250);
    }
    if(!pronto)throw new Error('Partida excedeu 30 s.');
    const arquivo=sqlite(raiz);if(!arquivo)throw new Error('Banco descartavel nao encontrado.');
    const db=new DatabaseSync(arquivo);
    try {db.exec('PRAGMA busy_timeout=5000');db.prepare("UPDATE users SET email=? WHERE role='admin'").run('admin@portal.test');}finally{db.close();}
    const login=await fetch(url+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'admin@portal.test',password:'senha-descartavel-12345'})});
    if(!login.ok)throw new Error('Login falhou: '+login.status);
    const cookie=login.headers.get('set-cookie')?.split(';')[0];if(!cookie)throw new Error('Login sem sessao.');
    const imports=[];
    if(bloqueio){
      const preload=path.join(raiz,'bloqueio-cliente.mjs');
      fs.writeFileSync(preload,`const original=fetch;let pausou=false;globalThis.fetch=(input,...args)=>{if(!pausou&&String(input).includes('/api/audit/export?')){pausou=true;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${bloqueio});}return original(input,...args);};`);
      imports.push('--import',preload);
    }
    const scripts=['teste-exclusao-concorrente.mjs',...(completo?['teste-health-repetido.mjs','teste-sqlite-local-concorrente.mjs','teste-erros-banco.mjs','teste-relatorios-perfis.mjs','teste-http-fluxo.mjs']:[])];
    codigo=0;
    for(const script of scripts){
      const c=await new Promise((r,j)=>{
        const filho=spawn(process.execPath,[...imports,path.join(projeto,'scripts',script),raiz,arquivo],{cwd:projeto,env:{...ambiente,PORTAL_TESTE_PORTA:String(porta),PORTAL_TESTE_COOKIE:cookie,PORTAL_TESTE_DESCARTAVEL:'SIM'},stdio:['ignore','pipe','pipe']});
        const timer=setTimeout(()=>filho.kill(),180000);
        filho.stdout.on('data',d=>teste+=d);filho.stderr.on('data',d=>teste+=d);filho.once('error',j);filho.once('exit',code=>{clearTimeout(timer);r(code);});
      });
      if(c!==0){codigo=c??1;break;}
    }
    try{saude=(await fetch(url+'/api/health',{signal:AbortSignal.timeout(5000)})).status;}catch(e){saude=String(e.cause?.code??e);}
  }catch(e){erro=String(e);}
  finally {
    const r={n,codigo,erro,saude,servidorEncerrou:saida!==null||!!sinal,saidaServidor:saida,sinalServidor:sinal,d1:(log.match(/Failed to get session commit token/g)||[]).length,reset:/ECONNRESET|UND_ERR_SOCKET|other side closed/.test(teste),duracaoMs:Date.now()-inicio};
    fs.writeFileSync(path.join(destino,`${n}-servidor.log`),log);fs.writeFileSync(path.join(destino,`${n}-teste.log`),teste);resultados.push(r);
    fs.writeFileSync(path.join(destino,'resultados.json'),JSON.stringify({plataforma:process.platform,node:process.version,direto,bloqueioMs:bloqueio,resultados},null,2));console.log(JSON.stringify(r));
    encerrar(servidor);await esperar(300);
    if(process.platform!=='win32'&&servidor.pid!==undefined)try{process.kill(-servidor.pid,'SIGKILL');}catch{}
    fs.rmSync(raiz,{recursive:true,force:true});
  }
}
const falhas=resultados.filter(r=>r.codigo!==0).length;
console.log(JSON.stringify({total,falhas,resets:resultados.filter(r=>r.reset).length,d1:resultados.reduce((s,r)=>s+r.d1,0)}));
process.exitCode=falhas?1:0;
