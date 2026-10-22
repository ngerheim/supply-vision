import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { iniciarServidorNode } from '../scripts/servidor-node.mjs';
import { bancoSqliteLocal } from '../lib/sqlite-local.ts';
import { conexao } from '../scripts/ip-conexao.mjs';

for (const motivo of ['explicito', 'sinal', 'pai']) {
  void test(`Node: parada por ${motivo} fecha SQLite e POST incompleto`, {timeout:10000}, async t => {
    const projeto=fs.mkdtempSync(path.join(os.tmpdir(),'sv-node-parada-'));
    fs.mkdirSync(path.join(projeto,'server'),{recursive:true});fs.mkdirSync(path.join(projeto,'client'));
    fs.writeFileSync(path.join(projeto,'server/index.js'), `export default {fetch(){return new Response('fixture')}}`);
    fs.writeFileSync(path.join(projeto,'portal-build.json'), JSON.stringify({build:'2.9.0+1234567'}));
    const banco=bancoSqliteLocal({pastaPrivada:path.join(projeto,'state'),criar:true});
    await banco.exec("CREATE TABLE prova(valor TEXT);INSERT INTO prova VALUES('preservado')");
    globalThis[Symbol.for('supply-vision:banco')]=banco;
    const pararArquivo=path.join(projeto,'parar');
    const runtime=await iniciarServidorNode({outDir:projeto,port:0,pararArquivo:motivo==='sinal'?pararArquivo:null,pai:motivo==='pai'?2147483647:null});
    const port=runtime.server.address().port;
    const socket=new net.Socket();
    t.after(async()=>{socket?.destroy();await runtime.encerrar();fs.rmSync(projeto,{recursive:true,force:true});});
    let recebido;
    runtime.server.prependListener('request',()=>{recebido=conexao.getStore();});
    const r=await fetch(`http://127.0.0.1:${port}/api/health`,{headers:{'x-forwarded-for':'forjado','x-sv-client-ip':'forjado'}});
    assert.equal(r.status,200);assert.equal(r.headers.get('x-portal-build'),'2.9.0+1234567');await r.text();assert.equal(recebido,'127.0.0.1');
    fs.writeFileSync(path.join(projeto,'portal-build.json'), JSON.stringify({build:'2.9.0+7654321'}));
    const seguinte=await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(seguinte.headers.get('x-portal-build'),'2.9.0+1234567','O processo fixa o build ao iniciar');await seguinte.text();
    socket.connect(port,'127.0.0.1');await new Promise((r,j)=>socket.once('connect',r).once('error',j));
    socket.write('POST /api/login HTTP/1.1\r\nHost: localhost\r\nContent-Length: 999\r\n\r\n{');
    const fim=new Promise(r=>runtime.server.once('close',r));
    if(motivo==='sinal')fs.writeFileSync(pararArquivo,'parar');
    else if(motivo==='explicito')await runtime.encerrar();
    await fim;
    const leitura=new DatabaseSync(banco.arquivo);
    try {
      assert.equal(leitura.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get().busy,0);
      assert.equal(leitura.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
      assert.equal(leitura.prepare('SELECT valor FROM prova').get().valor,'preservado');
    } finally { leitura.close(); }
    fs.renameSync(banco.arquivo,banco.arquivo+'.livre');
    const reserva=net.createServer();await new Promise((r,j)=>reserva.once('error',j).listen(port,'127.0.0.1',r));await new Promise(r=>reserva.close(r));
  });
}
