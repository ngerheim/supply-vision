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
import { normalizarPlaca, exibirPlaca } from '../lib/baixas.ts';
import { criarCopiaIntegra } from '../scripts/backup.mjs';
import { prepararRestauracao } from '../scripts/restauracao-segura.mjs';
import { validarBanco } from '../scripts/validar-banco.mjs';
import { expurgar, configurarExpurgo } from '../scripts/expurgar-dados.mjs';
import { semearBaixas } from '../demonstracao/baixas.mjs';

const hooks = registerHooks({
  resolve(s, c, next) {
    if (s === 'next/server') return next('vinext/shims/server', c);
    if (s.startsWith('@/'))
      return next(new URL(`../${s.slice(2)}.ts`, import.meta.url).href, c);
    if (s === './database')
      return next(new URL('../lib/database.ts', import.meta.url).href, c);
    return next(s, c);
  },
});
const banco = await import('../lib/database.ts');
const rota = await import('../app/api/[...path]/route.ts');
hooks.deregister();

void test('placas antigas e Mercosul: normalizacao, exibicao e entradas invalidas', () => {
  for (const [entrada, normal, exibida] of [
    ['abc1234', 'ABC1234', 'ABC-1234'],
    ['abc-1234', 'ABC1234', 'ABC-1234'],
    ['abc1a23', 'ABC1A23', 'ABC1A23'],
    [' ABC1A23 ', 'ABC1A23', 'ABC1A23'],
  ]) {
    assert.equal(normalizarPlaca(entrada), normal);
    assert.equal(exibirPlaca(normal), exibida);
  }
  for (const entrada of [
    '',
    'AB12345',
    'ABCD123',
    'ABC12A3',
    'ABC-1A23',
    'ABC12345',
    'ABC 1234',
    'ABC--1234',
    'ÁBC1234',
    'ABC1AA3',
  ])
    assert.equal(normalizarPlaca(entrada), null, entrada);
});

