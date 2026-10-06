import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { verificarConsumidores } from '../scripts/saude-operacao.mjs';
void test('partida exige ambos os consumidores e supervisor recentes', () => {
  const db=new DatabaseSync(':memory:'), agora=Date.parse('2026-10-06T14:00:00Z');
  const recente=new Date(agora).toISOString(), antigo=new Date(agora-60_000).toISOString();
  const status={atualizado:recente,portal:true,emails:true,relatorios:true};
  try {
    db.exec('CREATE TABLE email_runner(id INTEGER,heartbeat_at TEXT); CREATE TABLE report_runner(id INTEGER,heartbeat_at TEXT)');
    assert.throws(()=>verificarConsumidores(db,status,agora),/Consumidor/);
    for(const t of ['email_runner','report_runner'])db.prepare(`INSERT INTO ${t} VALUES(1,?)`).run(recente);
    verificarConsumidores(db,status,agora);
    assert.throws(()=>verificarConsumidores(db,{...status,emails:false},agora),/Supervisor/);
    assert.throws(()=>verificarConsumidores(db,{...status,atualizado:antigo},agora),/Supervisor/);
    db.prepare('UPDATE report_runner SET heartbeat_at=?').run(antigo);
    assert.throws(()=>verificarConsumidores(db,status,agora),/report_runner/);
    db.prepare('UPDATE report_runner SET heartbeat_at=?').run(recente);
    db.prepare('UPDATE email_runner SET heartbeat_at=?').run('invalido');
    assert.throws(()=>verificarConsumidores(db,status,agora),/email_runner/);
  } finally { db.close(); }
});
