import './apoio/logs-email.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { NextRequest } from 'vinext/shims/server';
import { bancoSqliteLocal } from '../lib/sqlite-local.ts';
import { env } from '../scripts/configuracao-servidor.mjs';
import { PORTAL_BUILD } from '../lib/portal-build.ts';

const hooks = registerHooks({ resolve(s, c, next) {
  if (s === 'next/server') return next('vinext/shims/server', c);
  if (s.startsWith('@/')) return next(new URL(`../${s.slice(2)}.ts`, import.meta.url).href, c);
  if (s === './database') return next(new URL('../lib/database.ts', import.meta.url).href, c);
  return next(s, c);
} });
const banco = await import('../lib/database.ts'), rota = await import('../app/api/[...path]/route.ts');
hooks.deregister();

void test('painel de permissoes: matriz, gravacao, bloqueio na API, sessoes e auditoria', async t => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-permissoes-fixture-'));
  const db = bancoSqliteLocal({ pastaPrivada: pasta, criar: true }), sql = new DatabaseSync(db.arquivo);
  const chave = Symbol.for('supply-vision:banco'), anterior = globalThis[chave], senha = env.INITIAL_ADMIN_PASSWORD;
  globalThis[chave] = db; env.INITIAL_ADMIN_PASSWORD = 'senha-ficticia-permissoes-api';
  t.after(() => { sql.close(); db.fechar(); globalThis[chave] = anterior; env.INITIAL_ADMIN_PASSWORD = senha; fs.rmSync(pasta, { recursive: true, force: true }); });
  await banco.ensureDatabase();
  const admin = (await db.prepare('SELECT id FROM users LIMIT 1').first()).id;
  for (const [id, role] of [['editor', 'editor'], ['viewer', 'viewer']]) {
    sql.prepare('INSERT INTO users(id,name,email,password_salt,password_hash,role,active,created_at) VALUES(?,?,?,?,?,?,1,?)')
      .run(id, `Pessoa ${id}`, `${id}@example.com`, 'salt', 'hash', role, banco.now());
  }
  const abrirSessoes = async () => {
    for (const user of [admin, 'editor', 'viewer']) {
      await db.prepare('INSERT OR REPLACE INTO sessions(token,user_id,expires_at,last_seen_at) VALUES(?,?,?,?)')
        .bind(await banco.tokenHash(user), user, new Date(Date.now() + 3600000).toISOString(), banco.now()).run();
    }
  };
  await abrirSessoes();
  const pedir = async (method, url, user, body) => {
    const headers = { cookie: `acordos_session=${user}`, 'x-portal-build': PORTAL_BUILD, ...(body ? { 'content-type': 'application/json' } : {}) };
    const r = await rota[method](new NextRequest(`http://fixture/api/${url}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }));
    return { status: r.status, data: r.headers.get('content-type')?.includes('json') ? await r.json() : null };
  };

  // Tabela nasce vazia: ninguem muda de acesso com a migracao.
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM permissoes_usuario').get().n, 0);

  // Só admin consulta e grava o painel.
  assert.equal((await pedir('GET', 'permissoes', 'editor')).status, 403);
  assert.equal((await pedir('PUT', 'permissoes', 'editor', { usuarios: [] })).status, 403);
  const matriz = await pedir('GET', 'permissoes', admin);
  assert.equal(matriz.status, 200);
  const editor = matriz.data.usuarios.find(u => u.id === 'editor'), viewer = matriz.data.usuarios.find(u => u.id === 'viewer');
  assert.equal(editor.niveis.pagamentos, 'edicao');
  assert.equal(viewer.niveis.pagamentos, 'leitura');
  assert.equal(viewer.niveis.acordos, 'sem');

  // Antes do ajuste o editor consulta pagamentos.
  assert.equal((await pedir('GET', 'pagamentos', 'editor')).status, 200);

  // Valores invalidos sao recusados sem gravar nada.
  assert.equal((await pedir('PUT', 'permissoes', admin, { usuarios: [{ id: 'editor', niveis: { pagamentos: 'tudo' } }] })).status, 400);
  assert.equal((await pedir('PUT', 'permissoes', admin, { usuarios: [{ id: 'editor', niveis: { inventada: 'sem' } }] })).status, 400);
  assert.equal((await pedir('PUT', 'permissoes', admin, { usuarios: [{ id: 'fantasma', niveis: {} }] })).status, 409);

  const salvo = await pedir('PUT', 'permissoes', admin, { usuarios: [
    { id: 'editor', niveis: { pagamentos: 'sem', relatorios: 'leitura' } },
    { id: 'viewer', niveis: { acordos: 'leitura', buscar: 'leitura' } },
    { id: admin, niveis: { acordos: 'sem' } },
  ] });
  assert.equal(salvo.status, 200, JSON.stringify(salvo.data));
  assert.equal(salvo.data.alterados, 2);
  // So o que difere do padrao vira linha; admin nao recebe ajuste.
  assert.deepEqual(sql.prepare('SELECT user_id,area,nivel FROM permissoes_usuario ORDER BY user_id,area').all().map(r => ({ ...r })), [
    { user_id: 'editor', area: 'pagamentos', nivel: 'sem' },
    { user_id: 'editor', area: 'relatorios', nivel: 'leitura' },
    { user_id: 'viewer', area: 'acordos', nivel: 'leitura' },
  ]);
  // Sessoes dos alterados encerradas; a do admin continua.
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id IN (?,?)').get('editor', 'viewer').n, 0);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id=?').get(admin).n, 1);
  const auditoria = sql.prepare("SELECT details FROM audit_logs WHERE entity='user' AND entity_id='editor' ORDER BY created_at DESC LIMIT 1").get().details;
  assert.match(auditoria, /Chamados › Pagamentos: Ler e editar → Sem acesso/);
  assert.match(auditoria, /Administração › Relatórios: Sem acesso → Somente leitura/);

  await abrirSessoes();
  // Sem acesso: 403 na API e sub-aba fora da sessao.
  assert.equal((await pedir('GET', 'pagamentos', 'editor')).status, 403);
  const sessao = await pedir('GET', 'session', 'editor');
  assert.deepEqual(sessao.data.user.permissoes, { pagamentos: 'sem', relatorios: 'leitura' });
  // Leitura amplia alem do perfil, sem liberar execucao.
  assert.equal((await pedir('GET', 'reports', 'editor')).status, 200);
  assert.equal((await pedir('POST', 'reports', 'editor', { action: 'recorte' })).status, 403);
  // Consulta com leitura em Acordos ve a gestao, mas nao edita.
  assert.equal((await pedir('GET', 'imports', 'viewer')).status, 403);
  assert.equal((await pedir('GET', 'tickets', 'viewer')).status, 403);
  const bootstrap = await pedir('GET', 'bootstrap', 'viewer');
  assert.equal(bootstrap.status, 200);
  assert.ok(Array.isArray(bootstrap.data.agreements));
  assert.equal((await pedir('POST', 'agreements', 'viewer', { number: 'X' })).status, 403);

  // Voltar ao padrao remove os ajustes.
  const reverter = await pedir('PUT', 'permissoes', admin, { usuarios: [{ id: 'editor', niveis: { pagamentos: 'edicao', relatorios: 'sem' } }] });
  assert.equal(reverter.status, 200);
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM permissoes_usuario WHERE user_id='editor'").get().n, 0);
});
