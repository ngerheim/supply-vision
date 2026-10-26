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
import { CNPJS_ENSAIO, cnpjFicticio } from '../lib/consultas-fornecedor-ensaio.ts';
import { autorEscrita, acaoEscritaAutorizada, comAcaoEscrita, comContextoEscrita, definirAutorEscrita, SessaoRevogada } from '../lib/autor-escrita.ts';
import { criarCopiaIntegra } from '../scripts/backup.mjs';
import { prepararRestauracao } from '../scripts/restauracao-segura.mjs';
import { validarBanco } from '../scripts/validar-banco.mjs';
import { expurgar, configurarExpurgo } from '../scripts/expurgar-dados.mjs';
import { processarNotificacoes } from '../scripts/processar-emails.mjs';
import { montarEmailSolicitacao } from '../lib/email-solicitacoes.ts';

const hooks = registerHooks({ resolve(s, c, next) {
  if (s === 'next/server') return next('vinext/shims/server', c);
  if (s.startsWith('@/')) return next(new URL(`../${s.slice(2)}.ts`, import.meta.url).href, c);
  if (s === './database') return next(new URL('../lib/database.ts', import.meta.url).href, c);
  return next(s, c);
} });
const banco = await import('../lib/database.ts');
const rota = await import('../app/api/[...path]/route.ts');
hooks.deregister();

