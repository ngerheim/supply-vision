// Banco proprio: ensureDatabase memoriza a primeira base do processo.
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
const { ConsultaIndisponivel, trocarConsultaPlaca } = await import('../lib/reembolso-qlik.ts');
hooks.deregister();

void test('reembolso: historico de OS consultado no Qlik sob demanda, com cache e filtros', async t => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-reembolso-hist-fixture-'));
  const db = bancoSqliteLocal({ pastaPrivada: pasta, criar: true }), sql = new DatabaseSync(db.arquivo);
  const chave = Symbol.for('supply-vision:banco'), anterior = globalThis[chave], senha = env.INITIAL_ADMIN_PASSWORD;
  globalThis[chave] = db; env.INITIAL_ADMIN_PASSWORD = 'senha-ficticia-reembolso';
  t.after(() => { trocarConsultaPlaca(null); sql.close(); db.fechar(); globalThis[chave] = anterior; env.INITIAL_ADMIN_PASSWORD = senha; fs.rmSync(pasta, { recursive: true, force: true }); });
  await banco.ensureDatabase();
  for (const [id, role] of [['viewer', 'viewer'], ['bloqueado', 'viewer'], ['editor', 'editor']]) {
    sql.prepare('INSERT INTO users(id,name,email,password_salt,password_hash,role,active,created_at) VALUES(?,?,?,?,?,?,1,?)')
      .run(id, `Pessoa ${id}`, `${id}@example.com`, 'salt', 'hash', role, banco.now());
    await db.prepare('INSERT OR REPLACE INTO sessions(token,user_id,expires_at,last_seen_at) VALUES(?,?,?,?)')
      .bind(await banco.tokenHash(id), id, new Date(Date.now() + 3600000).toISOString(), banco.now()).run();
  }
  sql.prepare("INSERT INTO permissoes_usuario(user_id,area,nivel,atualizado_em) VALUES('bloqueado','reembolso','sem',?)").run(banco.now());
  sql.prepare("INSERT INTO reembolso_clientes(id,nome,taxa,ativo,atualizado_em) VALUES('cli-1','Cliente Exemplo',0.2,1,?)").run(banco.now());
  const pedir = async (method, url, user, body) => {
    const headers = { cookie: `acordos_session=${user}`, 'x-portal-build': PORTAL_BUILD, ...(body ? { 'content-type': 'application/json' } : {}) };
    const r = await rota[method](new NextRequest(`http://fixture/api/${url}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }));
    return { status: r.status, data: await r.json() };
  };
  const l = (data, os, produto, km, grupo = 'Manutenção') => ({ data, os, produto, qtd: 1, valorUnit: 50, total: 50, reembolso: 0, km, fornecedor: 'Oficina Exemplo', grupo, modelo: 'Picape', cliente: 'Cliente Exemplo' });
  const consultas = [];
  let resposta = [l('2026-10-01', '10', 'FILTRO DE AR', 30000), l('2026-10-05', '20', 'LAVAGEM', 32000, 'Lava Jato'), l('2026-10-05', '20', 'PALHETA', 32000)];
  trocarConsultaPlaca(async placa => { consultas.push(placa); if (resposta instanceof Error) throw resposta; return resposta; });

  // Sem cache: consulta o Qlik e guarda; a segunda vez sai do cache.
  const primeira = await pedir('GET', 'reembolso/historico?placa=exe-1a23', 'viewer');
  assert.equal(primeira.status, 200);
  assert.deepEqual(primeira.data.linhas.map(x => [x.data, x.produto]), [['2026-10-05', 'LAVAGEM'], ['2026-10-05', 'PALHETA'], ['2026-10-01', 'FILTRO DE AR']]);
  assert.equal((await pedir('GET', 'reembolso/historico?placa=EXE1A23', 'viewer')).data.linhas.length, 3);
  assert.deepEqual(consultas, ['EXE1A23']);
  assert.deepEqual(primeira.data.veiculo, { cliente: 'Cliente Exemplo', modelo: 'Picape', data: '2026-10-05', clienteId: 'cli-1' });
  assert.equal((await pedir('GET', 'reembolso/historico/aquecer', 'viewer')).status, 202);
  assert.equal((await pedir('GET', 'reembolso/historico/aquecer', 'bloqueado')).status, 403);
  assert.equal((await pedir('GET', 'reembolso/historico?placa=EXE1A23', 'bloqueado')).status, 403);
  assert.equal((await pedir('GET', 'reembolso/historico?placa=X', 'viewer')).status, 400);

  // Filtro: so Suprimentos inclui; vale na hora, inclusive para o cache.
  assert.equal((await pedir('POST', 'reembolso/historico/filtros', 'viewer', { coluna: 'grupo', modo: 'igual', valor: 'lava jato' })).status, 403);
  assert.equal((await pedir('GET', 'reembolso/historico/filtros', 'viewer')).status, 403);
  const criado = await pedir('POST', 'reembolso/historico/filtros', 'editor', { coluna: 'grupo', modo: 'igual', valor: 'LAVA JATO' });
  assert.equal(criado.status, 201);
  assert.equal((await pedir('POST', 'reembolso/historico/filtros', 'editor', { coluna: 'grupo', modo: 'igual', valor: 'lava  jato' })).status, 409);
  const filtrada = (await pedir('GET', 'reembolso/historico?placa=EXE1A23', 'viewer')).data;
  assert.deepEqual([filtrada.filtradas, filtrada.linhas.map(x => x.produto)], [1, ['PALHETA', 'FILTRO DE AR']]);
  assert.deepEqual(consultas, ['EXE1A23']);
  const tela = (await pedir('GET', 'reembolso/historico/filtros', 'editor')).data;
  assert.deepEqual(tela.filtros.map(f => [f.coluna, f.modo, f.valor]), [['grupo', 'igual', 'LAVA JATO']]);
  assert.deepEqual(tela.recentes.map(r => [r.placa, r.itens, r.autor]), [['EXE1A23', 3, 'Pessoa viewer']]);
  assert.deepEqual((await pedir('GET', 'reembolso/historico/valores?coluna=grupo&q=manu', 'editor')).data.valores, [{ valor: 'Manutenção', n: 2 }]);
  assert.equal((await pedir('GET', 'reembolso/historico/valores?coluna=placa', 'editor')).status, 400);
  assert.match(sql.prepare("SELECT details FROM audit_logs WHERE entity='reembolso_historico_filtro' ORDER BY rowid DESC LIMIT 1").get().details, /LAVA JATO" fica fora/);
  assert.equal((await pedir('DELETE', `reembolso/historico/filtros/${criado.data.id}`, 'viewer')).status, 403);
  assert.equal((await pedir('DELETE', `reembolso/historico/filtros/${criado.data.id}`, 'editor')).status, 200);
  assert.equal((await pedir('GET', 'reembolso/historico?placa=EXE1A23', 'viewer')).data.linhas.length, 3);

  // Atualizar forca o Qlik; Qlik fora do ar devolve o cache com aviso, e sem cache, 502 com a causa.
  resposta = [l('2026-11-01', '30', 'PASTILHA', 40000)];
  assert.deepEqual((await pedir('GET', 'reembolso/historico?placa=EXE1A23&atualizar=1', 'viewer')).data.linhas.map(x => x.produto), ['PASTILHA']);
  resposta = new ConsultaIndisponivel('O Qlik demorou demais para responder.');
  const velha = (await pedir('GET', 'reembolso/historico?placa=EXE1A23&atualizar=1', 'viewer')).data;
  assert.deepEqual([velha.linhas.map(x => x.produto), /Qlik indisponível/.test(velha.aviso)], [['PASTILHA'], true]);
  const semCache = await pedir('GET', 'reembolso/historico?placa=OUT9Z99', 'viewer');
  assert.deepEqual([semCache.status, /demorou demais.*à mão/.test(semCache.data.error)], [502, true]);
  // Resposta fora do formato nao vai para o cache.
  resposta = [{ data: 'ontem', produto: 'X' }];
  assert.equal((await pedir('GET', 'reembolso/historico?placa=NOV0A00', 'viewer')).status, 502);
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM reembolso_historico_cache WHERE placa='NOV0A00'").get().n, 0);
});
