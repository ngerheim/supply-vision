import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { realpathSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';

const porta=Number(process.env.PORTAL_TESTE_PORTA), [raiz, arquivo]=process.argv.slice(2);
if(process.env.PORTAL_TESTE_DESCARTAVEL!=='SIM'||!Number.isInteger(porta)||porta<1024||porta>65535||!raiz||!arquivo)
  throw new Error('Exige instalação descartável na porta informada.');
const caminho=relative(realpathSync.native(raiz),realpathSync.native(arquivo));
assert(caminho&&!caminho.startsWith('..')&&!isAbsolute(caminho),'Banco fora da instância descartável');
assert(realpathSync.native(raiz).includes('portal-teste-'),'Exige instalação descartável');
const db=new DatabaseSync(arquivo);
db.exec('PRAGMA busy_timeout=5000');
const headers={cookie:process.env.PORTAL_TESTE_COOKIE,'content-type':'application/json'};
const pedir=async(path,body)=>{
  const r=await fetch(`http://127.0.0.1:${porta}/api/${path}`,{
    method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(30000),
  });
  return {status:r.status,data:await r.json()};
};
const prefixo='erro_'+crypto.randomUUID();
try {
  const item=await pedir('catalogs/items',{name:prefixo});
  assert.equal(item.status,201);
  db.exec("CREATE TRIGGER teste_falha_auditoria BEFORE INSERT ON audit_logs WHEN NEW.entity='import_mapping' BEGIN SELECT RAISE(ABORT,'DETALHE_PRIVADO_TESTE'); END");
  const falha=await pedir('mappings/items',{source:prefixo,targetId:item.data.id});
  assert.equal(falha.status,500);
  assert.ok(!JSON.stringify(falha.data).includes('DETALHE_PRIVADO_TESTE'));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM import_item_mappings WHERE source_text=?').get(prefixo).n,0);
  db.exec('DROP TRIGGER teste_falha_auditoria');
  assert.equal((await pedir('mappings/items',{source:prefixo,targetId:item.data.id})).status,201);
  assert.equal((await pedir('mappings/items',{source:prefixo,targetId:item.data.id})).status,400);
  console.log('[OK] Falha de banco retorna 500 sem detalhe privado e reverte a gravação; duplicidade continua erro de entrada.');
} finally {
  db.exec('DROP TRIGGER IF EXISTS teste_falha_auditoria');
  db.close();
}
