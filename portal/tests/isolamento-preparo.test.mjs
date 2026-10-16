import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

void test('preload bloqueia arquivos, SQLite, PID/trava e qualquer porta alheia ao preparo', () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-isolamento-'));
  const raiz = path.join(pasta, `.fixture-preparo-${randomBytes(16).toString('hex')}`);
  const scripts = path.join(raiz, 'portal/scripts');
  fs.mkdirSync(scripts, { recursive: true });fs.mkdirSync(path.join(raiz, '.cache'));
  fs.mkdirSync(path.join(raiz, 'privado'));
  const sentinela = path.join(pasta, 'producao-ficticia');fs.mkdirSync(sentinela);
  fs.writeFileSync(path.join(sentinela, 'supervisor.pid.json'), 'preservar');
  fs.writeFileSync(path.join(sentinela, 'supervisor.lock'), 'preservar');
  fs.writeFileSync(path.join(sentinela, 'banco.sqlite'), 'preservar');
  const modulo = path.join(scripts, 'isolamento-preparo.mjs');
  fs.copyFileSync(new URL('../scripts/isolamento-preparo.mjs', import.meta.url), modulo);
  fs.copyFileSync(new URL('../scripts/isolamento-sqlite-hooks.mjs', import.meta.url), path.join(scripts,'isolamento-sqlite-hooks.mjs'));
  const env = { ...process.env, NODE_OPTIONS: '', SV_PREPARO_RAIZ: raiz,
    SUPPLY_VISION_PRIVADO: path.join(raiz,'privado'), TEMP: path.join(raiz,'.cache'), TMP: path.join(raiz,'.cache'), TMPDIR: path.join(raiz,'.cache'),
    XDG_CONFIG_HOME: path.join(raiz,'.cache'), XDG_CACHE_HOME: path.join(raiz,'.cache') };
  const script = `import assert from 'node:assert/strict';import fs from 'node:fs';import net from 'node:net';import {DatabaseSync} from 'node:sqlite';
    const externa=process.argv[1];
    for(const n of ['supervisor.pid.json','supervisor.lock'])assert.throws(()=>fs.readFileSync(externa+'/'+n),/fora do worktree/);
    assert.throws(()=>fs.writeFileSync(externa+'/supervisor.lock','alterado'),/fora do worktree/);
    assert.throws(()=>new DatabaseSync(externa+'/banco.sqlite'),/fora do worktree/);
    for(const porta of [3000,3001,59996])assert.throws(()=>net.connect({host:'127.0.0.1',port:porta}),/isolamento/);
    const servidor=net.createServer(s=>s.end());await new Promise(r=>servidor.listen(0,'127.0.0.1',r));
    const cliente=net.connect({host:'127.0.0.1',port:servidor.address().port});await new Promise((r,j)=>cliente.once('close',r).once('error',j));await new Promise(r=>servidor.close(r));
    const db=new DatabaseSync(':memory:');db.close();console.log('isolamento aprovado');`;
  try {
    const rodar = ambiente => spawnSync(process.execPath, ['--import',pathToFileURL(modulo).href,'--input-type=module','-e',script,sentinela], {env:ambiente,encoding:'utf8',timeout:15000});
    const ok=rodar(env);assert.equal(ok.status,0,ok.stderr);assert.match(ok.stdout,/isolamento aprovado/);
    const ruim=rodar({...env,SUPPLY_VISION_PRIVADO:sentinela});assert.notEqual(ruim.status,0);assert.match(ruim.stderr,/fora do worktree/);
    for(const nome of fs.readdirSync(sentinela))assert.equal(fs.readFileSync(path.join(sentinela,nome),'utf8'),'preservar');
  } finally { fs.rmSync(pasta,{recursive:true,force:true}); }
});

void test('fumaca recusa portas nao reservadas antes de carregar o servidor', () => {
  const pasta=fs.mkdtempSync(path.join(os.tmpdir(),'sv-fumaca-guarda-'));
  const raiz=path.join(pasta,`.fixture-preparo-${randomBytes(16).toString('hex')}`);
  const scripts=path.join(raiz,'portal/scripts');fs.mkdirSync(scripts,{recursive:true});
  fs.mkdirSync(path.join(raiz,'.cache/preparo-portas'),{recursive:true});
  const modulo=path.join(scripts,'fumaca-preparo.mjs');
  fs.copyFileSync(new URL('../scripts/fumaca-preparo.mjs',import.meta.url),modulo);
  fs.writeFileSync(path.join(scripts,'servidor-node.mjs'),"throw new Error('nao carregar antes das guardas')");
  try {
    for(const portas of [['3000','3001'],['39998','39999']]) {
      const r=spawnSync(process.execPath,[modulo,...portas],{encoding:'utf8',timeout:10000,env:{...process.env,NODE_OPTIONS:'',SV_PREPARO_RAIZ:raiz}});
      assert.notEqual(r.status,0);assert.match(r.stderr,/Portas nao reservadas/);
      assert.doesNotMatch(r.stderr,/nao carregar antes/);
    }
  }finally{fs.rmSync(pasta,{recursive:true,force:true});}
});
