import { diretorioBanco } from '../scripts/banco-local.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { ultimasEntregas } from '../scripts/ultimas-entregas.mjs';
function fixture(t){
  const privado=fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'sv-entregas-'));
  t.after(()=>fs.rmSync(privado,{recursive:true,force:true}));
  return privado;
}
void test('homologacao usa data do recibo e sent_at real; nao mtime ou tentativas',t=>{
  const privado=fixture(t),pasta=path.join(privado,'alertas/estado-envios');fs.mkdirSync(pasta,{recursive:true});
  for(let i=0;i<7;i++){
    const arquivo=path.join(pasta,`${i}.json`);
    fs.writeFileSync(arquivo,JSON.stringify({estado:'enviado',atualizado:`2026-10-${String(7+i).padStart(2,'0')}T11:00:00-03:00`,destinatarios:['nao-expor@example.invalid']}));
    fs.utimesSync(arquivo,new Date(2026,0,1,0,i),new Date(2026,0,1,0,7-i));
  }
  const estado=diretorioBanco(path.join(privado,'portal'));fs.mkdirSync(estado,{recursive:true});
  const arquivo=path.join(estado,'banco.sqlite'),db=new DatabaseSync(arquivo);
  db.exec("CREATE TABLE daily_report_deliveries(status TEXT,sent_at TEXT,updated_at TEXT);INSERT INTO daily_report_deliveries VALUES('sent','2026-10-13T14:01:00Z','2026-10-13T14:01:00Z'),('pending',NULL,'2026-10-13T15:00:00Z'),('failed',NULL,'2026-10-13T16:00:00Z')");db.close();
  const antes=fs.readFileSync(arquivo),resultado=ultimasEntregas(privado);
  assert.equal(resultado.alertas.length,5);assert.equal(resultado.alertas[0].data,'2026-10-13T14:00:00.000Z');
  assert.deepEqual(resultado.relatorios.map(r=>({...r})),[{data:'2026-10-13T14:01:00Z',estado:'enviado'}]);
  assert.deepEqual(resultado.avisos,[]);assert.doesNotMatch(JSON.stringify(resultado),/nao-expor/);
  assert.deepEqual(fs.readFileSync(arquivo),antes);
});
void test('instalacao nova e recibo invalido sao tratados sem perder recibos validos',t=>{
  const privado=fixture(t);assert.deepEqual(ultimasEntregas(privado),{alertas:[],relatorios:[],avisos:[]});
  const pasta=path.join(privado,'alertas/estado-envios');fs.mkdirSync(pasta,{recursive:true});
  fs.writeFileSync(path.join(pasta,'ruim.json'),'{invalido');
  for(const estado of ['parcial','incerto'])fs.writeFileSync(path.join(pasta,`${estado}.json`),JSON.stringify({estado,atualizado:'2026-10-13T11:00:00Z'}));
  const resultado=ultimasEntregas(privado);assert.equal(resultado.alertas.length,2);assert.equal(resultado.avisos.length,1);
});
