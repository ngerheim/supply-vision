import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as esperar } from 'node:timers/promises';
import { iniciarRuntimeLocal } from '../scripts/runtime-local.mjs';
import { reservarPortaLoopback } from '../scripts/proxy-ip-login.mjs';

async function ate(condicao, prazo=5000) {
  const fim=Date.now()+prazo;
  while(Date.now()<fim){if(await condicao())return;await esperar(50);}
  throw new Error('Prazo esgotado esperando encerramento/prontidao da fixture.');
}
function vivo(pid){try{process.kill(pid,0);return true;}catch{return false;}}
for(const bancoLocal of ['sqlite','d1']) for(const motivo of ['explicito','sinal','pai']) {
  void test(`runtime ${bancoLocal}: ${motivo} libera banco, conexoes e descendente resistente`, {timeout:15000}, async t => {
    const projeto=fs.mkdtempSync(path.join(os.tmpdir(),'sv-runtime-parada-'));
    const estado={};let cliente;
    t.after(async()=>{
      cliente?.destroy();estado.pai?.kill();await estado.runtime?.encerrar();
      // O kernel pode manter um zumbi ate o init recolher; nao e processo ativo.
      if(estado.descendente&&vivo(estado.descendente))try{process.kill(estado.descendente,'SIGKILL');}catch{}
      fs.rmSync(projeto,{recursive:true,force:true});
    });
    const persistencia=path.join(projeto,'state');
    const pasta=path.join(persistencia,'v3/d1/miniflare-D1DatabaseObject');fs.mkdirSync(pasta,{recursive:true});
    const arquivo=path.join(pasta,'fixture.sqlite');const db=new DatabaseSync(arquivo);
    db.exec('PRAGMA journal_mode=WAL;CREATE TABLE dados(valor TEXT);INSERT INTO dados VALUES (\'preservado\')');db.close();
    const wrangler=path.join(projeto,'node_modules/wrangler/bin');fs.mkdirSync(wrangler,{recursive:true});
    // Descendente herda stdout e ignora SIGTERM, reproduzindo a arvore que
    // kill() no pai nao encerra. Em d1 tambem mantem o SQLite aberto.
    fs.writeFileSync(path.join(projeto,'filho.mjs'),`import fs from 'node:fs';import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(${JSON.stringify(arquivo)});db.exec('PRAGMA journal_mode=WAL');process.on('SIGTERM',()=>{});fs.writeFileSync('filho-pronto','ok');setInterval(()=>{},1000);`);
    fs.writeFileSync(path.join(wrangler,'wrangler.js'),`const fs=require('node:fs'),{spawn}=require('node:child_process');const filho=spawn(process.execPath,['filho.mjs'],{stdio:'inherit'});const vars=fs.readFileSync(process.argv[process.argv.indexOf('--env-file')+1],'utf8');fs.writeFileSync('portas.json',JSON.stringify({pid:filho.pid,porta:Number(vars.match(/PORTAL_SQLITE_PORTA=(.*)/)[1]),token:vars.match(/PORTAL_SQLITE_TOKEN=(.*)/)[1]}));setInterval(()=>{},1000);`);
    const pararArquivo=path.join(projeto,'parar.sinal');
    const pai=motivo==='pai'?spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}):null;estado.pai=pai;
    const runtime=await iniciarRuntimeLocal(['dev','--persist-to',persistencia,'--port',String(await reservarPortaLoopback())],{projeto,bancoLocal,pararArquivo:motivo==='sinal'?pararArquivo:null,pai:pai?.pid});
    estado.runtime=runtime;
    await ate(()=>fs.existsSync(path.join(projeto,'filho-pronto')));
    const dados=JSON.parse(fs.readFileSync(path.join(projeto,'portas.json'),'utf8'));const descendente=dados.pid;estado.descendente=descendente;
    if(bancoLocal==='sqlite'){
      const r=await fetch(`http://127.0.0.1:${dados.porta}/sql`,{method:'POST',headers:{authorization:`Bearer ${dados.token}`},body:JSON.stringify({operacao:'consulta',consultas:[{sql:'SELECT * FROM dados',values:[]}]})});
      assert.equal(r.status,200);await r.arrayBuffer();
      // Um POST que nunca termina nao pode reter a ponte/banco na parada.
      cliente=net.connect(dados.porta,'127.0.0.1');
      await new Promise((r,j)=>cliente.once('connect',r).once('error',j));
      cliente.write(`POST /sql HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer ${dados.token}\r\nContent-Length: 1000\r\n\r\n{`);
    }
    const inicio=performance.now();
    if(motivo==='sinal')fs.writeFileSync(pararArquivo,'parar');
    else if(motivo==='explicito')await runtime.encerrar();
    else pai.kill();
    await ate(()=>runtime.processo.exitCode!==null||runtime.processo.signalCode!==null);
    await runtime.encerrar();
    await ate(()=>{
      if(!vivo(descendente))return true;
      if(process.platform==='linux'){
        try{return fs.readFileSync(`/proc/${descendente}/stat`,'utf8').split(') ')[1].startsWith('Z');}
        // O kernel pode recolher o processo entre vivo() e a leitura de stat.
        catch(erro){if(erro.code==='ENOENT')return true;throw erro;}
      }
      return false;
    });
    assert(performance.now()-inicio<6000,'Parada excedeu 6 segundos.');
    if(dados.porta){
      const porta=net.createServer();await new Promise((r,j)=>porta.once('error',j).listen(dados.porta,'127.0.0.1',r));await new Promise(r=>porta.close(r));
    }
    const leitura=new DatabaseSync(arquivo);
    try{
      leitura.exec('PRAGMA busy_timeout=0');assert.equal(leitura.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get().busy,0);
      assert.equal(leitura.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
      assert.equal(leitura.prepare('SELECT valor FROM dados').get().valor,'preservado');
    }finally{leitura.close();}
    fs.renameSync(arquivo,arquivo+'.liberado');fs.renameSync(arquivo+'.liberado',arquivo);
  });
}
