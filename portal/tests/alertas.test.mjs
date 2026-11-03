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
import { textoAviso, tituloRodada, validarRodada } from '../lib/alertas-rodadas.ts';

const hooks = registerHooks({ resolve(s, c, next) {
  if (s === 'next/server') return next('vinext/shims/server', c);
  if (s.startsWith('@/')) return next(new URL(`../${s.slice(2)}.ts`, import.meta.url).href, c);
  if (s === './database') return next(new URL('../lib/database.ts', import.meta.url).href, c);
  return next(s, c);
} });
const banco = await import('../lib/database.ts'), rota = await import('../app/api/[...path]/route.ts');
hooks.deregister();

const linha = (extra) => ({
  data: '2026-10-30', os: 146001, criador: 'Pessoa Ficticia', cidade: 'Cidade A', uf: 'PA', fornecedor: 'Oficina X',
  cnpj: '12345678000199', modelo: 'Modelo 1', item: 'Filtro de oleo', qtd: 1, precoOs: 31.25, precoAcordo: 31,
  totalOs: 31.25, totalAcordo: 31, difUnit: 0.25, difTotal: 0.25, status: 'ACIMA DO ACORDO', ...extra,
});
const resumo = {
  total_bruto: 120, total_elegivel: 100, total_quarentena: 20, percentual_quarentena_bruto: 16.7, alerta_pendencias: false,
  contagens: { CONFORME: 90, 'ACIMA DO ACORDO': 2, 'ABAIXO DO ACORDO': 1, 'SEM ACORDO': 7 },
};
const rodada = (extra) => ({ chave: '2026-10-30_1400', contexto: 'parcial', datas: ['30/10/2026'], resumo, qualidadePendente: false,
  linhas: [linha({}), linha({ os: 146002, difTotal: 6.25, difUnit: 6.25 }), linha({ status: 'ABAIXO DO ACORDO', difTotal: -4, difUnit: -4 })], ...extra });

void test('alertas: validacao, titulo e texto do aviso', () => {
  assert.throws(() => validarRodada(rodada({ chave: '../x' })));
  assert.throws(() => validarRodada(rodada({ contexto: 'outro' })));
  assert.throws(() => validarRodada(rodada({ datas: ['2026-10-30'] })));
  assert.throws(() => validarRodada(rodada({ linhas: [linha({ status: 'CONFORME' })] })));
  assert.throws(() => validarRodada(rodada({ linhas: [linha({ difTotal: 'muito' })] })));
  const v = validarRodada(rodada({}));
  assert.equal(v.linhas[0].os, '146001'); // OS numerica vira texto
  assert.equal(v.resumo.acima, 2);
  assert.equal(tituloRodada('segunda_manha', ['24/10/2026', '25/10/2026', '26/10/2026']), 'Fim de semana · 24/10/2026 a 26/10/2026');
  assert.equal(textoAviso('parcial', ['30/10/2026'], 1), 'Alertas atualizados (Parcial · 30/10/2026): 1 registro fora do acordo.');
});