void test('Baixa no estoque pelo roteador e SQLite reais', async (t) => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-baixas-'));
  const pastaBackup=fs.mkdtempSync(path.join(process.cwd(),'..','.fixture-backup-baixas-'));
  const db = bancoSqliteLocal({ pastaPrivada: pasta, criar: true }),
    sql = new DatabaseSync(db.arquivo);
  const chave = Symbol.for('supply-vision:banco'),
    anterior = globalThis[chave],
    senha = env.INITIAL_ADMIN_PASSWORD,
    modo = process.env.MODO_ENSAIO;
  globalThis[chave] = db;
  env.INITIAL_ADMIN_PASSWORD = 'senha-ficticia-baixas';
  process.env.MODO_ENSAIO = '1';
  t.after(() => {
    sql.close();
    db.fechar();
    globalThis[chave] = anterior;
    env.INITIAL_ADMIN_PASSWORD = senha;
    if (modo === undefined) delete process.env.MODO_ENSAIO;
    else process.env.MODO_ENSAIO = modo;
    fs.rmSync(pasta, { recursive: true, force: true });
    fs.rmSync(pastaBackup, { recursive: true, force: true });
  });
  await banco.ensureDatabase();
  sql.prepare("INSERT OR IGNORE INTO itens_catalogo(id,descricao,descricao_chave,unidade,ativo) VALUES('item_teste','Filtro de teste','FILTRO DE TESTE','un',1)").run();
  const admin = (await db.prepare('SELECT id FROM users LIMIT 1').first()).id;
  for (const [id, role] of [
    ['editor', 'editor'],
    ['viewer', 'viewer'],
    ['outro', 'viewer'],
    ['inativo', 'editor'],
  ])
    sql
      .prepare(
        'INSERT INTO users(id,name,email,password_salt,password_hash,role,active,created_at) VALUES(?,?,?,?,?,?,?,?)',
      )
      .run(
        id,
        `Pessoa ${id}`,
        `${id}@example.com`,
        'salt',
        'hash',
        role,
        id === 'inativo' ? 0 : 1,
        banco.now(),
      );
  const sessao = async (user) =>
    db
      .prepare(
        'INSERT OR REPLACE INTO sessions(token,user_id,expires_at,last_seen_at) VALUES(?,?,?,?)',
      )
      .bind(
        await banco.tokenHash(user),
        user,
        new Date(Date.now() + 3600000).toISOString(),
        banco.now(),
      )
      .run();
  for (const user of [admin, 'editor', 'viewer', 'outro', 'inativo'])
    await sessao(user);
  const pedir = async (
    method,
    caminho,
    user = 'viewer',
    body,
    headers = {},
  ) => {
    const r = await rota[method](
      new NextRequest(`http://fixture/api/${caminho}`, {
        method,
        headers: {
          cookie: `acordos_session=${user}`,
          'content-type': 'application/json',
          'x-portal-build': PORTAL_BUILD,
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    return { status: r.status, data: await r.json() };
  };
  const get = (caminho, user) => pedir('GET', caminho, user),
    post = (caminho, body, user, headers) =>
      pedir('POST', caminho, user, body, headers),
    put = (caminho, body, user = admin) => pedir('PUT', caminho, user, body);
  let proximaOs = 100;
  const entrada = (extras = {}) => ({
    numero_os: String(proximaOs++),
    placa: 'fic-1234',
    estoque_id: estoqueA.id,
    itens: [{itemId:'item_teste',quantidade:1}],
    ...extras,
  });
  const abrir = async (body = entrada(), user = 'viewer') => {
    const r = await post('baixas', body, user);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data;
  };
  const registro = (id) =>
    sql.prepare('SELECT * FROM baixas_estoque WHERE id=?').get(id);
  const mover = (
    id,
    para,
    texto = '',
    user = 'editor',
    revision = registro(id).revision,
  ) =>
    post(
      `baixas/${id}/transicao`,
      { para, texto, expectedRevision: revision },
      user,
    );
  const tabelas = [
    'baixas_estoque',
    'baixa_andamentos',
    'estoques',
    'audit_logs',
    'notificacoes_usuario',
    'email_notifications',
  ];
  const contagens = () =>
    tabelas.map(
      (tabela) => sql.prepare(`SELECT COUNT(*) n FROM ${tabela}`).get().n,
    );
  const avisos = (id) =>
    sql
      .prepare(
        'SELECT * FROM notificacoes_usuario WHERE link=? ORDER BY user_id',
      )
      .all(`/?aba=chamados&baixa=${id}`);


  const cadastrarEstoque = async (nome) => {
    const resposta = await post('estoques', { nome }, admin);
    assert.equal(resposta.status, 201, JSON.stringify(resposta.data));
    return resposta.data;
  };
  const estoqueA = await cadastrarEstoque('Estoque Teste A');
  const estoqueB = await cadastrarEstoque('Estoque Teste B');
  await t.test('baixa histórica exibe item legado com descrição do catálogo',async()=>{
    const timestamp=banco.now();
    sql.prepare("INSERT INTO baixas_estoque(id,numero_os,estoque_id,placa,status,solicitante_id,criado_em,atualizado_em) VALUES('bxa_legado_teste','981099',?,'ABC1234','baixada','viewer',?,?)").run(estoqueA.id,timestamp,timestamp);
    sql.prepare("INSERT INTO baixa_itens(id,baixa_id,item_id,quantidade_centesimos,status,atendido_em,criado_em,atualizado_em) VALUES('bi_legado_teste','bxa_legado_teste','item_legado',100,'baixado',?,?,?)").run(timestamp,timestamp,timestamp);
    const d=await get('baixas/bxa_legado_teste');assert.equal(d.status,200);assert.equal(d.data.itens[0].descricao,'Item não especificado (legado)');
    assert.equal(sql.prepare("SELECT COUNT(*) n FROM movimentos_estoque WHERE origem_id='bi_legado_teste'").get().n,0);
  });
  await t.test('entradas, ajustes, saldo, detalhe, saídas automáticas e estorno',async()=>{
    const hoje=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),body={estoqueId:estoqueA.id,dataMovimento:hoje,documento:'NF fictícia',observacao:'Recebimento de teste',itens:[{itemId:'item_teste',quantidade:10}]};
    assert.equal((await post('estoque/entradas',body,'viewer')).status,403);
    assert.equal((await post('estoque/entradas',{...body,dataMovimento:'2099-12-31'},'editor')).status,400);
    assert.equal((await post('estoque/entradas',{...body,itens:[{itemId:'item_teste',quantidade:1},{itemId:'item_teste',quantidade:2}]},'editor')).status,400);
    sql.prepare('UPDATE estoques SET ativo=0 WHERE id=?').run(estoqueB.id);assert.equal((await post('estoque/entradas',{...body,estoqueId:estoqueB.id},'editor')).status,400);sql.prepare('UPDATE estoques SET ativo=1 WHERE id=?').run(estoqueB.id);
    sql.prepare('UPDATE itens_catalogo SET ativo=0 WHERE id=\'item_teste\'').run();assert.equal((await post('estoque/entradas',body,'editor')).status,400);sql.prepare('UPDATE itens_catalogo SET ativo=1 WHERE id=\'item_teste\'').run();
    assert.equal((await post('estoque/entradas',{...body,itens:[{itemId:'item_teste',quantidade:1.5}]},'editor')).status,400);
    const chave={'idempotency-key':'entrada-estoque-ficticia'};
    assert.equal((await post('estoque/entradas',body,'editor',chave)).status,200);
    assert.equal((await post('estoque/entradas',body,'editor',chave)).status,200);
    assert.equal((await post('estoque/entradas',{...body,documento:'Outra entrada'},'editor',chave)).status,409);
    assert.equal((await post('estoque/ajustes',{...body,observacao:'',itens:[{itemId:'item_teste',quantidade:1}]},admin)).status,400);
    assert.equal((await post('estoque/ajustes',{...body,itens:[{itemId:'item_teste',quantidade:1}]},'editor')).status,403);
    assert.equal((await post('estoque/ajustes',{...body,itens:[{itemId:'item_teste',quantidade:-1}]},admin)).status,200);
    const baixa=await abrir(entrada({itens:[{itemId:'item_teste',quantidade:2}]}));
    const detalheAntes=(await get(`baixas/${baixa.id}`)).data;assert.equal(detalheAntes.itens[0].saldo,9);
    assert.equal((await mover(baixa.id,'baixada')).status,200);
    const movimentos=(await get(`estoque/movimentos?estoqueId=${estoqueA.id}&itemId=item_teste&de=${hoje}&ate=${hoje}`,'viewer')).data.movimentos;
    const saida=movimentos.find(m=>m.tipo==='saida'&&m.origem_tipo==='baixa_item');assert.ok(saida);assert.equal(saida.quantidade,-2);
    assert.equal((await post(`estoque/movimentos/${saida.id}/estorno`,{motivo:'Não permitido'},admin)).status,409);
    const entradaMov=movimentos.find(m=>m.tipo==='entrada');assert.ok(entradaMov);
    const movimentoEstorno=await post(`estoque/movimentos/${entradaMov.id}/estorno`,{motivo:'Ajuste fictício'},'editor');assert.equal(movimentoEstorno.status,200);
    assert.equal((await post(`estoque/movimentos/${movimentoEstorno.data.id}/estorno`,{motivo:'Estorno de estorno'},'editor')).status,409);
    assert.equal((await post(`estoque/movimentos/${entradaMov.id}/estorno`,{motivo:'Ajuste fictício'},'editor')).data.codigo,'duplicado');
    const saldos=(await get(`estoque/saldos?estoqueId=${estoqueA.id}&q=Filtro&somenteNegativos=1`,'viewer')).data.saldos;assert.equal(saldos[0].saldo,-3);
    const pendente=await abrir(entrada({itens:[{itemId:'item_teste',quantidade:4}]}));assert.equal((await get(`baixas/${pendente.id}`)).data.itens[0].saldo,-3);
    const recusada=await abrir(entrada({itens:[{itemId:'item_teste',quantidade:1}]}));assert.equal((await mover(recusada.id,'recusada','Recusa fictícia')).status,200);
    assert.equal(sql.prepare("SELECT COUNT(*) n FROM movimentos_estoque WHERE origem_id IN (SELECT id FROM baixa_itens WHERE baixa_id=?)").get(recusada.id).n,0);
  });
  await t.test('histórico localiza cada baixa pelo código e mostra a OS', async () => {
    for (const os of ['981001', '981002']) {
      const aberta = await abrir(entrada({ numero_os: os }));
      const historico = await get(`audit?q=${encodeURIComponent(aberta.codigo)}`, admin);
      assert.equal(historico.status, 200);
      assert.equal(historico.data.logs.length, 1);
      assert.equal(historico.data.logs[0].entityId, aberta.id);
      assert.match(historico.data.logs[0].detailsText, new RegExp(`${aberta.codigo}.*${os}`));
    }
  });
  await t.test(
    'cadastro: guardas, nomes normalizados, revision e desativacao',
    async () => {
      assert.ok(
        sql.prepare('SELECT 1 FROM schema_migrations WHERE version=12').get(),
      );
      assert.deepEqual(
        (await get('estoques')).data.estoques.map((e) => e.nome),
        ['Estoque Teste A', 'Estoque Teste B'],
      );
      for (const user of ['viewer', 'editor']) {
        assert.equal(
          (await post('estoques', { nome: 'Outro' }, user)).status,
          403,
        );
        assert.equal(
          (
            await put(
              `estoques/${estoqueA.id}`,
              { nome: 'Outro', expectedRevision: 0 },
              user,
            )
          ).status,
          403,
        );
      }
      for (const nome of ['', 'A'.repeat(201)])
        assert.equal((await post('estoques', { nome }, admin)).status, 400);
      const novo = await post('estoques', { nome: 'Depósito Fictício' }, admin);
      assert.equal(novo.status, 201);
      for (const nome of [
        'DEPÓSITO FICTÍCIO',
        ' Depo\u0301sito   Ficti\u0301cio ',
      ])
        assert.equal((await post('estoques', { nome }, admin)).status, 409);
      assert.equal(
        (
          await put(`estoques/${novo.data.id}`, {
            nome: 'Renomeado',
            expectedRevision: 4,
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await put(`estoques/${novo.data.id}`, {
            nome: 'Renomeado',
            ativo: false,
            expectedRevision: 0,
          })
        ).status,
        200,
      );
      assert.equal((await get('estoques')).data.estoques.length, 2);
      assert.equal((await get('estoques', admin)).data.estoques.length, 3);
      assert.equal(
        (await post('baixas', entrada({ estoque_id: novo.data.id }))).status,
        400,
      );
      assert.equal(
        (
          await put(`estoques/${novo.data.id}`, {
            ativo: true,
            expectedRevision: 1,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await put(`estoques/${novo.data.id}`, {
            nome: 'ESTOQUE TESTE A',
            expectedRevision: 2,
          })
        ).status,
        409,
      );
    },
  );
  await t.test('catálogo de itens: acesso, validação, idempotência, revisão e proteção do legado',async()=>{
    assert.equal((await get('itens','viewer')).status,200);
    assert.equal((await post('itens',{descricao:'Negado',unidade:'un'},'viewer')).status,403);
    assert.equal((await put('itens/item_legado',{descricao:'Negado',expectedRevision:0},'viewer')).status,403);
    assert.equal((await post('itens',{descricao:'Negado',unidade:'un'},'editor')).status,403);
    assert.equal((await put('itens/item_legado',{descricao:'Negado',unidade:'un',expectedRevision:0},'editor')).status,403);
    for(const body of [{descricao:'',unidade:'un'},{descricao:'X'.repeat(121),unidade:'un'},{descricao:'Unidade errada',unidade:'cx'}]) assert.equal((await post('itens',body,admin)).status,400);
    const headers={'idempotency-key':'catalogo-ficticio-001'}, body={descricao:'Filtro fictício',unidade:'un'};
    const criado=await post('itens',body,admin,headers);assert.equal(criado.status,201);
    const repetido=await post('itens',body,admin,headers);assert.equal(repetido.status,201);assert.equal(repetido.data.id,criado.data.id);
    const conflitoKey=await post('itens',{descricao:'Outro filtro',unidade:'un'},admin,headers);assert.equal(conflitoKey.status,409);
    const duplicado=await post('itens',{descricao:'FILTRO FICTÍCIO',unidade:'L'},admin);assert.equal(duplicado.status,409);assert.equal(duplicado.data.codigo,'duplicado');
    assert.equal((await put(`itens/${criado.data.id}`,{descricao:'Alterado',unidade:'un',expectedRevision:4})).data.codigo,'revisao');
    assert.equal((await put('itens/item_legado',{descricao:'Alterado',expectedRevision:0})).status,409);
    assert.equal((await put(`itens/${criado.data.id}`,{descricao:'Óleo alterado',unidade:'kg',expectedRevision:0})).status,200);
    assert.ok(sql.prepare("SELECT 1 FROM audit_logs WHERE entity='item_catalogo' AND entity_id=?").get(criado.data.id));
    assert.equal((await get('itens','viewer')).data.itens.some(i=>i.id==='item_legado'||i.id===criado.data.id),true);
    assert.equal((await get('itens?q=oleo')).data.itens.some(i=>i.id===criado.data.id),true);
    assert.equal((await get('itens',admin)).data.itens.some(i=>i.id==='item_legado'),false);
    assert.equal((await put(`itens/${criado.data.id}`,{ativo:false,expectedRevision:1})).status,200);
    assert.equal((await get('itens','viewer')).data.itens.some(i=>i.id===criado.data.id),false);
    assert.equal((await get('itens',admin)).data.itens.some(i=>i.id===criado.data.id),true);
    assert.equal((await get('itens?ativos=1',admin)).data.itens.some(i=>i.id===criado.data.id),false);
    assert.equal((await pedir('DELETE',`itens/${criado.data.id}`,admin)).status,404);
  });
  await t.test(
    'validacao, criacao atomica, idempotencia, duplicidade concorrente e acesso',
    async () => {
      for (const numero_os of ['', '1A', '1'.repeat(21), 123])
        assert.equal(
          (await post('baixas', entrada({ numero_os }))).status,
          400,
        );
      for (const placa of ['ABC12A3', 'ABC--1234', null, 123])
        assert.equal((await post('baixas', entrada({ placa }))).status, 400);
      assert.equal(
        (await post('baixas', entrada({ estoque_id: 'inexistente' }))).status,
        400,
      );
      assert.equal((await get('baixas', 'inativo')).status, 401);
      assert.equal((await get('baixas', 'sem-sessao')).status, 401);
      const body = entrada(),
        headers = { 'idempotency-key': 'baixa-ficticia-abertura' };
      const primeira = await post('baixas', body, 'viewer', headers);
      assert.equal(primeira.status, 201);
      assert.match(primeira.data.codigo, /^BX-[1-9]\d*$/);
      const antes = contagens();
      assert.deepEqual(await post('baixas', body, 'viewer', headers), primeira);
      assert.equal(
        (await post('baixas', { ...body, placa: 'FIC1A23' }, 'viewer', headers))
          .status,
        409,
      );
      assert.deepEqual(contagens(), antes);
      const detalhe = await get(`baixas/${primeira.data.id}`);
      assert.equal(detalhe.data.baixa.placa, 'FIC1234');
      assert.equal(Object.hasOwn(detalhe.data.baixa, 'request_key'), false);
      assert.equal(Object.hasOwn(detalhe.data.baixa, 'request_hash'), false);
      assert.equal(Object.hasOwn(detalhe.data.andamentos[0], 'request_key'), false);
      assert.equal(Object.hasOwn(detalhe.data.andamentos[0], 'request_hash'), false);
      assert.equal(detalhe.data.andamentos[0].para_status, 'aberta');
      const duplicada = await post('baixas', body);
      assert.equal(duplicada.status, 409);
      assert.deepEqual(duplicada.data.existente, {
        ...primeira.data,
        status: 'aberta',
      });
      const concorrente = entrada({ placa: 'fic1a23' });
      const resultados = await Promise.all([
        post('baixas', concorrente),
        post('baixas', concorrente, 'outro'),
      ]);
      assert.deepEqual(
        resultados.map((r) => r.status).sort((a, b) => a - b),
        [201, 409],
      );
      const outra = await abrir(entrada(), 'outro');
      assert.equal((await get(`baixas/${outra.id}`)).status, 404);
      assert.equal(
        (await get('baixas')).data.baixas.some((b) => b.id === outra.id),
        false,
      );
      assert.equal(
        Object.hasOwn((await get('baixas')).data.baixas[0], 'solicitante'),
        false,
      );
      for (const user of ['editor', admin]) {
        assert.equal((await get(`baixas/${outra.id}`, user)).status, 200);
        assert.equal(
          (await get('baixas', user)).data.baixas.some(
            (b) => b.id === outra.id,
          ),
          true,
        );
      }
      assert.equal(
        (await get('baixas', 'editor')).data.baixas.find(
          (b) => b.id === outra.id,
        ).solicitante,
        'Pessoa outro',
      );
    },
  );
  await t.test(
    'matriz completa, motivo obrigatorio, revision, concorrencia e replay',
    async () => {
      for (const de of ['aberta', 'baixada', 'recusada'])
        for (const para of ['aberta', 'baixada', 'recusada', 'invalida']) {
          const b = await abrir();
          sql
            .prepare('UPDATE baixas_estoque SET status=? WHERE id=?')
            .run(de, b.id);
          const valido =
            de === 'aberta' && ['baixada', 'recusada'].includes(para);
          assert.equal(
            (await mover(b.id, para, 'Motivo fictício')).status,
            valido ? 200 : 409,
            `${de} -> ${para}`,
          );
        }
      const b = await abrir();
      assert.equal((await mover(b.id, 'baixada', '', 'viewer')).status, 403);
      assert.equal((await mover(b.id, 'recusada')).status, 400);
      for (const expectedRevision of [undefined, null, -1, '0', 1])
        assert.equal(
          (
            await post(
              `baixas/${b.id}/transicao`,
              { para: 'baixada', expectedRevision },
              'editor',
            )
          ).status,
          409,
        );
      const c = await abrir(),
        antes = contagens();
      const respostas = await Promise.all([
        mover(c.id, 'baixada', '', 'editor', 0),
        mover(c.id, 'recusada', 'Motivo', admin, 0),
      ]);
      assert.deepEqual(
        respostas.map((r) => r.status).sort((a, b) => a - b),
        [200, 409],
      );
      assert.equal(contagens()[1], antes[1] + 2);
      assert.throws(
        () =>
          sql
            .prepare('UPDATE baixa_andamentos SET texto=? WHERE baixa_id=?')
            .run('Alterar', c.id),
        /imutaveis/,
      );
      assert.throws(
        () =>
          sql
            .prepare('DELETE FROM baixa_andamentos WHERE baixa_id=?')
            .run(c.id),
        /imutaveis/,
      );
      const d = await abrir(),
        body = {
          para: 'recusada',
          texto: 'Motivo fictício',
          expectedRevision: 0,
        },
        headers = { 'idempotency-key': 'baixa-ficticia-transicao' };
      assert.equal(
        (await post(`baixas/${d.id}/transicao`, body, 'editor', headers))
          .status,
        200,
      );
      const depois = contagens();
      assert.equal(
        (await post(`baixas/${d.id}/transicao`, body, 'editor', headers))
          .status,
        200,
      );
      assert.deepEqual(contagens(), depois);
      assert.equal(
        (
          await post(
            `baixas/${d.id}/transicao`,
            { ...body, texto: 'Outro' },
            'editor',
            headers,
          )
        ).status,
        409,
      );
      assert.equal(registro(d.id).motivo_recusa, 'Motivo fictício');
      assert.equal(registro(d.id).atendente_id, 'editor');
      const e = await abrir(),
        original = registro(e.id);
      await mover(e.id, 'baixada');
      assert.equal(
        (await post('baixas', entrada({ numero_os: original.numero_os })))
          .status,
        201,
      );
    },
  );
  await t.test('itens na abertura, edição otimista, atendimento parcial e status calculado',async()=>{
    const litro=await post('itens',{descricao:'Fluido api fictício',unidade:'L'},admin),un=await post('itens',{descricao:'Parafuso api fictício',unidade:'un'},admin),metro=await post('itens',{descricao:'Mangueira api fictícia',unidade:'m'},admin),litroId=litro.data.id,unId=un.data.id,metroId=metro.data.id;
    assert.equal((await post('baixas',entrada({itens:[{itemId:'item_legado',quantidade:1}]}))).status,400);
    assert.equal((await post('baixas',entrada({itens:[{itemId:unId,quantidade:1.5}]}))).status,400);
    assert.equal((await post('baixas',entrada({itens:[{itemId:litroId,quantidade:1.234}]}))).status,400);
    assert.equal((await post('baixas',entrada({itens:[{itemId:litroId,quantidade:1},{itemId:litroId,quantidade:2}]}))).status,400);
    assert.equal((await put(`itens/${litroId}`,{ativo:false,expectedRevision:0})).status,200);
    assert.equal((await post('baixas',entrada({itens:[{itemId:litroId,quantidade:1}]}))).status,400);
    assert.equal((await put(`itens/${litroId}`,{ativo:true,expectedRevision:1})).status,200);
    const criada=await abrir(entrada({itens:[{itemId:unId,quantidade:2},{itemId:litroId,quantidade:1.25},{itemId:metroId,quantidade:4.5}]})),detalhe=await get(`baixas/${criada.id}`);
    assert.equal(detalhe.data.itens.find(i=>i.item_id===litroId).quantidade,1.25);
    assert.equal(Object.hasOwn(detalhe.data.itens[0],'request_key'),false);
    const editBody={expectedRevision:0,itens:[{itemId:unId,quantidade:3},{itemId:litroId,quantidade:2.5}]},editKey={'idempotency-key':'editar-itens-ficticio'};
    const edit=await pedir('PUT',`baixas/${criada.id}/itens`,'viewer',editBody,editKey);assert.equal(edit.status,200);
    const idsDepoisEdit=sql.prepare('SELECT id FROM baixa_itens WHERE baixa_id=? ORDER BY item_id').all(criada.id).map(i=>i.id);
    assert.equal((await pedir('PUT',`baixas/${criada.id}/itens`,'viewer',editBody,editKey)).status,200);
    assert.deepEqual(sql.prepare('SELECT id FROM baixa_itens WHERE baixa_id=? ORDER BY item_id').all(criada.id).map(i=>i.id),idsDepoisEdit);
    assert.equal((await get(`baixas/${criada.id}`)).data.itens.length,2);
    assert.equal((await pedir('PUT',`baixas/${criada.id}/itens`,'outro',{expectedRevision:1,itens:[{itemId:unId,quantidade:4}]})).status,404);
    assert.equal((await pedir('PUT',`baixas/${criada.id}/itens`,'viewer',{expectedRevision:0,itens:[{itemId:unId,quantidade:4}]})).data.codigo,'revisao');
    const pendentes=(await get(`baixas/${criada.id}`)).data.itens;
    const atenderBody={expectedRevision:1,itens:[{id:pendentes[0].id,para:'baixado'}]},atenderKey={'idempotency-key':'atender-itens-ficticio'};
    assert.equal((await post(`baixas/${criada.id}/atender-itens`,atenderBody,'editor',atenderKey)).status,200);
    assert.equal((await post(`baixas/${criada.id}/atender-itens`,atenderBody,'editor',atenderKey)).status,200);
    assert.equal(registro(criada.id).status,'aberta');
    const restante=(await get(`baixas/${criada.id}`)).data.itens.find(i=>i.status==='pendente');
    assert.equal((await post(`baixas/${criada.id}/atender-itens`,{expectedRevision:2,itens:[{id:restante.id,para:'recusado'}]},'editor')).status,400);
    assert.equal((await post(`baixas/${criada.id}/atender-itens`,{expectedRevision:2,itens:[{id:restante.id,para:'recusado',motivo:'Sem saldo fictício'}]},'editor')).status,200);
    assert.equal(registro(criada.id).status,'baixada');
    assert.equal((await get('baixas')).data.baixas.find(b=>b.id===criada.id).itens_baixados,1);
  });
  await t.test('filtros, paginacao e dia de negocio de Brasilia', async () => {
    for (const [numero_os, criado] of [
      ['7001', '2026-10-25T02:59:59Z'],
      ['7002', '2026-10-25T03:00:00Z'],
      ['7003', '2026-10-26T02:59:59Z'],
      ['7004', '2026-10-26T03:00:00Z'],
    ]) {
      const b = await abrir(
        entrada({ numero_os, estoque_id: estoqueB.id }),
      );
      sql
        .prepare('UPDATE baixas_estoque SET criado_em=? WHERE id=?')
        .run(criado, b.id);
    }
    assert.deepEqual(
      (
        await get(
          `baixas?de=2026-10-25&ate=2026-10-25&estoque=${estoqueB.id}`,
        )
      ).data.baixas
        .map((b) => b.numero_os)
        .sort(),
      ['7002', '7003'],
    );
    for (const query of [
      'status=invalida',
      'de=invalida',
      'de=2026-10-26&ate=2026-10-25',
      'estoque=',
    ])
      assert.equal((await get(`baixas?${query}`)).status, 400);
    const lista = await get('baixas?status=baixada&pageSize=10', 'editor');
    assert.ok(lista.data.baixas.every((b) => b.status === 'baixada'));
    assert.ok(lista.data.baixas.length <= 10);
  });
  await t.test('filtro preserva estoque inativo usado em outra pagina sem ampliar posse', async () => {
    const estoque = await post('estoques', { nome: 'Historico ficticio' }, admin);
    const b = await abrir(entrada({ estoque_id: estoque.data.id }));
    assert.equal((await put(`estoques/${estoque.data.id}`, { ativo: false, expectedRevision: 0 })).status, 200);
    assert.equal((await get('estoques')).data.estoques.some(e => e.id === estoque.data.id), false);
    assert.ok((await get('baixas?pageSize=10&page=2')).data.estoques_com_pedidos.some(e => e.id === estoque.data.id));
    assert.equal((await get('baixas', 'outro')).data.estoques_com_pedidos.some(e => e.id === estoque.data.id), false);
    assert.equal((await get(`baixas?estoque=${estoque.data.id}`)).data.baixas[0].id, b.id);
  });
  await t.test(
    'avisos certos por pode, sem autor nem email; motivo entregue ao solicitante',
    async () => {
      const emails = contagens().at(-1),
        b = await abrir();
      assert.deepEqual(
        avisos(b.id)
          .map((a) => a.user_id)
          .sort((a, b) => a.localeCompare(b)),
        [admin, 'editor'].sort((a, b) => a.localeCompare(b)),
      );
      await mover(b.id, 'recusada', 'Sem saldo fictício');
      const resposta = avisos(b.id).find((a) => a.user_id === 'viewer');
      assert.ok(resposta.texto.includes('Recusada'));
      const propria = await abrir(entrada(), 'editor');
      assert.deepEqual(
        avisos(propria.id).map((a) => a.user_id),
        [admin],
      );
      await mover(propria.id, 'baixada');
      assert.deepEqual(
        avisos(propria.id).map((a) => a.user_id),
        [admin],
      );
      assert.equal(contagens().at(-1), emails);
      sql.prepare('UPDATE users SET role=? WHERE id=?').run('viewer', 'editor');
      try {
        const c = await abrir();
        assert.deepEqual(
          avisos(c.id).map((a) => a.user_id),
          [admin],
        );
      } finally {
        sql
          .prepare('UPDATE users SET role=? WHERE id=?')
          .run('editor', 'editor');
      }
    },
  );
  await t.test(
    'rollback sem aviso orfao e estoque desativado entre leitura e lote',
    async () => {
      const b = await abrir(),
        antes = contagens(),
        log = console.error;
      console.error = () => {};
      sql.exec(
        "CREATE TRIGGER falhar_aviso_baixa BEFORE INSERT ON notificacoes_usuario WHEN NEW.tipo='baixa' BEGIN SELECT RAISE(ABORT,'falha ficticia'); END",
      );
      try {
        assert.equal((await post('baixas', entrada())).status, 500);
        assert.equal((await mover(b.id, 'baixada')).status, 500);
        assert.deepEqual(contagens(), antes);
        assert.equal(registro(b.id).revision, 0);
      } finally {
        sql.exec('DROP TRIGGER falhar_aviso_baixa');
        console.error = log;
      }
      globalThis[chave] = {
        ...db,
        async batch(instrucoes) {
          sql
            .prepare('UPDATE estoques SET ativo=0 WHERE id=?')
            .run(estoqueA.id);
          return db.batch(instrucoes);
        },
      };
      try {
        assert.equal((await post('baixas', entrada())).status, 409);
        assert.deepEqual(contagens(), antes);
      } finally {
        globalThis[chave] = db;
        sql
          .prepare('UPDATE estoques SET ativo=1 WHERE id=?')
          .run(estoqueA.id);
      }
    },
  );
  await t.test(
    'build, validacao ativa e revalidacao da acao no lote',
    async () => {
      const b = await abrir(),
        antes = contagens();
      assert.equal(
        (
          await post('baixas', entrada(), 'viewer', {
            'x-portal-build': 'antigo',
          })
        ).status,
        409,
      );
      sql.exec(
        'INSERT OR REPLACE INTO operacao_validacao(id,ativa) VALUES(1,1)',
      );
      try {
        assert.equal((await post('baixas', entrada())).status, 503);
        assert.equal((await mover(b.id, 'baixada')).status, 503);
        assert.equal(
          (await post('estoques', { nome: 'Teste' }, admin)).status,
          503,
        );
        assert.equal(
          (
            await put(`estoques/${estoqueA.id}`, {
              ativo: false,
              expectedRevision: 0,
            })
          ).status,
          503,
        );
        assert.equal((await get(`baixas/${b.id}`)).status, 200);
      } finally {
        sql.exec('UPDATE operacao_validacao SET ativa=0');
      }
      for (const [usuario, caminho, body] of [
        ['viewer', 'baixas', entrada()],
        [
          'editor',
          `baixas/${b.id}/transicao`,
          { para: 'baixada', expectedRevision: 0 },
        ],
        [admin, 'estoques', { nome: 'Novo fictício' }],
      ]) {
        globalThis[chave] = {
          ...db,
          async batch(instrucoes) {
            sql.prepare('DELETE FROM sessions WHERE user_id=?').run(usuario);
            return db.batch(instrucoes);
          },
        };
        try {
          assert.equal((await post(caminho, body, usuario)).status, 403);
          assert.deepEqual(contagens(), antes);
        } finally {
          globalThis[chave] = db;
          await sessao(usuario);
        }
      }
    },
  );
  await t.test(
    'demonstracao idempotente com consulta e suprimentos pelo roteador',
    async () => {
      const cliente = () => {
        let user;
        return async (rota, method = 'GET', body, key) => {
          if (rota === '/login') {
            user = body.role === 'admin' ? admin : body.role;
            return {};
          }
          if (rota === '/logout') return {};
          const r = await pedir(
            method,
            rota.slice(1),
            user,
            body,
            key ? { 'idempotency-key': key } : {},
          );
          assert.ok(r.status < 400, JSON.stringify(r));
          return r.data;
        };
      };
      const exemplo = { usuarios: [{ role: 'viewer' }, { role: 'editor' }, { role: 'admin' }] },
        estado = {};
      let salvos = 0;
      await semearBaixas(
        cliente,
        'http://fixture',
        exemplo,
        estado,
        () => salvos++,
      );
      const antes = contagens();
      await semearBaixas(cliente, 'http://fixture', exemplo, {}, () => {});
      assert.deepEqual(contagens(), antes);
      assert.equal(salvos, 6);
      assert.deepEqual(sql.prepare('SELECT descricao,unidade FROM itens_catalogo WHERE descricao LIKE ? ORDER BY descricao').all('%fictício%').map(i=>[i.descricao,i.unidade]),[['Filtro de óleo fictício','un'],['Fluido api fictício','L'],['Fluido fictício','L'],['Parafuso api fictício','un'],['Óleo de motor fictício','L']]);
      const demo = sql
        .prepare(
          "SELECT * FROM baixas_estoque WHERE numero_os BETWEEN '900001' AND '900004' ORDER BY numero_os",
        )
        .all();
      assert.deepEqual(
        demo.map((b) => b.status),
        ['aberta', 'aberta', 'baixada', 'recusada'],
      );
      assert.ok(
        demo.every(
          (b) => b.solicitante_id === 'viewer' && normalizarPlaca(b.placa),
        ),
      );
      assert.ok(demo.slice(2).every((b) => b.atendente_id === 'editor'));
    },
  );
  await t.test(
    'expurgo preserva; copia integral e restauracao incluem as tres tabelas',
    async () => {
      const protegidas = ['estoques', 'baixas_estoque', 'baixa_andamentos','itens_catalogo','baixa_itens','movimentos_estoque'];
      const dados = () =>
        Object.fromEntries(
          protegidas.map((tabela) => [
            tabela,
            sql.prepare(`SELECT * FROM ${tabela} ORDER BY rowid`).all(),
          ]),
        );
      const antes = dados();
      expurgar(
        sql,
        configurarExpurgo({
          EXPURGO_HABILITADO: '1',
          EXPURGO_EMAILS_DIAS: '0',
          EXPURGO_RELATORIOS_DIAS: '0',
          EXPURGO_IMPORTACOES_DIAS: '0',
        }),
        new Date('2099-01-01T12:00:00Z'),
      );
      assert.deepEqual(dados(), antes);
      const copia = criarCopiaIntegra(
          db.arquivo,
          path.join(pastaBackup, 'backup.sqlite'),
        ),
        restaurada = path.join(pastaBackup, 'restaurada.sqlite');
      prepararRestauracao(copia, restaurada, validarBanco);
      const restaurado = new DatabaseSync(restaurada);
      try {
        for (const tabela of protegidas)
          assert.deepEqual(
            restaurado.prepare(`SELECT * FROM ${tabela} ORDER BY rowid`).all(),
            antes[tabela],
          );
        assert.equal(
          restaurado.prepare('SELECT COUNT(*) n FROM sessions').get().n,
          0,
        );
      } finally {
        restaurado.close();
      }
    },
  );
});