void test('Cadastro de fornecedor pelo roteador e SQLite reais', async t => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-solicitacoes-'));
  const db = bancoSqliteLocal({ pastaPrivada: pasta, criar: true }), sql = new DatabaseSync(db.arquivo);
  const chave = Symbol.for('supply-vision:banco'), anterior = globalThis[chave], senha = env.INITIAL_ADMIN_PASSWORD, modo = process.env.MODO_ENSAIO;
  globalThis[chave] = db; env.INITIAL_ADMIN_PASSWORD = 'senha-ficticia-cadastro'; process.env.MODO_ENSAIO = '1';
  t.after(() => { sql.close(); db.fechar(); globalThis[chave] = anterior; env.INITIAL_ADMIN_PASSWORD = senha; if (modo === undefined) delete process.env.MODO_ENSAIO; else process.env.MODO_ENSAIO = modo; fs.rmSync(pasta, { recursive: true, force: true }); });
  await banco.ensureDatabase();
  const admin = (await db.prepare('SELECT id FROM users LIMIT 1').first()).id;
  for (const [id, role] of [['editor','editor'], ['viewer','viewer'], ['outro','viewer']]) await db.prepare('INSERT INTO users(id,name,email,password_salt,password_hash,role,active,created_at) VALUES(?,?,?,?,?,?,1,?)').bind(id, `Pessoa ${id}`, `${id}@example.com`, 'salt', 'hash', role, banco.now()).run();
  for (const id of [admin, 'editor', 'viewer', 'outro']) await db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES(?,?,?,?)').bind(await banco.tokenHash(id), id, new Date(Date.now() + 3600000).toISOString(), banco.now()).run();
  const req = (method, caminho, user = admin, body, headers = {}) => new NextRequest(`http://fixture/api/${caminho}`, { method, headers: { cookie: `acordos_session=${String(user)}`, 'content-type': 'application/json', 'x-portal-build': PORTAL_BUILD, ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const pedir = async (method, caminho, user, body, headers) => { const r = await rota[method](req(method, caminho, user, body, headers)); return { status: r.status, data: await r.json() }; };
  const get = (caminho, user) => pedir('GET', caminho, user);
  const post = (caminho, body, user = admin, headers) => pedir('POST', caminho, user, body, headers);
  const put = (caminho, body, user = admin) => pedir('PUT', caminho, user, body);
  let numero = 100;
  const manual = (extras = {}) => ({ cnpj: cnpjFicticio(numero++), razao_social: 'Fornecedor Manual Fictício', ...extras });
  const abrir = async (body = manual(), user = 'viewer') => { const r = await post('solicitacoes', body, user); assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data; };
  const registro = id => sql.prepare('SELECT * FROM solicitacoes WHERE id=?').get(id);
  const mover = (id, para, texto = '', user = 'editor') => post(`solicitacoes/${id}/transicao`, { para, texto, expectedRevision: registro(id).revision }, user);
  const contagens = () => ['solicitacoes', 'solicitacao_andamentos', 'solicitacao_categorias', 'audit_logs', 'suppliers', 'email_notifications', 'notificacoes_usuario'].map(tabela => sql.prepare(`SELECT COUNT(*) n FROM ${tabela}`).get().n);

  await t.test('GETs do viewer preservam leituras sem autor de escrita e atividade de sessao', async () => {
    const timestamp = banco.now();
    sql.prepare('INSERT INTO suppliers(id,legal_name,trade_name,cnpj,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('fornecedor_get_ficticio','Fornecedor Fictício','Fornecedor Fictício',cnpjFicticio(70),timestamp,timestamp);
    sql.prepare('INSERT INTO agreements(id,number,supplier_id,start_date,current_version_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('acordo_get_ficticio','ACORDO GET FICTÍCIO','fornecedor_get_ficticio','2020-01-01','versao_get_ficticia',timestamp,timestamp);
    sql.prepare('INSERT INTO agreement_versions(id,agreement_id,version_number,status,published_at,created_at) VALUES(?,?,1,?,?,?)').run('versao_get_ficticia','acordo_get_ficticio','published',timestamp,timestamp);
    const contextos = [];
    globalThis[chave] = { ...db, prepare(consulta) {
      contextos.push({ autor: autorEscrita(), acao: acaoEscritaAutorizada() });
      return db.prepare(consulta);
    } };
    try {
      for (const caminho of ['bootstrap', 'search', 'search/options', 'agreements/acordo_get_ficticio', 'central', 'central/nao-lidas', 'solicitacoes', 'categorias-fornecedor', 'solicitacoes/cep/00000000']) {
        const visto = new Date(Date.now()-120000).toISOString();
        sql.prepare('UPDATE sessions SET last_seen_at=? WHERE user_id=?').run(visto,'viewer');
        contextos.length = 0;
        const resposta = await get(caminho,'viewer');
        assert.equal(resposta.status,200,`${caminho}: ${JSON.stringify(resposta.data)}`);
        assert.ok(contextos.length > 0);
        assert.ok(contextos.every(c => c.autor === undefined && c.acao === undefined), `${caminho} nao deve declarar autor de escrita`);
        assert.notEqual(sql.prepare('SELECT last_seen_at FROM sessions WHERE user_id=?').get('viewer').last_seen_at,visto);
      }
    } finally { globalThis[chave] = db; }
  });
  await t.test('GET CNPJ declara autor e acao; revogacao entre consulta e INSERT impede persistencia', async () => {
    const escritas = [];
    let revogar = false;
    globalThis[chave] = { ...db, prepare(consulta) {
      if (consulta.startsWith('INSERT INTO consultas_cnpj')) {
        escritas.push({ autor: autorEscrita(), acao: acaoEscritaAutorizada() });
        if (revogar) sql.prepare('DELETE FROM sessions WHERE user_id=?').run('viewer');
      }
      return db.prepare(consulta);
    } };
    try {
      const consulta = await get(`solicitacoes/cnpj/${CNPJS_ENSAIO.ativa}`,'viewer');
      assert.equal(consulta.status,200);
      assert.equal(sql.prepare('SELECT user_id FROM consultas_cnpj WHERE id=?').get(consulta.data.consultaId).user_id,'viewer');
      const antes = sql.prepare('SELECT COUNT(*) n FROM consultas_cnpj').get().n;
      revogar = true;
      const barrada = await get(`solicitacoes/cnpj/${CNPJS_ENSAIO.ativa}`,'viewer');
      assert.equal(barrada.status,403); assert.match(barrada.data.error,/sessão ou permissão mudou/);
      assert.equal(sql.prepare('SELECT COUNT(*) n FROM consultas_cnpj').get().n,antes);
      assert.equal((await get(`solicitacoes/cnpj/${CNPJS_ENSAIO.ativa}`,'viewer')).status,401);
      assert.equal(escritas.length,2);
      for (const contexto of escritas) {
        assert.deepEqual(contexto.autor,{ id:'viewer',role:'viewer',token:await banco.tokenHash('viewer') });
        assert.equal(contexto.acao,'solicitacao:abrir');
      }
    } finally {
      globalThis[chave] = db;
      await db.prepare('INSERT OR REPLACE INTO sessions(token,user_id,expires_at,last_seen_at) VALUES(?,?,?,?)').bind(await banco.tokenHash('viewer'),'viewer',new Date(Date.now()+3600000).toISOString(),banco.now()).run();
    }
  });
  await t.test('migracao 9, semente e categorias somente por admin, nomes unicos e revision', async () => {
    assert.ok(sql.prepare('SELECT 1 FROM schema_migrations WHERE version=9').get());
    assert.deepEqual((await get('categorias-fornecedor', 'viewer')).data.categorias.map(c => c.nome).sort(), ['Auto elétrica', 'Oficina', 'Reboque']);
    for (const user of ['editor', 'viewer']) assert.equal((await post('categorias-fornecedor', { nome: 'Teste' }, user)).status, 403);
    const criada = await post('categorias-fornecedor', { nome: 'Categoria fictícia' }); assert.equal(criada.status, 201);
    assert.equal((await post('categorias-fornecedor', { nome: 'CATEGORIA FICTÍCIA' })).status, 409);
    assert.equal((await put(`categorias-fornecedor/${criada.data.id}`, { nome: 'Nome alterado', expectedRevision: 8 })).status, 409);
    assert.equal((await put(`categorias-fornecedor/${criada.data.id}`, { nome: 'Nome alterado', ativo: false, expectedRevision: 0 })).status, 200);
    assert.equal((await get('categorias-fornecedor', 'viewer')).data.categorias.length, 3);
    assert.equal((await get('categorias-fornecedor', admin)).data.categorias.length, 4);
    assert.equal((await post('solicitacoes', manual({ categorias: [criada.data.id] }), 'viewer')).status, 400);
  });
  await t.test('consulta autentica, valida, normaliza, reserva e erros claros', async () => {
    assert.equal((await get(`solicitacoes/cnpj/${CNPJS_ENSAIO.ativa}`, 'sem-sessao')).status, 401);
    assert.equal((await get('solicitacoes/cnpj/11111111111111', 'viewer')).status, 400);
    const consulta = await get(`solicitacoes/cnpj/${CNPJS_ENSAIO.principalFora}`, 'viewer');
    assert.equal(consulta.status, 200); assert.equal(consulta.data.consulta_fonte, 'ReceitaWS'); assert.ok(consulta.data.consultaId);
    const repetida = await get(`solicitacoes/cnpj/${CNPJS_ENSAIO.principalFora}`, 'viewer');
    assert.equal(repetida.data.consultaId, consulta.data.consultaId);
    assert.equal(repetida.data.consultada_em, consulta.data.consultada_em);
    assert.equal((await get(`solicitacoes/cnpj/${CNPJS_ENSAIO.inexistente}`, 'viewer')).status, 404);
    const falha = await get(`solicitacoes/cnpj/${CNPJS_ENSAIO.ambasFora}`, 'viewer'); assert.equal(falha.status, 503); assert.match(falha.data.error, /Preencha os dados manualmente/);
    assert.equal((await get('solicitacoes/cep/00000000', 'viewer')).data.cidade, 'Cidade Fictícia');
    assert.equal((await get('solicitacoes/cep/000', 'viewer')).status, 400);
  });
  let verificada;
  await t.test('envio usa consulta do servidor, ignora Receita adulterada e preserva endereco ajustado', async () => {
    const consulta = (await get(`solicitacoes/cnpj/${CNPJS_ENSAIO.ativa}`, 'viewer')).data;
    assert.equal((await post('solicitacoes', { consultaId: consulta.consultaId }, 'outro')).status, 400);
    const antes = contagens();
    verificada = await abrir({ consultaId: consulta.consultaId, cnpj: 'invalido', razao_social: 'Adulterado', situacao_cadastral: 'BAIXADA', nao_verificado: 1, consulta_fonte: 'Navegador', cidade: 'Cidade Ajustada', numero: '77', categorias: ['categoria_semente_1'] });
    assert.match(verificada.codigo, /^SOL-[1-9]\d*$/);
    const detalhe = (await get(`solicitacoes/${verificada.id}`, 'viewer')).data;
    assert.equal(detalhe.solicitacao.razao_social, 'FORNECEDOR FICTÍCIO'); assert.equal(detalhe.solicitacao.cnpj, CNPJS_ENSAIO.ativa);
    assert.equal(detalhe.solicitacao.nao_verificado, 0); assert.equal(detalhe.solicitacao.cidade, 'Cidade Ajustada'); assert.equal(detalhe.solicitacao.numero, '77');
    assert.equal(detalhe.categorias.length, 1); assert.equal(detalhe.andamentos[0].para_status, 'aberta'); assert.equal(detalhe.andamentos[0].user_id, 'viewer');
    assert.deepEqual(contagens().slice(4,6), antes.slice(4,6));
    const depois = contagens();
    const duplicada = await post('solicitacoes', { consultaId: consulta.consultaId }, 'viewer');
    assert.equal(duplicada.status, 409); assert.match(duplicada.data.error, new RegExp(`${verificada.codigo}.*aberta`)); assert.deepEqual(contagens(), depois);
    assert.deepEqual(duplicada.data.existente,{id:verificada.id,codigo:verificada.codigo,status:'aberta'});
    const listaViewer=(await get('solicitacoes','viewer')).data.solicitacoes.find(s=>s.id===verificada.id);
    assert.deepEqual(listaViewer.categorias,[{id:'categoria_semente_1',nome:'Oficina'}]);
    assert.equal(Object.hasOwn(listaViewer,'solicitante'),false);
    const listaEditor=(await get('solicitacoes','editor')).data.solicitacoes.find(s=>s.id===verificada.id);
    assert.equal(listaEditor.solicitante,'Pessoa viewer');
    const baixada = (await get(`solicitacoes/cnpj/${CNPJS_ENSAIO.baixada}`, 'viewer')).data;
    const rejeitada = await post('solicitacoes', { consultaId: baixada.consultaId }, 'viewer');
    assert.equal(rejeitada.status, 409); assert.match(rejeitada.data.error, /BAIXADA/); assert.deepEqual(contagens(), depois);
  });
  await t.test('manual nao verificado, idempotencia e duplicidade atomica concorrente', async () => {
    const body = manual(), headers = { 'idempotency-key': 'tentativa_cadastro_ficticia_01' };
    const primeira = await post('solicitacoes', body, 'viewer', headers); assert.equal(primeira.status, 201); assert.equal(registro(primeira.data.id).nao_verificado, 1);
    const antes = contagens();
    assert.deepEqual(await post('solicitacoes', body, 'viewer', headers), primeira);
    assert.equal((await post('solicitacoes', { ...body, razao_social: 'Outro texto' }, 'viewer', headers)).status, 409); assert.deepEqual(contagens(), antes);
    const concorrente = manual();
    const resultados = await Promise.all([post('solicitacoes', concorrente, 'viewer'), post('solicitacoes', concorrente, 'outro')]);
    assert.deepEqual(resultados.map(r => r.status).sort((a,b) => a-b), [201, 409]);
  });
  await t.test('visibilidade por posse, 404 direto e relacionados so para chamado:consultar', async () => {
    const outra = await abrir(manual(), 'outro');
    assert.equal((await get(`solicitacoes/${outra.id}`, 'viewer')).status, 404);
    assert.equal((await get('solicitacoes', 'viewer')).data.solicitacoes.some(s => s.id === outra.id), false);
    for (const user of ['editor', admin]) {
      assert.equal((await get(`solicitacoes/${outra.id}`, user)).status, 200);
      assert.equal((await get('solicitacoes', user)).data.solicitacoes.some(s => s.id === outra.id), true);
    }
    const data = dias => new Date(Date.now() - dias * 86400000).toISOString();
    for (const [code, status, dias] of [['SUP-FICTICIO-A','aberto',200], ['SUP-FICTICIO-B','fechado',1], ['SUP-FICTICIO-C','cancelado',100]]) sql.prepare('INSERT INTO tickets(id,code,supplier_name,cnpj,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(code,code,'Parceria Fictícia',CNPJS_ENSAIO.ativa,status,data(dias),data(dias));
    assert.equal('relacionados' in (await get(`solicitacoes/${verificada.id}`, 'viewer')).data, false);
    assert.deepEqual((await get(`solicitacoes/${verificada.id}`, 'editor')).data.relacionados.map(r => r.codigo).sort(), ['SUP-FICTICIO-A', 'SUP-FICTICIO-B']);
    assert.equal((await get('tickets', 'viewer')).status, 403);
  });
  await t.test('transicoes, textos obrigatorios, devolucao e correcao exclusiva do solicitante', async () => {
    const s = await abrir();
    assert.equal((await mover(s.id, 'em_analise', '', 'viewer')).status, 403);
    for (const para of ['aberta', 'devolvida', 'cadastrado', 'recusado', 'invalida']) assert.equal((await mover(s.id, para)).status, 409);
    assert.equal((await mover(s.id, 'em_analise')).status, 200); assert.equal(registro(s.id).atendente_id, 'editor');
    for (const para of ['devolvida', 'recusado']) assert.equal((await mover(s.id, para)).status, 400);
    assert.equal((await mover(s.id, 'devolvida', 'Corrija o endereço')).status, 200);
    assert.equal((await put(`solicitacoes/${s.id}`, { expectedRevision: 2 }, 'outro')).status, 404);
    assert.equal((await put(`solicitacoes/${s.id}`, { expectedRevision: 2 }, 'editor')).status, 404);
    assert.equal((await put(`solicitacoes/${s.id}`, { expectedRevision: 0 }, 'viewer')).status, 409);
    assert.equal((await put(`solicitacoes/${s.id}`, { expectedRevision: 2, cidade: 'Cidade Corrigida', razao_social: 'Manual Corrigido', status: 'cadastrado', solicitante_id: 'outro', categorias: ['categoria_semente_2'] }, 'viewer')).status, 200);
    assert.equal(registro(s.id).status, 'aberta'); assert.equal(registro(s.id).razao_social, 'Manual Corrigido'); assert.equal(registro(s.id).solicitante_id, 'viewer');
    assert.equal((await mover(s.id, 'em_analise', '', admin)).status, 200); assert.equal(registro(s.id).atendente_id, admin);
    assert.equal((await mover(s.id, 'cadastrado')).status, 200);
    assert.equal((await put(`solicitacoes/${s.id}`, { expectedRevision: 5 }, 'viewer')).status, 409);
    for (const para of ['aberta','em_analise','devolvida','cadastrado','recusado']) assert.equal((await mover(s.id, para, 'Texto')).status, 409);
    const recusada = await abrir(); await mover(recusada.id, 'em_analise');
    assert.equal((await mover(recusada.id, 'recusado', 'Motivo fictício')).status, 200); assert.equal(registro(recusada.id).motivo_recusa, 'Motivo fictício');
    for (const para of ['aberta','em_analise','devolvida','cadastrado','recusado']) assert.equal((await mover(recusada.id, para, 'Texto')).status, 409);
    const andamentos = (await get(`solicitacoes/${s.id}`, 'viewer')).data.andamentos;
    assert.deepEqual(andamentos.map(a => a.para_status), ['aberta','em_analise','devolvida','aberta','em_analise','cadastrado']);
    assert.equal(sql.prepare('SELECT COUNT(*) n FROM audit_logs WHERE entity=? AND entity_id=?').get('solicitacao',s.id).n, andamentos.length);
  });
  await t.test('revision concorrente, replay de transicao e imutabilidade de andamento', async () => {
    const s = await abrir(), antes = contagens();
    const resultados = await Promise.all([post(`solicitacoes/${s.id}/transicao`, { para: 'em_analise', expectedRevision: 0 }, 'editor'), post(`solicitacoes/${s.id}/transicao`, { para: 'em_analise', expectedRevision: 0 }, admin)]);
    assert.deepEqual(resultados.map(r => r.status).sort((a,b) => a-b), [200,409]);
    assert.equal(contagens()[1], antes[1]+1); assert.equal(contagens()[3], antes[3]+1);
    const headers = { 'idempotency-key': 'transicao_ficticia_repetida_01' }, body = { para: 'devolvida', texto: 'Corrigir', expectedRevision: 1 };
    assert.equal((await post(`solicitacoes/${s.id}/transicao`, body, 'editor', headers)).status, 200);
    const depois = contagens(); assert.equal((await post(`solicitacoes/${s.id}/transicao`, body, 'editor', headers)).status, 200); assert.deepEqual(contagens(), depois);
    assert.throws(() => sql.prepare('UPDATE solicitacao_andamentos SET texto=? WHERE solicitacao_id=?').run('Alterado',s.id), /imutaveis/);
    assert.throws(() => sql.prepare('DELETE FROM solicitacao_andamentos WHERE solicitacao_id=?').run(s.id), /imutaveis/);
  });
  await t.test('matriz completa de transicoes e correcao concorrente nao gera andamento extra', async () => {
    const estados = ['aberta','em_analise','devolvida','cadastrado','recusado'];
    for (const de of estados) for (const para of estados) {
      const s = await abrir();
      sql.prepare('UPDATE solicitacoes SET status=? WHERE id=?').run(de,s.id);
      const antes = contagens();
      const permitido = (de === 'aberta' && para === 'em_analise') || (de === 'em_analise' && ['devolvida','cadastrado','recusado'].includes(para));
      const resposta = await mover(s.id, para, 'Mensagem fictícia');
      assert.equal(resposta.status, permitido ? 200 : 409, `${de} -> ${para}`);
      if (!permitido) assert.deepEqual(contagens(), antes);
    }
    const s = await abrir(); await mover(s.id,'em_analise'); await mover(s.id,'devolvida','Corrigir');
    const antes = contagens();
    const resultados = await Promise.all(['Primeira Cidade','Segunda Cidade'].map(cidade => put(`solicitacoes/${s.id}`, { cidade, expectedRevision: 2 }, 'viewer')));
    assert.deepEqual(resultados.map(r => r.status).sort((a,b) => a-b),[200,409]);
    assert.equal(contagens()[1], antes[1]+1); assert.equal(contagens()[3], antes[3]+1);
  });
  await t.test('reconsulta atualiza Receita sem sobrescrever endereco e falha nao altera', async () => {
    const s = await abrir(manual({ cnpj: CNPJS_ENSAIO.principalFora, cidade: 'Endereço Ajustado' }));
    assert.equal((await post(`solicitacoes/${s.id}/reconsultar`, { expectedRevision: 0 }, 'viewer')).status, 403);
    assert.equal((await post(`solicitacoes/${s.id}/reconsultar`, { expectedRevision: 0 }, 'editor')).status, 200);
    assert.equal(registro(s.id).nao_verificado, 0); assert.equal(registro(s.id).consulta_fonte, 'ReceitaWS'); assert.equal(registro(s.id).cidade, 'Endereço Ajustado');
    assert.equal((await get(`solicitacoes/${s.id}`, 'viewer')).data.andamentos.at(-1).texto, 'Reconsultado na Receita');
    assert.ok(sql.prepare('SELECT 1 FROM consultas_cnpj WHERE cnpj=? AND user_id=?').get(CNPJS_ENSAIO.principalFora,'editor'));
    const falha = await abrir(manual({ cnpj: CNPJS_ENSAIO.ambasFora })), antes = contagens();
    assert.equal((await post(`solicitacoes/${falha.id}/reconsultar`, { expectedRevision: 0 }, 'editor')).status, 503); assert.deepEqual(contagens(), antes); assert.equal(registro(falha.id).revision, 0);
  });
  await t.test('categorias antigas preservadas; filtros usam dia civil de Brasilia e atualizacao desc', async () => {
    assert.equal((await put('categorias-fornecedor/categoria_semente_1', { ativo: false, expectedRevision: 0 })).status, 200);
    assert.equal((await get(`solicitacoes/${verificada.id}`, 'viewer')).data.categorias[0].ativo, 0);
    const s = await abrir(manual({ urgencia: 'urgente' }));
    sql.prepare('UPDATE solicitacoes SET criado_em=?,atualizado_em=? WHERE id=?').run('2026-01-02T02:59:59.000Z','2099-01-01T00:00:00.000Z',s.id);
    const filtrada = (await get('solicitacoes?de=2026-01-01&ate=2026-01-01&status=aberta&urgencia=urgente&nao_verificado=1', 'viewer')).data;
    assert.deepEqual(filtrada.solicitacoes.map(r => r.id), [s.id]);
    assert.equal((await get('solicitacoes', 'viewer')).data.solicitacoes[0].id, s.id);
    assert.equal((await get('solicitacoes?status=invalido', 'viewer')).status, 400);
    assert.equal((await get('solicitacoes?de=2026-02-30', 'viewer')).status, 400);
  });
  await t.test('avisos por evento, destinatarios ativos, autor excluido e reenvio de devolvida', async () => {
    sql.prepare('INSERT INTO users(id,name,email,password_salt,password_hash,role,active,created_at) VALUES(?,?,?,?,?,?,0,?)').run('inativo','Inativo','inativo@example.com','s','h','editor',banco.now());
    const central = id => sql.prepare("SELECT user_id,texto,link FROM notificacoes_usuario WHERE tipo='solicitacao' AND link=? ORDER BY rowid").all(`/?aba=chamados&solicitacao=${id}`);
    const emails = id => sql.prepare('SELECT * FROM email_notifications WHERE solicitacao_id=? ORDER BY rowid').all(id);
    const normal = await abrir();
    assert.deepEqual(central(normal.id).map(n => n.user_id).sort((a,b) => a.localeCompare(b)),[admin,'editor'].sort((a,b) => a.localeCompare(b)));
    assert.equal(emails(normal.id).length,0);
    const urgente = await abrir(manual({ urgencia: 'urgente' }));
    assert.deepEqual(emails(urgente.id).map(n => n.recipient_user_id).sort((a,b) => String(a).localeCompare(String(b))),[admin,'editor'].sort((a,b) => a.localeCompare(b)));
    assert.ok(central(urgente.id).every(n => n.texto === `Nova solicitação ${urgente.codigo} (urgente)`));
    const propria = await abrir(manual({ urgencia: 'urgente' }), 'editor');
    assert.deepEqual(central(propria.id).map(n => n.user_id),[admin]);
    assert.deepEqual(emails(propria.id).map(n => n.recipient_user_id),[admin]);
    await mover(propria.id,'em_analise','','editor');
    assert.equal(emails(propria.id).length,1); assert.equal(central(propria.id).length,1);
    for (const [para,texto] of [['em_analise',''],['devolvida','Corrigir <endereco> & cidade']]) {
      await mover(normal.id,para,texto);
      assert.equal(central(normal.id).length,para === 'em_analise' ? 3 : 4);
      assert.equal(emails(normal.id).length,para === 'em_analise' ? 1 : 2);
      assert.equal(central(normal.id).at(-1).user_id,'viewer');
      assert.equal(emails(normal.id).at(-1).recipient_user_id,'viewer');
      assert.equal(JSON.parse(emails(normal.id).at(-1).payload_json).mensagem,texto);
    }
    assert.equal(central(normal.id).at(-1).texto,`${normal.codigo}: devolvida para correção`);
    // Quem devolve pode diferir de quem assumiu a analise.
    const diferente = await abrir(); await mover(diferente.id,'em_analise'); await mover(diferente.id,'devolvida','Corrigir',admin);
    const antesReconsulta = contagens();
    assert.equal((await post(`solicitacoes/${diferente.id}/reconsultar`,{expectedRevision:2},'editor')).status,200);
    assert.deepEqual(contagens().slice(5),antesReconsulta.slice(5));
    await put(`solicitacoes/${diferente.id}`,{expectedRevision:3},'viewer');
    assert.equal(central(diferente.id).at(-1).user_id,admin);
    assert.equal(emails(diferente.id).length,2);
    await put(`solicitacoes/${normal.id}`,{expectedRevision:2},'viewer');
    assert.equal(central(normal.id).at(-1).user_id,'editor'); assert.equal(emails(normal.id).length,2);
    await mover(normal.id,'em_analise'); await mover(normal.id,'devolvida','Corrigir novamente');
    sql.prepare('UPDATE users SET active=0 WHERE id=?').run('editor');
    await put(`solicitacoes/${normal.id}`,{expectedRevision:5},'viewer');
    assert.equal(central(normal.id).at(-1).user_id,admin);
    sql.prepare('UPDATE users SET active=1 WHERE id=?').run('editor');
    for (const [final,texto] of [['cadastrado','Observação fictícia'],['cadastrado',''],['recusado','Motivo fictício']]) {
      const s = await abrir(); await mover(s.id,'em_analise'); await mover(s.id,final,texto);
      assert.deepEqual(emails(s.id).map(n => n.recipient_user_id),['viewer','viewer']);
      assert.deepEqual(central(s.id).slice(2).map(n => n.user_id),['viewer','viewer']);
      const dados = JSON.parse(emails(s.id).at(-1).payload_json), email = montarEmailSolicitacao(dados,'http://portal.test/');
      assert.equal(email.assunto,`[Supply Vision] ${s.codigo}: ${final}`);
      assert.ok(email.texto.includes(`Situação: ${final}`)); assert.ok(email.html.includes(texto));
      assert.match(email.texto,/CNPJ: \d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
      assert.equal(email.url,`http://portal.test/?aba=chamados&solicitacao=${s.id}`);
    }
    const inativa = await abrir(); sql.prepare('UPDATE users SET active=0 WHERE id=?').run('viewer');
    await mover(inativa.id,'em_analise'); assert.equal(emails(inativa.id).length,0); assert.equal(central(inativa.id).length,2);
    sql.prepare('UPDATE users SET active=1 WHERE id=?').run('viewer');
    assert.equal(sql.prepare("SELECT COUNT(*) n FROM notificacoes_usuario WHERE user_id='inativo'").get().n,0);
    const antes = [central(urgente.id).length,emails(urgente.id).length];
    await post(`solicitacoes/${urgente.id}/reconsultar`,{expectedRevision:0},'editor');
    assert.deepEqual([central(urgente.id).length,emails(urgente.id).length],antes);
    const dados = JSON.parse(emails(normal.id).find(e => JSON.parse(e.payload_json).situacao === 'devolvida').payload_json);
    assert.ok(montarEmailSolicitacao(dados,'http://portal.test').html.includes('Corrigir &lt;endereco&gt; &amp; cidade'));
  });
  await t.test('fila de solicitacoes respeita ensaio, permissoes no consumo e reenvio manual', async () => {
    const antes = sql.prepare('SELECT * FROM email_notifications ORDER BY id').all();
    const enviados = [], config = { PORTAL_URL:'http://portal.test', EMAIL_FROM_NAME:'Portal', SMTP_USER:'portal@example.com' };
    const transporte = { async sendMail(email) { enviados.push(email); } };
    await processarNotificacoes(sql,config,transporte);
    assert.equal(enviados.length,0); assert.deepEqual(sql.prepare('SELECT * FROM email_notifications ORDER BY id').all(),antes);
    // Isola a entrega sob teste sem remover a fila dos outros cenarios.
    sql.exec("UPDATE email_notifications SET status='sent'");
    const s = await abrir(); await mover(s.id,'em_analise');
    process.env.MODO_ENSAIO='0';
    try {
      await processarNotificacoes(sql,config,transporte);
      assert.equal(enviados.length,1); assert.equal(enviados[0].subject,`[Supply Vision] ${s.codigo}: em análise`);
      const u = await abrir(manual({urgencia:'urgente'}));
      sql.prepare('UPDATE users SET active=0 WHERE id=?').run('editor');
      await processarNotificacoes(sql,config,transporte);
      assert.equal(enviados.length,2);
      const falha = sql.prepare('SELECT * FROM email_notifications WHERE solicitacao_id=? AND recipient_user_id=?').get(u.id,'editor');
      assert.equal(falha.status,'failed');
      sql.prepare('UPDATE users SET active=1 WHERE id=?').run('editor');
      assert.equal((await post(`email-notifications/${String(falha.id)}/retry`,{})).status,200);
      await processarNotificacoes(sql,config,transporte); assert.equal(enviados.length,3);
      const revogada = await abrir(manual({urgencia:'urgente'}));
      sql.prepare('UPDATE users SET role=? WHERE id=?').run('viewer','editor');
      await processarNotificacoes(sql,config,transporte);
      assert.equal(enviados.length,4);
      assert.equal(sql.prepare('SELECT status FROM email_notifications WHERE solicitacao_id=? AND recipient_user_id=?').get(revogada.id,'editor').status,'failed');
      sql.prepare('UPDATE users SET role=? WHERE id=?').run('editor','editor');
    } finally { process.env.MODO_ENSAIO='1'; sql.prepare('UPDATE users SET active=1,role=? WHERE id=?').run('editor','editor'); }
  });
  await t.test('falha ao inserir aviso desfaz solicitacao e andamento; categoria desativada nao avisa', async () => {
    const s = await abrir(), antes = contagens(), log = console.error; console.error = () => {};
    sql.exec("CREATE TRIGGER falha_aviso BEFORE INSERT ON notificacoes_usuario BEGIN SELECT RAISE(ABORT,'falha ficticia de aviso'); END");
    try {
      assert.equal((await post('solicitacoes',manual({urgencia:'urgente'}),'viewer')).status,500);
      assert.equal((await mover(s.id,'em_analise')).status,500);
      assert.deepEqual(contagens(),antes); assert.equal(registro(s.id).revision,0);
    } finally { sql.exec('DROP TRIGGER falha_aviso'); console.error=log; }
    globalThis[chave] = { ...db, async batch(instrucoes) {
      sql.prepare("UPDATE categorias_fornecedor SET ativo=0 WHERE id='categoria_semente_2'").run();
      return db.batch(instrucoes);
    } };
    try {
      assert.equal((await post('solicitacoes',manual({categorias:['categoria_semente_2'],urgencia:'urgente'}),'viewer')).status,409);
      assert.deepEqual(contagens(),antes);
    } finally { globalThis[chave]=db; sql.prepare("UPDATE categorias_fornecedor SET ativo=1 WHERE id='categoria_semente_2'").run(); }
  });
  await t.test('build, validacao ativa, rollback do lote e sessao revogada barram escritas', async () => {
    const existente = await abrir(), body = manual(), antes = contagens();
    assert.equal((await post('solicitacoes', body, 'viewer', { 'x-portal-build': 'antigo' })).status, 409); assert.deepEqual(contagens(), antes);
    sql.exec('INSERT OR REPLACE INTO operacao_validacao(id,ativa) VALUES(1,1)');
    assert.equal((await post('solicitacoes', body, 'viewer')).status, 503);
    assert.equal((await get(`solicitacoes/cnpj/${CNPJS_ENSAIO.ativa}`, 'viewer')).status, 503);
    sql.exec('UPDATE operacao_validacao SET ativa=0');
    sql.exec("CREATE TRIGGER falhar_solicitacao BEFORE INSERT ON solicitacao_andamentos BEGIN SELECT RAISE(ABORT,'falha ficticia'); END");
    const log = console.error; console.error = () => {};
    try {
      assert.equal((await post('solicitacoes', body, 'viewer')).status, 500);
      assert.equal((await mover(existente.id,'em_analise')).status, 500);
      assert.equal(registro(existente.id).status, 'aberta'); assert.equal(registro(existente.id).revision, 0);
    } finally { console.error = log; sql.exec('DROP TRIGGER falhar_solicitacao'); }
    assert.deepEqual(contagens(), antes);
    const autor = { id: 'viewer', role: 'viewer', token: await banco.tokenHash('viewer') };
    const escrever = acao => comContextoEscrita(async () => { definirAutorEscrita(autor); const fazer = () => db.prepare('INSERT INTO audit_logs(id,user_id,action,entity,created_at) VALUES(?,?,?,?,?)').bind(banco.id('aud'),'viewer','TEST','fixture',banco.now()).run(); return acao ? comAcaoEscrita(acao, fazer) : fazer(); });
    await assert.rejects(() => escrever(), SessaoRevogada);
    await assert.rejects(() => escrever('solicitacao:atender'), SessaoRevogada);
    await escrever('solicitacao:abrir');
    sql.prepare('UPDATE users SET active=0 WHERE id=?').run('viewer');
    await assert.rejects(() => escrever('solicitacao:abrir'), SessaoRevogada);
    sql.prepare('UPDATE users SET active=1,role=? WHERE id=?').run('editor','viewer');
    await assert.rejects(() => escrever('solicitacao:abrir'), SessaoRevogada);
    sql.prepare('UPDATE users SET role=? WHERE id=?').run('viewer','viewer');
    // A sessao e revogada depois de requireUser, durante a leitura do corpo.
    const antesRevogar = contagens();
    const stream = new ReadableStream({ pull(c) {
      sql.prepare('DELETE FROM sessions WHERE user_id=?').run('viewer');
      c.enqueue(new TextEncoder().encode(JSON.stringify(manual()))); c.close();
    } }, { highWaterMark: 0 });
    const resposta = await rota.POST(new NextRequest('http://fixture/api/solicitacoes', { method: 'POST', headers: { cookie: 'acordos_session=viewer', 'content-type': 'application/json', 'x-portal-build': PORTAL_BUILD }, body: stream, duplex: 'half' }));
    assert.equal(resposta.status, 403); assert.deepEqual(contagens(), antesRevogar);
    sql.prepare('DELETE FROM sessions WHERE user_id=?').run('viewer');
    await assert.rejects(() => escrever('solicitacao:abrir'), SessaoRevogada);
    assert.equal((await post('solicitacoes', body, 'viewer')).status, 401);
  });
  await t.test('expurgo preserva solicitacoes, andamentos e categorias; backup/restauracao inclui tudo', async () => {
    const tabelas = ['solicitacoes', 'solicitacao_andamentos', 'categorias_fornecedor', 'solicitacao_categorias', 'consultas_cnpj'];
    const dados = () => Object.fromEntries(tabelas.map(tabela => [tabela, sql.prepare(`SELECT * FROM ${tabela} ORDER BY rowid`).all()]));
    const agora = new Date('2026-10-22T12:00:00.000Z');
    for (const [id, dias] of [['antiga',91], ['limite',90], ['recente',1]]) sql.prepare('INSERT INTO consultas_cnpj VALUES(?,?,?,?,?,?)').run(id,CNPJS_ENSAIO.ativa,'BrasilAPI','{}',new Date(agora.getTime()-dias*86400000).toISOString(),'editor');
    const antes = dados(), copia = criarCopiaIntegra(db.arquivo, path.join(pasta, 'backup.sqlite')), restaurada = path.join(pasta, 'restaurada.sqlite');
    prepararRestauracao(copia, restaurada, validarBanco);
    const restaurado = new DatabaseSync(restaurada);
    try { for (const tabela of tabelas) assert.deepEqual(restaurado.prepare(`SELECT * FROM ${tabela} ORDER BY rowid`).all(), antes[tabela]); } finally { restaurado.close(); }
    assert.equal(expurgar(sql, configurarExpurgo({ EXPURGO_HABILITADO: '1', EXPURGO_EMAILS_DIAS: '0', EXPURGO_RELATORIOS_DIAS: '0', EXPURGO_IMPORTACOES_DIAS: '0' }), agora).consultas_cnpj, 1);
    const depois = dados(); for (const tabela of tabelas.slice(0,4)) assert.deepEqual(depois[tabela], antes[tabela]);
    assert.ok(!depois.consultas_cnpj.some(c => c.id === 'antiga')); assert.ok(depois.consultas_cnpj.some(c => c.id === 'limite'));
  });
});
