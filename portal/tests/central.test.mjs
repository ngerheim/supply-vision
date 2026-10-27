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
import { expurgar, configurarExpurgo } from '../scripts/expurgar-dados.mjs';
import { criarCopiaIntegra } from '../scripts/backup.mjs';
import { prepararRestauracao } from '../scripts/restauracao-segura.mjs';
import { validarBanco } from '../scripts/validar-banco.mjs';

const hooks = registerHooks({ resolve(s, c, next) {
  if (s === 'next/server') return next('vinext/shims/server', c);
  if (s.startsWith('@/')) return next(new URL(`../${s.slice(2)}.ts`, import.meta.url).href, c);
  if (s === './database') return next(new URL('../lib/database.ts', import.meta.url).href, c);
  return next(s, c);
} });
const banco = await import('../lib/database.ts');
const rota = await import('../app/api/[...path]/route.ts');
const { prepararNotificacaoUsuario } = await import('../lib/central-notificacoes.ts');
hooks.deregister();

void test('Central com roteador, migracao e SQLite reais', async t => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-central-'));
  const db = bancoSqliteLocal({ pastaPrivada: pasta, criar: true });
  const chave = Symbol.for('supply-vision:banco'), anterior = globalThis[chave], senha = env.INITIAL_ADMIN_PASSWORD;
  globalThis[chave] = db; env.INITIAL_ADMIN_PASSWORD = 'senha-ficticia-central';
  const sql = new DatabaseSync(db.arquivo);
  t.after(() => { sql.close(); db.fechar(); globalThis[chave] = anterior; env.INITIAL_ADMIN_PASSWORD = senha; fs.rmSync(pasta, { recursive: true, force: true }); });
  await banco.ensureDatabase();
  const admin = (await db.prepare('SELECT id FROM users LIMIT 1').first()).id;
  for (const [id, role] of [['a','editor'], ['b','editor'], ['v','viewer']]) {
    await db.prepare('INSERT INTO users(id,name,email,password_salt,password_hash,role,active,created_at) VALUES(?,?,?,?,?,?,1,?)')
    .bind(id, `Pessoa ${String(id)}`, `${String(id)}@example.com`, 'salt', 'hash', role, banco.now()).run();
  }
  for (const id of [admin, 'a', 'b', 'v']) await db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES(?,?,?,?)')
    .bind(await banco.tokenHash(id), id, new Date(Date.now()+3600000).toISOString(), new Date(Date.now()-120000).toISOString()).run();
  const req = (method, caminho, user = admin, body, build = PORTAL_BUILD, polling = false) => new NextRequest(`http://fixture/api/${caminho}`, {
    method, headers: { cookie: `acordos_session=${String(user)}`, 'content-type':'application/json', 'x-portal-build':build, ...(polling ? {'x-portal-poll':'1'} : {}) },
    ...(body ? { body:JSON.stringify(body) } : {}),
  });
  const get = async (caminho, user) => (await rota.GET(req('GET', caminho, user))).json();
  const post = (caminho, user, body) => rota.POST(req('POST', caminho, user, body));
  const notificar = user => prepararNotificacaoUsuario({ destinatario:user, tipo:'teste', texto:'Mensagem ficticia', link:'/?chamado=ficticio' });

  await t.test('banco novo tem migracao e indice parcial; notificacao valida link relativo', async () => {
    assert.ok(sql.prepare('SELECT 1 FROM schema_migrations WHERE version=8').get());
    assert.ok(sql.prepare("SELECT sql FROM sqlite_schema WHERE name='idx_central_nao_lidas'").get().sql.includes('WHERE lida_em IS NULL'));
    for (const link of ['https://example.com', '//example.com', '/\u005cexample.com', '/a\rb', '/a\nb', '/a\tb']) {
      assert.throws(() => prepararNotificacaoUsuario({destinatario:'a',tipo:'x',texto:'Texto',link}), /Link da notificação inválido/);
    }
    assert.doesNotThrow(() => prepararNotificacaoUsuario({destinatario:'a',tipo:'x',texto:'Texto',link:'/?chamado=ID'}));
  });
  await t.test('listar, contar, detalhe e marcar isolam usuarios, inclusive perfil de consulta', async () => {
    await db.batch([notificar('a'), notificar('a'), notificar('b'), notificar('v')]);
    const lista = (await get('central', 'a')).notificacoes;
    assert.equal(lista.length, 2);
    assert.deepEqual(await get('central/nao-lidas','a'), {naoLidas:2});
    const outro = (await get('central','b')).notificacoes[0];
    assert.ok(!lista.some(n => n.id === outro.id));
    for (const id of [outro.id, 'ausente']) {
      assert.equal((await rota.GET(req('GET',`central/${id}`,'a'))).status,404);
      assert.equal((await post(`central/${id}/lida`,'a')).status,404);
    }
    assert.equal((await post(`central/${lista[0].id}/lida`,'a')).status,200);
    const data = (await get(`central/${lista[0].id}`,'a')).notificacao.lida_em;
    assert.ok(data);
    assert.equal((await post(`central/${lista[0].id}/lida`,'a')).status,200);
    assert.equal((await get(`central/${lista[0].id}`,'a')).notificacao.lida_em,data);
    assert.deepEqual(await get('central/nao-lidas','a'),{naoLidas:1});
    assert.equal((await post('central/lidas','a')).status,200);
    assert.deepEqual(await get('central/nao-lidas','a'),{naoLidas:0});
    assert.deepEqual(await get('central/nao-lidas','b'),{naoLidas:1});
    assert.equal((await post('central/lidas','v')).status,200);
    assert.deepEqual(await get('central/nao-lidas','v'),{naoLidas:0});
    await db.batch(Array.from({length:35}, () => notificar('a')));
    assert.equal((await get('central','a')).notificacoes.length,30);
    assert.deepEqual(await get('central/nao-lidas','a'),{naoLidas:35});
  });
  const snapshot = () => JSON.stringify(sql.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(({name}) => [name,sql.prepare(`SELECT * FROM "${String(name)}" ORDER BY rowid`).all()]));
  await t.test('build divergente e polling com sessao vencida nao gravam nada', async () => {
    const antes = snapshot();
    for (const caminho of ['central/lidas', 'central/ausente/lida']) assert.equal((await rota.POST(req('POST',caminho,'a',null,'build-antigo'))).status,409);
    assert.equal(snapshot(),antes);
    const lastSeen = sql.prepare('SELECT last_seen_at FROM sessions WHERE user_id=?').get('b').last_seen_at;
    const resposta = await rota.GET(req('GET','central/nao-lidas','b',null,PORTAL_BUILD,true));
    assert.equal(resposta.status,200); assert.equal(resposta.headers.get('x-portal-build'),PORTAL_BUILD);
    assert.equal(sql.prepare('SELECT last_seen_at FROM sessions WHERE user_id=?').get('b').last_seen_at,lastSeen);
    sql.prepare('UPDATE sessions SET last_seen_at=? WHERE user_id=?').run('2000-01-01T00:00:00.000Z','b');
    const vencida = snapshot();
    assert.equal((await rota.GET(req('GET','central/nao-lidas','b',null,PORTAL_BUILD,true))).status,401);
    assert.equal(snapshot(),vencida);
    assert.equal((await rota.GET(req('GET','central','sem-sessao'))).status,401);
    sql.prepare('UPDATE sessions SET last_seen_at=? WHERE user_id=?').run(banco.now(),'b');
  });
  await t.test('produtores usam eventos e destinatarios dos emails, excluindo autor', async () => {
    sql.exec('DELETE FROM notificacoes_usuario');
    const criar = await post('tickets',admin,{supplierName:'OFICINA FICTICIA',assignedTo:'a'});
    assert.equal(criar.status,201); const ticket = await criar.json();
    assert.equal((await get('central','a')).notificacoes[0].link,`/?chamado=${ticket.id}`);
    const mudar = async body => {
      const detalhe = await get(`tickets/${ticket.id}`,admin);
      assert.equal((await rota.PUT(req('PUT',`tickets/${ticket.id}`,admin,{...body,expectedRevision:detalhe.ticket.revision}))).status,200);
    };
    await mudar({assignedTo:'b'});
    assert.equal((await post(`tickets/${ticket.id}/events`,'a',{message:'Andamento ficticio'})).status,201);
    await mudar({status:'fechado'});
    await mudar({status:'cancelado'});
    const emails = sql.prepare('SELECT e.type,e.recipient_user_id,v.user_id autor FROM email_notifications e JOIN ticket_events v ON v.id=e.event_id ORDER BY e.created_at,e.id').all();
    const esperados = emails.filter(e => e.recipient_user_id !== e.autor).map(e => `${String(e.recipient_user_id)}:chamado_${String(e.type)}`).sort();
    const centrais = sql.prepare('SELECT user_id,tipo FROM notificacoes_usuario').all().map(n => `${String(n.user_id)}:${String(n.tipo)}`).sort();
    assert.deepEqual(centrais,esperados);
    assert.ok(emails.some(e => e.recipient_user_id === e.autor),'Email do autor continua na fila');
    const quantidade = centrais.length;
    const propria = await post('tickets','a',{supplierName:'OFICINA FICTICIA',assignedTo:'a'});
    assert.equal(propria.status,201);
    assert.equal(sql.prepare('SELECT COUNT(*) n FROM notificacoes_usuario').get().n,quantidade);
    // A causa falha depois da notificacao no mesmo lote: ambos desaparecem.
    const antes = snapshot();
    await assert.rejects(db.batch([notificar('a'),db.prepare("INSERT INTO ticket_events(id,ticket_id,kind,created_at) VALUES('falha','chamado-ausente','note','2026-01-01')")]),/FOREIGN KEY/);
    assert.equal(snapshot(),antes);
    // Falha real no produtor, depois de atualizar o chamado e antes dos INSERTs.
    sql.exec("CREATE TRIGGER falhar_evento BEFORE INSERT ON ticket_events BEGIN SELECT RAISE(ABORT,'falha ficticia da causa'); END");
    const antesProdutor = snapshot();
    const log = console.error; console.error = () => {};
    try { assert.equal((await post(`tickets/${ticket.id}/events`,'a',{message:'Deve falhar'})).status,500); }
    finally { console.error = log; }
    assert.equal(snapshot(),antesProdutor);
    sql.exec('DROP TRIGGER falhar_evento');
  });
  await t.test('expurgo apaga lidas e nao lidas ha mais de 90 dias e backup/restauracao preservam a Central', async () => {
    sql.exec('DELETE FROM notificacoes_usuario');
    const agora = new Date('2026-10-22T12:00:00.000Z');
    const data = dias => new Date(agora.getTime()-dias*86400000).toISOString();
    for (const [id,criada,lida] of [['antiga',data(200),data(91)],['limite',data(200),data(90)],['recente',data(1),null],['nao-lida-antiga',data(91),null],['nao-lida-limite',data(90),null]])
      sql.prepare('INSERT INTO notificacoes_usuario(id,user_id,tipo,texto,link,criada_em,lida_em) VALUES(?,?,?,?,?,?,?)').run(id,'a','teste','Ficticio','/',criada,lida);
    const antes = sql.prepare('SELECT * FROM notificacoes_usuario ORDER BY id').all();
    const copia = criarCopiaIntegra(db.arquivo,path.join(pasta,'backup.sqlite'));
    const restaurada = path.join(pasta,'restaurada.sqlite');
    prepararRestauracao(copia,restaurada,validarBanco);
    const restaurado = new DatabaseSync(restaurada);
    try { assert.deepEqual(restaurado.prepare('SELECT * FROM notificacoes_usuario ORDER BY id').all(),antes); }
    finally { restaurado.close(); }
    const resultado = expurgar(sql,configurarExpurgo({EXPURGO_HABILITADO:'1',EXPURGO_EMAILS_DIAS:'0',EXPURGO_RELATORIOS_DIAS:'0',EXPURGO_IMPORTACOES_DIAS:'0'}),agora);
    assert.equal(resultado.notificacoes_usuario,2);
    assert.deepEqual(sql.prepare('SELECT id FROM notificacoes_usuario ORDER BY id').all().map(n => n.id),['limite','nao-lida-limite','recente']);
  });
});
