import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export function arquivoSqliteLocal(persistencia) {
  const pasta = path.join(persistencia, 'v3/d1/miniflare-D1DatabaseObject');
  if (!fs.existsSync(pasta)) return null;
  const arquivos = fs.readdirSync(pasta).filter(n => n.endsWith('.sqlite') && n !== 'metadata.sqlite');
  if (arquivos.length > 1) throw new Error('SQLite local ambiguo.');
  return arquivos.length ? path.join(pasta, arquivos[0]) : null;
}

/** @param {{ persistencia?: string, token: string, arquivo?: string | null }} options */
export function criarServidorSqlite({ persistencia, token, arquivo = null }) {
  if (!token || token.length < 32) throw new Error('SQLite local exige token interno.');
  let db;
  function abrir() {
    if (db) return db;
    const alvo = arquivo || arquivoSqliteLocal(persistencia);
    if (!alvo) throw new Error('SQLite local ainda nao inicializado.');
    db = new DatabaseSync(alvo);
    db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON');
    return db;
  }
  function consultar({ sql, values }) {
    if (typeof sql !== 'string' || !Array.isArray(values)) throw new Error('Consulta invalida.');
    const banco = abrir();
    const antes = banco.prepare('SELECT total_changes() changes').get().changes;
    const stmt = banco.prepare(sql);
    const params = values.map(v => Array.isArray(v) ? Buffer.from(v) : v);
    // all() executa tambem DDL/DML sem RETURNING (lista vazia), uma vez.
    // Evita columns(), ausente no Node minimo 22.13.
    const results = stmt.all(...params).map(row => Object.fromEntries(Object.entries(row).map(([k,v]) => [k, v instanceof Uint8Array ? Array.from(v) : v])));
    const meta = banco.prepare('SELECT total_changes() changes,last_insert_rowid() last_row_id').get();
    return { results, meta: { changes: meta.changes - antes, last_row_id: meta.last_row_id } };
  }
  const servidor = http.createServer(async (req, res) => {
    res.setHeader('Connection', 'close');res.setHeader('Content-Type', 'application/json');
    const recebido = Buffer.from(req.headers.authorization || '');
    const esperado = Buffer.from(`Bearer ${token}`);
    if (recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) { res.writeHead(403);res.end('{"success":false}');return; }
    try {
      if (req.url === '/ready' && req.method === 'GET') { res.end(JSON.stringify({ pronto: !!(arquivo || arquivoSqliteLocal(persistencia)) }));return; }
      if (req.url !== '/sql' || req.method !== 'POST') { res.writeHead(404);res.end('{"success":false}');return; }
      let tamanho = 0;const partes = [];
      for await (const parte of req) { tamanho += parte.length;if (tamanho > 16 * 1024 * 1024) { res.writeHead(413);res.end('{"success":false,"error":"Consulta grande demais."}');return; }partes.push(parte); }
      const { operacao, consultas } = JSON.parse(Buffer.concat(partes).toString());
      if (!Array.isArray(consultas) || !consultas.length) throw new Error('Consultas ausentes.');
      const banco = abrir();let resultados;
      if (operacao === 'batch') {
        // Inclusive os leitores recebem um snapshot unico. BEGIN adiado nao
        // toma a reserva do escritor externo quando o lote so faz SELECT.
        banco.exec(consultas.every(c => /^\s*SELECT\b/i.test(c.sql)) ? 'BEGIN' : 'BEGIN IMMEDIATE');
        try { resultados = consultas.map(consultar);banco.exec('COMMIT'); }
        catch (erro) { banco.exec('ROLLBACK');throw erro; }
      } else if (operacao === 'consulta') resultados = consultas.map(consultar);
      else if (operacao === 'exec' && consultas.length === 1) { banco.exec(consultas[0].sql);resultados = []; }
      else throw new Error('Operacao invalida.');
      res.end(JSON.stringify({ success: true, resultados }));
    } catch (erro) { res.writeHead(500);res.end(JSON.stringify({ success: false, error: erro instanceof Error ? erro.message : 'Falha SQL.' })); }
  });
  servidor.on('close', () => { db?.close();db = null; });
  return servidor;
}
