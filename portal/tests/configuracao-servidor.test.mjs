import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { criarTemporarioTeste } from './apoio/ambiente.mjs';

void test('importar e ler configuracao do servidor preserva bytes e datas dos arquivos privados', t => {
  const raiz=criarTemporarioTeste('sv-config-somente-leitura-');
  t.after(()=>fs.rmSync(raiz,{recursive:true,force:true}));
  const arquivos=['comum/smtp.env','comum/operacao.env','portal/configuracao/portal.env'].map(n=>path.join(raiz,n));
  for(const arquivo of arquivos){fs.mkdirSync(path.dirname(arquivo),{recursive:true});fs.writeFileSync(arquivo,'# fixture\nCHAVE=valor\n');}
  fs.appendFileSync(arquivos[2],'PORTAL_API_TOKEN=token-ficticio-runtime\n');
  const antes=arquivos.map(a=>({bytes:fs.readFileSync(a),mtime:fs.statSync(a).mtimeMs}));
  const codigo="const {configuracaoServidor}=await import('./scripts/configuracao-servidor.mjs');const {lerConfigBruta}=await import('./scripts/configuracao.mjs');console.log(configuracaoServidor({...lerConfigBruta()}).PORTAL_API_TOKEN)";
  const saida=execFileSync(process.execPath,['--input-type=module','-e',codigo],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,SUPPLY_VISION_PRIVADO:raiz},encoding:'utf8'});
  assert.equal(saida.trim(),'token-ficticio-runtime');
  arquivos.forEach((a,i)=>{assert.deepEqual(fs.readFileSync(a),antes[i].bytes);assert.equal(fs.statSync(a).mtimeMs,antes[i].mtime);});
});
