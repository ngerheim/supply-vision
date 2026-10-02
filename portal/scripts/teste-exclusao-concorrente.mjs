import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { realpathSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';

// Chamado somente pelo teste de instalacao nova, com seu banco descartavel.
const porta = Number(process.env.PORTAL_TESTE_PORTA);
const [raiz, arquivo] = process.argv.slice(2);
if (process.env.PORTAL_TESTE_DESCARTAVEL !== 'SIM' || porta !== 3199 || !raiz || !arquivo) {
  throw new Error('Este teste exige a instalacao descartavel na porta 3199.');
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
  for (const rota of [`items/${item}`, `agreements/${acordo}`]) {
    const response = await fetch(`${url}/api/${rota}`, { method: 'DELETE', headers });
    assert.equal(response.status, 200, await response.text());
  }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM agreements WHERE id=?').get(acordo).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM travas WHERE chave=?').get(`acordo:${acordo}`).n, 0);
  const jsonHeaders={...headers,'content-type':'application/json'};
  const criado=await fetch(`${url}/api/tickets`,{method:'POST',headers:jsonHeaders,body:JSON.stringify({supplierName:prefixo})});
  assert.equal(criado.status,201);const ticketId=(await criado.json()).id;
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
    const response=await fetch(`${url}/api/tickets/${ticketId}`,{method,headers:jsonHeaders,body:JSON.stringify(body)});
    assert.equal(response.status,status,await response.text());
    assert.equal(db.prepare('SELECT COUNT(*) n FROM travas WHERE chave=?').get(chave).n,0);
  }
  console.log('[OK] Edicoes e andamentos respeitam a trava do chamado e liberam apos validacao.');
  console.log('[OK] Exclusoes respeitam a trava e funcionam depois de sua liberacao.');
} finally { db.close(); }