void test('alertas: rodada pelo token, aviso so aos destinatarios e uma vez por horario', async t => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-alertas-fixture-'));
  const db = bancoSqliteLocal({ pastaPrivada: pasta, criar: true }), sql = new DatabaseSync(db.arquivo);
  const chave = Symbol.for('supply-vision:banco'), anterior = globalThis[chave], senha = env.INITIAL_ADMIN_PASSWORD, token = env.PORTAL_API_TOKEN;
  globalThis[chave] = db; env.INITIAL_ADMIN_PASSWORD = 'senha-ficticia-alertas'; env.PORTAL_API_TOKEN = 'token-ficticio-alertas-0123456789';
  t.after(() => { sql.close(); db.fechar(); globalThis[chave] = anterior; env.INITIAL_ADMIN_PASSWORD = senha; env.PORTAL_API_TOKEN = token; fs.rmSync(pasta, { recursive: true, force: true }); });
  await banco.ensureDatabase();
  const admin = (await db.prepare('SELECT id FROM users LIMIT 1').first()).id;
  for (const [id, role] of [['editor', 'editor'], ['viewer', 'viewer']]) {
    sql.prepare('INSERT INTO users(id,name,email,password_salt,password_hash,role,active,created_at) VALUES(?,?,?,?,?,?,1,?)')
      .run(id, `Pessoa ${id}`, `${id}@example.com`, 'salt', 'hash', role, banco.now());
  }
  for (const user of [admin, 'editor', 'viewer']) {
    await db.prepare('INSERT OR REPLACE INTO sessions(token,user_id,expires_at,last_seen_at) VALUES(?,?,?,?)')
      .bind(await banco.tokenHash(user), user, new Date(Date.now() + 3600000).toISOString(), banco.now()).run();
  }
  const pedir = async (method, url, user, body) => {
    const headers = { cookie: `acordos_session=${user}`, 'x-portal-build': PORTAL_BUILD, ...(body ? { 'content-type': 'application/json' } : {}) };
    const r = await rota[method](new NextRequest(`http://fixture/api/${url}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }));
    return { status: r.status, data: await r.json() };
  };
  const publicar = async (corpo, credencial = env.PORTAL_API_TOKEN) => {
    const r = await rota.POST(new NextRequest('http://fixture/api/internal/alertas', { method: 'POST', headers: { authorization: `Bearer ${credencial}`, 'content-type': 'application/json' }, body: JSON.stringify(corpo) }));
    return { status: r.status, data: await r.json() };
  };
  const avisos = (user) => sql.prepare("SELECT COUNT(*) n FROM notificacoes_usuario WHERE user_id=? AND tipo='alerta'").get(user).n;

  assert.equal((await publicar(rodada({}), 'errado')).status, 401);
  assert.equal((await publicar(rodada({ contexto: 'x' }))).status, 400);

  // Destinatarios: so quem edita a area escolhe; so entra quem le a aba.
  assert.equal((await pedir('GET', 'alertas/destinatarios', 'editor')).status, 403);
  assert.equal((await pedir('PUT', 'alertas/destinatarios', 'editor', { usuarios: ['editor'] })).status, 403);
  const lista = await pedir('GET', 'alertas/destinatarios', admin);
  assert.equal(lista.status, 200);
  assert.equal(lista.data.usuarios.find(u => u.id === 'viewer').podeLer, false);
  assert.equal((await pedir('PUT', 'alertas/destinatarios', admin, { usuarios: ['viewer'] })).status, 409);
  assert.equal((await pedir('PUT', 'alertas/destinatarios', admin, { usuarios: ['editor'] })).data.alterados, 1);
  assert.match(sql.prepare("SELECT details FROM audit_logs WHERE entity='alertas_destinatarios'").get().details, /Passam a receber: Pessoa editor/);

  // Rodada antiga sai pela retencao quando chega uma nova.
  sql.prepare(`INSERT INTO alertas_rodadas(id,chave,contexto,datas,resumo,linhas,acima,abaixo,dif_acima,dif_abaixo,recebida_em,atualizada_em)
    VALUES('alr_velha','velha','manha','["01/01/2026"]','{}',0,0,0,0,0,?,?)`).run('2026-01-01T12:00:00.000Z', '2026-01-01T12:00:00.000Z');

  const primeira = await publicar(rodada({}));
  assert.equal(primeira.status, 200, JSON.stringify(primeira.data));
  assert.deepEqual([primeira.data.nova, primeira.data.linhas, primeira.data.avisados], [true, 3, 1]);
  assert.equal(avisos('editor'), 1);
  assert.equal(avisos(admin), 0);
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM alertas_rodadas WHERE id='alr_velha'").get().n, 0);
  assert.match(sql.prepare("SELECT link FROM notificacoes_usuario WHERE user_id='editor'").get().link, /^\/\?aba=alertas&sub=rodadas&rodada=alr_/);

  // Mesmo horario de novo: troca o conteudo, sem duplicar nem avisar de novo.
  const segunda = await publicar(rodada({ linhas: [linha({})] }));
  assert.deepEqual([segunda.data.nova, segunda.data.id], [false, primeira.data.id]);
  assert.equal(avisos('editor'), 1);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM alertas_linhas').get().n, 1);

  // Leitura: Suprimentos e admin; Consulta nao, ate ganhar leitura no painel.
  assert.equal((await pedir('GET', 'alertas', 'viewer')).status, 403);
  await publicar(rodada({ chave: '2026-10-30_1700', contexto: 'compilado' }));
  const rodadas = await pedir('GET', 'alertas', 'editor');
  assert.equal(rodadas.status, 200);
  assert.deepEqual(rodadas.data.rodadas.map(r => r.titulo), ['Compilado final · 30/10/2026', 'Parcial · 30/10/2026']);
  assert.equal(rodadas.data.recebeAviso, true);
  const detalhe = await pedir('GET', `alertas/${rodadas.data.rodadas[0].id}`, 'editor');
  assert.deepEqual(detalhe.data.linhas.map(l => [l.status, l.difTotal]), [['ACIMA DO ACORDO', 6.25], ['ACIMA DO ACORDO', 0.25], ['ABAIXO DO ACORDO', -4]]);
  assert.equal(detalhe.data.linhas[0].criador, 'Pessoa Ficticia');
  assert.equal(detalhe.data.rodada.difAcima, 6.5);
  assert.equal((await pedir('GET', 'alertas/inexistente', 'editor')).status, 404);

  sql.prepare("INSERT INTO permissoes_usuario(user_id,area,nivel,atualizado_em) VALUES('viewer','alertas','leitura',?)").run(banco.now());
  await db.prepare('INSERT OR REPLACE INTO sessions(token,user_id,expires_at,last_seen_at) VALUES(?,?,?,?)')
    .bind(await banco.tokenHash('viewer'), 'viewer', new Date(Date.now() + 3600000).toISOString(), banco.now()).run();
  assert.equal((await pedir('GET', 'alertas', 'viewer')).status, 200);
  assert.equal((await pedir('PUT', 'alertas/destinatarios', admin, { usuarios: ['editor', 'viewer'] })).status, 200);
  await publicar(rodada({ chave: '2026-10-31_0800', contexto: 'manha', datas: ['30/10/2026'] }));
  assert.deepEqual([avisos('editor'), avisos('viewer')], [3, 1]);
});
