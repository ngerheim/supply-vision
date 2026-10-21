import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { bancoSqliteLocal } from '../lib/sqlite-local.ts';
import { env } from '../scripts/configuracao-servidor.mjs';
import { NextRequest } from 'vinext/shims/server';
import { SESSAO_INATIVIDADE_MS } from '../lib/politica-sessao.ts';
import { comContextoEscrita, definirAutorEscrita, SessaoRevogada } from '../lib/autor-escrita.ts';

const hook = registerHooks({ resolve(s, c, next) {
  if (s === 'next/server') return next('vinext/shims/server', c);
  if (s.startsWith('@/')) return next(new URL(`../${s.slice(2)}.ts`, import.meta.url).href, c);
  if (s === './database') return next(new URL('../lib/database.ts', import.meta.url).href, c);
  return next(s, c);
} });
const banco = await import('../lib/database.ts');
const rota = await import('../app/api/[...path]/route.ts');
hook.deregister();

void test('guarda transacional usa o mesmo limite de inatividade da sessao', async t => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-inatividade-escrita-'));
  const db = bancoSqliteLocal({ pastaPrivada: pasta, criar: true });
  t.after(() => { db.fechar(); fs.rmSync(pasta, {recursive: true, force: true}); });
  await db.exec('CREATE TABLE users(id TEXT,role TEXT,active INTEGER); CREATE TABLE sessions(token TEXT,user_id TEXT,expires_at TEXT,last_seen_at TEXT); CREATE TABLE prova(n INTEGER)');
  const agora = Date.now();
  t.mock.method(Date, 'now', () => agora);
  await db.prepare("INSERT INTO users VALUES('u','editor',1)").run();
  await db.prepare("INSERT INTO sessions VALUES('t','u',?,?)").bind(new Date(agora + 60000).toISOString(), new Date(agora - SESSAO_INATIVIDADE_MS).toISOString()).run();
  const escrever = () => comContextoEscrita(async () => {
    definirAutorEscrita({id: 'u', role: 'editor', token: 't'});
    return db.prepare('INSERT INTO prova VALUES(1)').run();
  });
  await escrever();
  await db.prepare('UPDATE sessions SET last_seen_at=?').bind(new Date(agora - SESSAO_INATIVIDADE_MS - 1).toISOString()).run();
  await assert.rejects(escrever, SessaoRevogada);
  assert.equal(await db.prepare('SELECT COUNT(*) n FROM prova').first('n'), 1);
  assert.equal(banco.SESSAO_INATIVIDADE_MS, SESSAO_INATIVIDADE_MS);
});

void test('revogacao durante leitura do corpo impede escrita e auditoria no roteador', async t => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-sessao-escrita-'));
  const db = bancoSqliteLocal({ pastaPrivada: pasta, criar: true });
  const chave = Symbol.for('supply-vision:banco'), anterior = globalThis[chave], senha = env.INITIAL_ADMIN_PASSWORD;
  globalThis[chave] = db; env.INITIAL_ADMIN_PASSWORD = 'senha-ficticia-sessao';
  const externo = new DatabaseSync(db.arquivo);
  t.after(() => { externo.close(); db.fechar(); globalThis[chave] = anterior; env.INITIAL_ADMIN_PASSWORD = senha; fs.rmSync(pasta, { recursive: true, force: true }); });
  await banco.ensureDatabase();
  const autor = await db.prepare('SELECT id FROM users LIMIT 1').first();
  const token = 'token-ficticio-sessao';
  await db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES(?,?,?,?)').bind(await banco.tokenHash(token), autor.id, new Date(Date.now() + 60000).toISOString(), new Date().toISOString()).run();
  let revogou = false;
  const body = new ReadableStream({ pull(c) {
    externo.prepare('UPDATE users SET active=0 WHERE id=?').run(autor.id);
    externo.prepare('DELETE FROM sessions WHERE user_id=?').run(autor.id);
    revogou = true;
    c.enqueue(new TextEncoder().encode(JSON.stringify({ name: 'Item apos revogacao' }))); c.close();
  } }, { highWaterMark: 0 });
  const resposta = await rota.POST(new NextRequest('http://fixture/api/catalogs/items', { method: 'POST', headers: { cookie: `acordos_session=${token}` }, body, duplex: 'half' }));
  assert.equal(revogou, true);
  assert.equal(resposta.status, 403);
  assert.match((await resposta.json()).error, /permiss|sessão|sessao/i);
  assert.equal(await db.prepare("SELECT COUNT(*) n FROM catalog_items WHERE name='Item apos revogacao'").first('n'), 0);
  assert.equal(await db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity='catalog_item'").first('n'), 0);
});
