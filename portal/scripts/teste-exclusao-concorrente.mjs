import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { DatabaseSync } from 'node:sqlite';
import { realpathSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';

// Chamado somente pelo teste de instalacao nova, com seu banco descartavel.
const porta = Number(process.env.PORTAL_TESTE_PORTA);
const [raiz, arquivo] = process.argv.slice(2);
if (process.env.PORTAL_TESTE_DESCARTAVEL !== 'SIM' || (!Number.isInteger(porta) || porta < 1024 || porta > 65535) || !raiz || !arquivo) {
  throw new Error('Este teste exige a instalacao descartavel na porta informada.');
}
const caminho = relative(realpathSync.native(raiz), realpathSync.native(arquivo));
assert(caminho && !caminho.startsWith('..') && !isAbsolute(caminho), 'Banco fora da instancia descartavel');
assert(realpathSync.native(raiz).includes('portal-teste-'), 'Exige instalacao descartavel');
const db = new DatabaseSync(arquivo);
db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON');
const prefixo = `conc_${crypto.randomUUID().replaceAll('-', '')}`;
const acordo = `${prefixo}_acordo`;
const versao = `${prefixo}_versao`;
const item = `${prefixo}_item`;
const stamp = new Date().toISOString();
const url = `http://127.0.0.1:${porta}`;
const headers = { cookie: process.env.PORTAL_TESTE_COOKIE };
try {
  db.prepare('INSERT INTO suppliers (id,legal_name,trade_name,cnpj,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(prefixo, prefixo, prefixo, prefixo, stamp, stamp);
  db.prepare('INSERT INTO locations (id,city,state) VALUES (?,?,?)').run(prefixo, prefixo, 'SP');
  db.prepare('INSERT INTO catalog_items (id,name) VALUES (?,?)').run(prefixo, prefixo);
  db.prepare('INSERT INTO vehicle_models (id,name) VALUES (?,?)').run(prefixo, prefixo);
  db.prepare('INSERT INTO units (id,code,name) VALUES (?,?,?)').run(prefixo, prefixo, prefixo);
  db.prepare('INSERT INTO agreements (id,number,supplier_id,start_date,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(acordo, acordo, prefixo, '2026-01-01', stamp, stamp);
  db.prepare('INSERT INTO agreement_versions (id,agreement_id,version_number,created_at) VALUES (?,?,1,?)').run(versao, acordo, stamp);
  db.prepare('INSERT INTO agreement_locations (agreement_id,location_id) VALUES (?,?)').run(acordo,prefixo);
  db.prepare('UPDATE agreements SET current_version_id=? WHERE id=?').run(versao, acordo);
  db.prepare('INSERT INTO agreement_items (id,version_id,location_id,catalog_item_id,vehicle_model_id,unit_id,price,created_at,updated_at) VALUES (?,?,?,?,?,?,10,?,?)').run(item, versao, prefixo, prefixo, prefixo, prefixo, stamp, stamp);
  db.prepare('INSERT INTO travas VALUES (?,?,?)').run(`acordo:${acordo}`, prefixo, stamp);
  for (const rota of [`items/${item}`, `agreements/${acordo}`]) {
    const response = await fetch(`${url}/api/${rota}`, { method: 'DELETE', headers });
    assert.equal(response.status, 409, await response.text());
  }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM agreement_items WHERE id=?').get(item).n, 1);
  assert.equal(db.prepare('SELECT dono FROM travas WHERE chave=?').get(`acordo:${acordo}`).dono, prefixo);
  db.prepare('DELETE FROM travas WHERE chave=? AND dono=?').run(`acordo:${acordo}`, prefixo);

  const edit=await fetch(`${url}/api/items/${item}`,{method:'PUT',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({catalogItemId:prefixo,locationId:prefixo,unitId:prefixo,modelId:prefixo,price:12.5,expectedRevision:0})});
  assert.equal(edit.status,200,await edit.text());
  const stale=await fetch(`${url}/api/items/${item}`,{method:'PUT',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({catalogItemId:prefixo,locationId:prefixo,unitId:prefixo,modelId:prefixo,price:99,expectedRevision:0})});
  assert.equal(stale.status,409,await stale.text());
  assert.equal(db.prepare('SELECT price FROM agreement_items WHERE id=?').get(item).price,12.5);
  const jsonRequestHeaders={...headers,'content-type':'application/json'};
  const newModel=`${prefixo}_novo`;db.prepare('INSERT INTO vehicle_models(id,name) VALUES(?,?)').run(newModel,newModel);
  const condition={catalogItemId:prefixo,locationId:prefixo,unitId:prefixo,price:99,modelIds:[newModel,prefixo]};
  const add=body=>fetch(`${url}/api/agreements/${acordo}/items`,{method:'POST',headers:jsonRequestHeaders,body:JSON.stringify(body)});
  const rejected=await add(condition);assert.equal(rejected.status,409,await rejected.text());
  assert.equal(db.prepare('SELECT COUNT(*) n FROM agreement_items WHERE version_id=?').get(versao).n,1);
  assert.equal(db.prepare('SELECT price FROM agreement_items WHERE id=?').get(item).price,12.5);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_id=? AND action='CREATE'").get(acordo).n,0);
  const fresh=await add({...condition,modelIds:[newModel]});assert.equal(fresh.status,200,await fresh.text());
  assert.equal(db.prepare('SELECT COUNT(*) n FROM agreement_items WHERE version_id=?').get(versao).n,2);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_id=? AND action='CREATE'").get(acordo).n,1);
  console.log('[OK] Cadastro duplicado preserva preco e nao cria parcialmente outros modelos.');
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  db.prepare('UPDATE agreements SET start_date=?,end_date=? WHERE id=?').run('2000-01-01',today,acordo);
  const shown=await (await fetch(`${url}/api/agreements/${acordo}`,{headers})).json();
  assert.equal(shown.agreement.effectiveStatus,'expiring');
  const exported=await fetch(`${url}/api/export/agreements`,{headers});assert.equal(exported.status,200);
  const workbook=XLSX.read(await exported.arrayBuffer(),{type:'array'});
  const exportRows=XLSX.utils.sheet_to_json(workbook.Sheets.ACORDOS);
  const selected=exportRows.filter(r=>r.FORNECEDOR===prefixo);assert.equal(selected.length,2);
  assert.ok(selected.every(r=>r.SITUACAO_EFETIVA===shown.agreement.effectiveStatus));
  console.log('[OK] Exportacao e detalhe concordam para acordo que vence hoje.');
  const agreementBody={number:acordo,supplierId:prefixo,startDate:'2026-01-01',locationIds:[prefixo],expectedRevision:db.prepare('SELECT revision FROM agreements WHERE id=?').get(acordo).revision};
  const editAgreement=await fetch(`${url}/api/agreements/${acordo}`,{method:'PUT',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({...agreementBody,notes:'primeira edicao'})});
  assert.equal(editAgreement.status,200,await editAgreement.text());
  const staleAgreement=await fetch(`${url}/api/agreements/${acordo}`,{method:'PUT',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({...agreementBody,notes:'edicao antiga'})});
  assert.equal(staleAgreement.status,409,await staleAgreement.text());
  const missingRevision={...agreementBody};delete missingRevision.expectedRevision;
  const legacy=await fetch(`${url}/api/agreements/${acordo}`,{method:'PUT',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(missingRevision)});
  assert.equal(legacy.status,409,await legacy.text());
  assert.equal(db.prepare('SELECT notes FROM agreements WHERE id=?').get(acordo).notes,'primeira edicao');
  console.log('[OK] Revisoes impedem perda de edicoes em acordos e condicoes.');
  const audit=JSON.parse(db.prepare("SELECT details FROM audit_logs WHERE entity_id=? AND action='UPDATE' ORDER BY created_at DESC LIMIT 1").get(item).details);
  assert.equal(audit.antes.price,10);assert.equal(audit.depois.price,12.5);
  for (const [rota, tabela, chave] of [[`items/${item}`, 'agreement_items', item], [`agreements/${acordo}`, 'agreements', acordo]]) {
    const revisao = Number(db.prepare(`SELECT revision FROM ${tabela} WHERE id=?`).get(chave).revision);
    // Revisao antiga e recusada sem apagar nada.
    const antiga = await fetch(`${url}/api/${rota}?expectedRevision=${revisao + 1}`, { method: 'DELETE', headers });
    assert.equal(antiga.status, 409, await antiga.text());
    const response = await fetch(`${url}/api/${rota}?expectedRevision=${revisao}`, { method: 'DELETE', headers });
    assert.equal(response.status, 200, await response.text());
  }
  const removed=JSON.parse(db.prepare("SELECT details FROM audit_logs WHERE entity_id=? AND action='DELETE'").get(item).details);
  assert.equal(removed.antes.price,12.5);assert.equal(removed.antes.vehicle_model_id,prefixo);assert.equal(removed.depois,null);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM agreements WHERE id=?').get(acordo).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM travas WHERE chave=?').get(`acordo:${acordo}`).n, 0);
  const jsonHeaders={...headers,'content-type':'application/json'};
  const attempt=crypto.randomUUID();
  const ticketBody={supplierName:prefixo};
  const submit=body=>fetch(`${url}/api/tickets`,{method:'POST',headers:{...jsonHeaders,'idempotency-key':attempt},body:JSON.stringify(body)});
  const duplicateResponses=await Promise.all([submit(ticketBody),submit(ticketBody)]);
  const duplicates=[];
  for(const response of duplicateResponses){assert.equal(response.status,201,await response.clone().text());duplicates.push(await response.json());}
  assert.equal(duplicates[0].id,duplicates[1].id);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM tickets WHERE request_key=?').get(attempt).n,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM ticket_events WHERE ticket_id=?').get(duplicates[0].id).n,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_id=? AND action='CREATE'").get(duplicates[0].id).n,1);
  const changed=await submit({...ticketBody,scope:'outro pedido'});
  assert.equal(changed.status,409,await changed.text());
  const retry=await submit(ticketBody);assert.equal(retry.status,201);assert.equal((await retry.json()).id,duplicates[0].id);
  console.log('[OK] Reenvios concorrentes criam um unico chamado e preservam seu historico.');
  const criado=await fetch(`${url}/api/tickets`,{method:'POST',headers:jsonHeaders,body:JSON.stringify({supplierName:prefixo})});
  assert.equal(criado.status,201);const ticketId=(await criado.json()).id;
  const noRevision=await fetch(`${url}/api/tickets/${ticketId}`,{method:'PUT',headers:jsonHeaders,body:JSON.stringify({scope:'sem revisao'})});
  assert.equal(noRevision.status,409,await noRevision.text());
  assert.equal(db.prepare('SELECT revision FROM tickets WHERE id=?').get(ticketId).revision,0);
  const chave=`chamado:${ticketId}`;
  db.prepare('INSERT INTO travas VALUES (?,?,?)').run(chave,prefixo,stamp);
  for(const {rota,method,body} of [{rota:`tickets/${ticketId}`,method:'PUT',body:{scope:'escopo novo'}},{rota:`tickets/${ticketId}/events`,method:'POST',body:{message:'andamento'}}]){
    const response=await fetch(`${url}/api/${rota}`,{method,headers:jsonHeaders,body:JSON.stringify(body)});
    assert.equal(response.status,409,await response.text());
  }
  assert.equal(db.prepare('SELECT scope FROM tickets WHERE id=?').get(ticketId).scope,null);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM ticket_events WHERE ticket_id=?').get(ticketId).n,1);
  assert.equal(db.prepare('SELECT dono FROM travas WHERE chave=?').get(chave).dono,prefixo);
  db.prepare('DELETE FROM travas WHERE chave=? AND dono=?').run(chave,prefixo);
  for(const [method,body,status] of [['PUT',{priority:'invalida'},400],['PUT',{scope:'escopo novo'},200]]){
    const response=await fetch(`${url}/api/tickets/${ticketId}`,{method,headers:jsonHeaders,body:JSON.stringify({...body,expectedRevision:db.prepare('SELECT revision FROM tickets WHERE id=?').get(ticketId).revision})});
    assert.equal(response.status,status,await response.text());
    assert.equal(db.prepare('SELECT COUNT(*) n FROM travas WHERE chave=?').get(chave).n,0);
  }
  console.log('[OK] Edicoes e andamentos respeitam a trava do chamado e liberam apos validacao.');

  const literalId=`${prefixo}_literal`;
  db.prepare('INSERT INTO audit_logs(id,action,entity,details,created_at) VALUES(?,?,?,?,?)').run(literalId,'CREATE','test',`${prefixo}%_`,stamp);
  const literal=await (await fetch(`${url}/api/audit?q=${encodeURIComponent(prefixo+'%_')}`,{headers})).json();
  assert.equal(literal.total,1);assert.equal(literal.logs[0].id,literalId);
  db.exec('BEGIN');
  try {
    const insert=db.prepare('INSERT INTO audit_logs(id,action,entity,details,created_at) VALUES(?,?,?,?,?)');
    for(let i=0;i<10001;i++)insert.run(`${prefixo}_audit_${i}`,'CREATE','test',`${prefixo}_export_limit`,stamp);
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  const tooMany=await fetch(`${url}/api/audit/export?q=${encodeURIComponent(prefixo+'_export_limit')}`,{headers});
  assert.equal(tooMany.status,400,await tooMany.text());
  console.log('[OK] Auditoria busca caracteres literais e recusa exportacao acima do limite.');
  db.exec('BEGIN');
  try{
    for(let i=0;i<501;i++){
      const registro=`${prefixo}_lista_${i}`;
      db.prepare('INSERT INTO agreements(id,number,supplier_id,start_date,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(registro,registro,prefixo,'2000-01-01',stamp,'2000-01-01T00:00:00.000Z');
      db.prepare("INSERT INTO tickets(id,code,supplier_name,priority,status,created_at,updated_at) VALUES(?,?,?,'media','aberto',?,?)").run(registro,`SUP-${900000+i}`,prefixo,stamp,'2000-01-01T00:00:00.000Z');
    }
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  const bootstrap=await (await fetch(`${url}/api/bootstrap`,{headers})).json();
  const tickets=await (await fetch(`${url}/api/tickets`,{headers})).json();
  for(let i=0;i<501;i++){
    assert.ok(bootstrap.agreements.some(row=>row.id===`${prefixo}_lista_${i}`));
    assert.ok(tickets.tickets.some(row=>row.id===`${prefixo}_lista_${i}`));
  }
  console.log('[OK] Acordos e chamados antigos permanecem acessiveis alem de 500 registros; auditoria preserva preco anterior.');
  console.log('[OK] Exclusoes respeitam a trava e funcionam depois de sua liberacao.');
} finally { db.close(); }
