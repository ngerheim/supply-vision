import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lerArquivo } from '../scripts/configuracao.mjs';

// Contrato nas tres linguagens: CHAVE=valor; comentarios de linha inteira;
// trim/BOM; separacao no primeiro '='; ultimo valor vence; aspas literais;
// linha sem '=' ou chave vazia e erro. Chaves operacionais sao maiusculas.
const casos=JSON.parse(fs.readFileSync(new URL('../../testes/fixtures/configuracao-env.json',import.meta.url),'utf8'));
for(const caso of casos)void test(`contrato env: ${caso.nome}`,t=>{
  const pasta=fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'sv-env-'));
  t.after(()=>fs.rmSync(pasta,{recursive:true,force:true}));
  const arquivo=path.join(pasta,'config.env');if(!caso.ausente)fs.writeFileSync(arquivo,caso.texto);
  if(caso.erro)assert.throws(()=>lerArquivo(arquivo,{obrigatorio:true}),/Linha invalida|ausente/);
  else assert.deepEqual(lerArquivo(arquivo),caso.valores);
  if(caso.ausente)assert.deepEqual(lerArquivo(arquivo),{});
  fs.mkdirSync(path.join(pasta,'comum'));if(!caso.ausente)fs.writeFileSync(path.join(pasta,'comum/operacao.env'),caso.texto);
  const filho=spawnSync(process.execPath,['--experimental-strip-types',fileURLToPath(new URL('../scripts/expurgar-dados.mjs',import.meta.url))],{env:{...process.env,SUPPLY_VISION_PRIVADO:pasta},encoding:'utf8'});
  assert.equal(filho.status,caso.erro?1:0,filho.stderr);
});
