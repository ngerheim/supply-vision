import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { travarRestauracao } from './trava-restauracao.mjs';
import { DatabaseSync } from 'node:sqlite';

export function arquivoSqliteLocal(persistencia) {
  const pasta = path.join(persistencia, 'v3/d1/miniflare-D1DatabaseObject');
  if (!fs.existsSync(pasta)) return null;
  const arquivos = fs.readdirSync(pasta).filter(n => n.endsWith('.sqlite') && n !== 'metadata.sqlite');
  if (arquivos.length > 1) throw new Error('SQLite local ambiguo.');
  return arquivos.length ? path.join(pasta, arquivos[0]) : null;
}

/** @param {{ persistencia?: string, token: string, arquivo?: string | null, pastaRestauracao?: string | null }} options */
// Serializa apenas este executor; consumidores e expurgo tem outras conexoes.
// WAL coordena leitores, mas o segundo escritor ainda pode exceder busy_timeout.
export function criarServidorSqlite({ persistencia, token, arquivo = null, pastaRestauracao = null }) {
  if (!token || token.length < 32) throw new Error('SQLite local exige token interno.');
  let db, liberarRestauracao;
  function abrir() {
    if (db) return db;
    const alvo = arquivo || arquivoSqliteLocal(persistencia);
    if (!alvo) throw new Error('SQLite local ainda nao inicializado.');
    if (pastaRestauracao) liberarRestauracao = travarRestauracao(false, pastaRestauracao);
    let candidato;
    try {
      candidato = new DatabaseSync(alvo);
      candidato.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON');
      // A restauracao prepara a copia com journal DELETE. Retomar em sqlite
      // precisa restabelecer WAL, assim como o workerd fazia ao abrir a base.
      const journal = candidato.prepare('PRAGMA journal_mode=WAL').get();
      if (journal.journal_mode !== 'wal') throw new Error('SQLite local exige suporte a WAL.');
      db = candidato;return db;
    } catch (erro) { candidato?.close();liberarRestauracao?.();liberarRestauracao = null;throw erro; }
  }
  function consultar({ sql, values }) {
    if (typeof sql !== 'string' || !Array.isArray(values)) throw new Error('Consulta invalida.');
    const banco = abrir();
    const antes = banco.prepare('SELECT total_changes() changes').get().changes;
    const stmt = banco.prepare(sql);
    const params = values.map(v => Array.isArray(v) ? Buffer.from(v) : v);
    // all() executa tambem DDL/DML sem RETURNING (lista vazia), uma vez.
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
  function fecharBanco() { db?.close();db = null;liberarRestauracao?.();liberarRestauracao = null; }
  servidor.on('close', fecharBanco);
  servidor.encerrar = () => {
    servidor.close();servidor.closeAllConnections();fecharBanco();
  };
  return servidor;
}
