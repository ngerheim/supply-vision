import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { bancoSqliteLocal } from '../lib/sqlite-local.ts';
import { env } from '../scripts/configuracao-servidor.mjs';

async function carregar(sufixo) {
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === '@/lib/domain') return { url: new URL('../lib/domain.ts', import.meta.url).href, shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
  try { return await import(`../lib/database.ts?${sufixo}`); }
  finally { hooks.deregister(); }
}

void test('baixas migram banco novo e versao 10 atomicamente e preservam marcador existente', async t => {
  const pasta=fs.mkdtempSync(path.join(os.tmpdir(),'sv-baixa-migracao-'));
  const db=bancoSqliteLocal({pastaPrivada:pasta,criar:true});
  const chave=Symbol.for('supply-vision:banco'), anterior=globalThis[chave], senha=env.INITIAL_ADMIN_PASSWORD;
  globalThis[chave]=db;env.INITIAL_ADMIN_PASSWORD='senha-ficticia-migracao-baixa';
  t.after(()=>{globalThis[chave]=anterior;env.INITIAL_ADMIN_PASSWORD=senha;db.fechar();fs.rmSync(pasta,{recursive:true,force:true});});
  await (await carregar('baixa-nova')).ensureDatabase();
  assert.equal(await db.prepare('SELECT COUNT(*) n FROM estoques').first('n'),0);
  const usuarios=(await db.prepare('SELECT * FROM users').all()).results;
  await db.exec('DROP TABLE baixa_andamentos; DROP TABLE baixas_estoque; DROP TABLE estoques; DELETE FROM schema_migrations WHERE version=11');
  await db.exec("CREATE TRIGGER falhar_migracao_baixas BEFORE INSERT ON schema_migrations WHEN NEW.version=11 BEGIN SELECT RAISE(ABORT,'falha ficticia baixa'); END");
  const modulo=await carregar('baixa-existente-falha');
  await assert.rejects(modulo.ensureDatabase(),/falha ficticia baixa/);
  assert.equal(await db.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE type='table' AND name='estoques'").first('n'),0);
  assert.deepEqual((await db.prepare('SELECT * FROM users').all()).results,usuarios);
  await db.exec('DROP TRIGGER falhar_migracao_baixas');await modulo.ensureDatabase();
  const marcador=await db.prepare('SELECT * FROM schema_migrations WHERE version=11').first();
  await db.prepare("INSERT INTO estoques(id,nome,nome_chave) VALUES('estoque-teste-a','Estoque Teste A','ESTOQUE TESTE A')").run();
  await db.prepare("UPDATE estoques SET ativo=0,revision=1 WHERE id='estoque-teste-a'").run();
  await (await carregar('baixa-reinicio')).ensureDatabase();
  assert.deepEqual(await db.prepare('SELECT * FROM schema_migrations WHERE version=11').first(),marcador);
  assert.equal(await db.prepare('SELECT COUNT(*) n FROM estoques').first('n'),1);
  assert.equal(await db.prepare("SELECT ativo FROM estoques WHERE id='estoque-teste-a'").first('ativo'),0);
  assert.deepEqual((await db.prepare('SELECT * FROM users').all()).results,usuarios);
});

void test('pagamentos migram em lote atomico, retomam apos falha e preservam marcador', async t => {
  const pasta=fs.mkdtempSync(path.join(os.tmpdir(),'sv-pagamento-migracao-'));
  const db=bancoSqliteLocal({pastaPrivada:pasta,criar:true});
  const chave=Symbol.for('supply-vision:banco'), anterior=globalThis[chave], senha=env.INITIAL_ADMIN_PASSWORD;
  globalThis[chave]=db;env.INITIAL_ADMIN_PASSWORD='senha-ficticia-pagamento';
  t.after(()=>{globalThis[chave]=anterior;env.INITIAL_ADMIN_PASSWORD=senha;db.fechar();fs.rmSync(pasta,{recursive:true,force:true});});
  await (await carregar('pagamento-novo')).ensureDatabase();
  assert.ok(await db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='pagamentos'").first());
  await db.exec('DROP TRIGGER pagamento_andamentos_imutavel_update; DROP TRIGGER pagamento_andamentos_imutavel_delete; DROP INDEX idx_pagamento_andamentos; DROP INDEX idx_pagamentos_solicitante; DROP INDEX idx_pagamentos_status_atualizado; DROP TABLE pagamento_andamentos; DROP TABLE pagamento_anexos; DROP TABLE pagamentos; DELETE FROM schema_migrations WHERE version=15');
  await db.exec("CREATE TRIGGER falhar_pagamento BEFORE INSERT ON schema_migrations WHEN NEW.version=15 BEGIN SELECT RAISE(ABORT,'falha ficticia pagamento'); END");
  const modulo=await carregar('pagamento-falha');
  await assert.rejects(modulo.ensureDatabase(),/falha ficticia pagamento/);
  assert.equal(await db.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE type='table' AND name IN ('pagamentos','pagamento_anexos','pagamento_andamentos')").first('n'),0);
  assert.equal(await db.prepare('SELECT 1 FROM schema_migrations WHERE version=15').first(),null);
  await db.exec('DROP TRIGGER falhar_pagamento');await modulo.ensureDatabase();
  const marcador=await db.prepare('SELECT * FROM schema_migrations WHERE version=15').first();
  await (await carregar('pagamento-reinicio')).ensureDatabase();
  assert.deepEqual(await db.prepare('SELECT * FROM schema_migrations WHERE version=15').first(),marcador);
});

void test('itens migram versao 12 atomicamente, convertem baixas legadas e retomam', async t => {
  const pasta=fs.mkdtempSync(path.join(os.tmpdir(),'sv-itens-migracao-'));
  const db=bancoSqliteLocal({pastaPrivada:pasta,criar:true});
  const chave=Symbol.for('supply-vision:banco'), anterior=globalThis[chave], senha=env.INITIAL_ADMIN_PASSWORD;
  globalThis[chave]=db;env.INITIAL_ADMIN_PASSWORD='senha-ficticia-migracao-itens';
  t.after(()=>{globalThis[chave]=anterior;env.INITIAL_ADMIN_PASSWORD=senha;db.fechar();fs.rmSync(pasta,{recursive:true,force:true});});
  await (await carregar('itens-base')).ensureDatabase();
  const user=(await db.prepare('SELECT id FROM users LIMIT 1').first()).id;
  await db.prepare("INSERT INTO estoques(id,nome,nome_chave) VALUES('est-mig','Estoque fictício','ESTOQUE FICTICIO')").run();
  for (const [id,status] of [['b-aberta','aberta'],['b-baixada','baixada'],['b-recusada','recusada']])
    await db.prepare('INSERT INTO baixas_estoque(id,numero_os,estoque_id,placa,status,solicitante_id,motivo_recusa,atendente_id,criado_em,atualizado_em) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .bind(id,String(['b-aberta','b-baixada','b-recusada'].indexOf(id)+1),'est-mig','ABC1234',status,user,status==='recusada'?'Motivo fictício':null,status==='aberta'?null:user,'2026-01-01','2026-01-02').run();
  await db.exec('DROP INDEX idx_baixa_itens_baixa_id; DROP INDEX idx_baixa_itens_item_id; DROP TABLE baixa_itens; DROP TABLE itens_catalogo_tentativas; DROP TABLE itens_catalogo; DELETE FROM schema_migrations WHERE version=13');
  const users=(await db.prepare('SELECT * FROM users').all()).results, baixas=(await db.prepare('SELECT * FROM baixas_estoque ORDER BY id').all()).results;
  await db.exec("CREATE TRIGGER falhar_migracao_itens BEFORE INSERT ON schema_migrations WHEN NEW.version=13 BEGIN SELECT RAISE(ABORT,'falha ficticia itens'); END");
  const modulo=await carregar('itens-falha');
  await assert.rejects(modulo.ensureDatabase(),/falha ficticia itens/);
  assert.equal(await db.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE type='table' AND name IN ('itens_catalogo','baixa_itens','itens_catalogo_tentativas')").first('n'),0);
  assert.deepEqual((await db.prepare('SELECT * FROM baixas_estoque ORDER BY id').all()).results,baixas);
  assert.deepEqual((await db.prepare('SELECT * FROM users').all()).results,users);
  await db.exec('DROP TRIGGER falhar_migracao_itens');await modulo.ensureDatabase();
  assert.deepEqual((await db.prepare('SELECT baixa_id,status,quantidade_centesimos,motivo_recusa,atendente_id,atendido_em FROM baixa_itens ORDER BY baixa_id').all()).results.map(r=>[r.baixa_id,r.status,r.quantidade_centesimos,r.motivo_recusa,r.atendente_id,!!r.atendido_em]),[
    ['b-aberta','pendente',100,null,null,false],['b-baixada','baixado',100,null,user,true],['b-recusada','recusado',100,'Motivo fictício',user,true],
  ]);
  assert.equal(await db.prepare("SELECT COUNT(*) n FROM itens_catalogo WHERE id='item_legado' AND ativo=0").first('n'),1);
  assert.equal(await db.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE type='table' AND name='itens_catalogo_tentativas'").first('n'),1);
  const marcador=await db.prepare('SELECT * FROM schema_migrations WHERE version=13').first();
  await (await carregar('itens-reinicio')).ensureDatabase();
  assert.deepEqual(await db.prepare('SELECT * FROM schema_migrations WHERE version=13').first(),marcador);
  assert.equal(await db.prepare('SELECT COUNT(*) n FROM baixa_itens').first('n'),3);
});

void test('indices da versao 12 migram atomicamente e retomam apos falha', async t => {
  const pasta=fs.mkdtempSync(path.join(os.tmpdir(),'sv-indices-migracao-'));
  const db=bancoSqliteLocal({pastaPrivada:pasta,criar:true});
  const chave=Symbol.for('supply-vision:banco'), anterior=globalThis[chave], senha=env.INITIAL_ADMIN_PASSWORD;
  globalThis[chave]=db;env.INITIAL_ADMIN_PASSWORD='senha-ficticia-indices-migracao';
  t.after(()=>{globalThis[chave]=anterior;env.INITIAL_ADMIN_PASSWORD=senha;db.fechar();fs.rmSync(pasta,{recursive:true,force:true});});
  await (await carregar('indices-novos')).ensureDatabase();
  const nomes=['idx_baixas_estoque_id','idx_consultas_cnpj_reuso'];
  const temIndices=async()=>{
    const baixas=(await db.prepare('PRAGMA index_list(baixas_estoque)').all()).results.map(i=>i.name);
    const consultas=(await db.prepare('PRAGMA index_list(consultas_cnpj)').all()).results.map(i=>i.name);
    return nomes.every(nome=>baixas.includes(nome)||consultas.includes(nome));
  };
  assert.equal(await temIndices(),true);
  const usuarios=(await db.prepare('SELECT * FROM users').all()).results;
  await db.exec('DROP INDEX idx_baixas_estoque_id; DROP INDEX idx_consultas_cnpj_reuso; DELETE FROM schema_migrations WHERE version=12');
  await db.exec("CREATE TRIGGER falhar_migracao_indices BEFORE INSERT ON schema_migrations WHEN NEW.version=12 BEGIN SELECT RAISE(ABORT,'falha ficticia indices'); END");
  const modulo=await carregar('indices-falha');
  await assert.rejects(modulo.ensureDatabase(),/falha ficticia indices/);
  assert.equal(await temIndices(),false);
  assert.deepEqual((await db.prepare('SELECT * FROM users').all()).results,usuarios);
  assert.equal(await db.prepare('SELECT 1 FROM schema_migrations WHERE version=12').first(),null);
  await db.exec('DROP TRIGGER falhar_migracao_indices');await modulo.ensureDatabase();
  const marcador=await db.prepare('SELECT * FROM schema_migrations WHERE version=12').first();
  assert.equal(await temIndices(),true);
  await (await carregar('indices-reinicio')).ensureDatabase();
  assert.deepEqual(await db.prepare('SELECT * FROM schema_migrations WHERE version=12').first(),marcador);
});

void test('cadastro migra banco na versao 8 preservando legado e reaplica sem duplicar sementes', async t => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-cadastro-migracao-'));
  const db = bancoSqliteLocal({ pastaPrivada: pasta, criar: true });
  const chave = Symbol.for('supply-vision:banco'), anterior = globalThis[chave], senha = env.INITIAL_ADMIN_PASSWORD;
  globalThis[chave] = db; env.INITIAL_ADMIN_PASSWORD = 'senha-ficticia-migracao-cadastro';
  t.after(() => { globalThis[chave] = anterior; env.INITIAL_ADMIN_PASSWORD = senha; db.fechar(); fs.rmSync(pasta,{recursive:true,force:true}); });
  await (await carregar('cadastro-novo')).ensureDatabase();
  assert.equal(await db.prepare('SELECT COUNT(*) n FROM categorias_fornecedor').first('n'),3);
  const usuarios = (await db.prepare('SELECT * FROM users').all()).results;
  await db.exec('DROP TABLE consultas_cnpj; DROP TABLE solicitacao_categorias; DROP TABLE categorias_fornecedor; DROP TABLE solicitacao_andamentos; DROP TABLE solicitacoes; DELETE FROM schema_migrations WHERE version=9');
  await (await carregar('cadastro-existente')).ensureDatabase();
  assert.deepEqual((await db.prepare('SELECT * FROM users').all()).results,usuarios);
  assert.equal(await db.prepare('SELECT COUNT(*) n FROM categorias_fornecedor').first('n'),3);
  assert.equal(await db.prepare('SELECT COUNT(*) n FROM solicitacoes').first('n'),0);
  const marcador = await db.prepare('SELECT * FROM schema_migrations WHERE version=9').first();
  await db.prepare("UPDATE categorias_fornecedor SET ativo=0,revision=1 WHERE id='categoria_semente_1'").run();
  await (await carregar('cadastro-reinicio')).ensureDatabase();
  assert.deepEqual(await db.prepare('SELECT * FROM schema_migrations WHERE version=9').first(),marcador);
  assert.equal(await db.prepare('SELECT COUNT(*) n FROM categorias_fornecedor').first('n'),3);
  assert.equal(await db.prepare("SELECT ativo FROM categorias_fornecedor WHERE id='categoria_semente_1'").first('ativo'),0);
});

void test('fila migra versao 9 atomicamente, preserva entregas e indices e retoma apos falha', async t => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-fila-migracao-'));
  const db = bancoSqliteLocal({ pastaPrivada:pasta, criar:true });
  const chave = Symbol.for('supply-vision:banco'), anterior = globalThis[chave], senha = env.INITIAL_ADMIN_PASSWORD;
  globalThis[chave]=db; env.INITIAL_ADMIN_PASSWORD='senha-ficticia-fila';
  t.after(() => { globalThis[chave]=anterior; env.INITIAL_ADMIN_PASSWORD=senha; db.fechar(); fs.rmSync(pasta,{recursive:true,force:true}); });
  await (await carregar('fila-inicial')).ensureDatabase();
  // Materializa o DDL legado mantido pelo inicializador, sem duplicar schema.
  const fonte = fs.readFileSync(new URL('../lib/database.ts',import.meta.url),'utf8');
  const legado = [...fonte.matchAll(/`(CREATE TABLE IF NOT EXISTS email_notifications [^`]+)`/g)][0][1];
  await db.exec('DROP TABLE email_notifications; DELETE FROM schema_migrations WHERE version=10');
  await db.exec(legado);
  await db.prepare("INSERT INTO tickets(id,code,supplier_name,status,created_at,updated_at) VALUES('t-fila','SUP-FILA','Fornecedor Ficticio','aberto','x','x')").run();
  for (const status of ['pending','processing','sent','failed']) await db.prepare(`INSERT INTO email_notifications
    (id,ticket_id,event_id,type,recipient_name,recipient_email,payload_json,status,attempts,next_attempt_at,locked_at,sent_at,last_error,dedupe_key,created_at,updated_at)
    VALUES(?,'t-fila','evento','atribuicao','Pessoa','pessoa@example.com','{}',?,3,'proxima','trava','envio','erro',?,'criacao','atualizacao')`).bind(status,status,status).run();
  const antes = (await db.prepare('SELECT * FROM email_notifications ORDER BY id').all()).results;
  await db.exec("CREATE TRIGGER falhar_fila BEFORE INSERT ON schema_migrations WHEN NEW.version=10 BEGIN SELECT RAISE(ABORT,'falha ficticia'); END");
  const modulo = await carregar('fila-falha');
  await assert.rejects(modulo.ensureDatabase(),/falha ficticia/);
  assert.deepEqual((await db.prepare('SELECT * FROM email_notifications ORDER BY id').all()).results,antes);
  assert.equal(await db.prepare('SELECT COUNT(*) n FROM schema_migrations WHERE version=10').first('n'),0);
  await db.exec('DROP TRIGGER falhar_fila'); await modulo.ensureDatabase();
  const depois = (await db.prepare('SELECT * FROM email_notifications ORDER BY id').all()).results;
  assert.deepEqual(depois.map(({solicitacao_id,...linha}) => { assert.equal(solicitacao_id,null); return linha; }),antes);
  assert.equal((await db.prepare('PRAGMA table_info(email_notifications)').all()).results.find(c => c.name === 'ticket_id').notnull,0);
  assert.ok((await db.prepare('PRAGMA index_list(email_notifications)').all()).results.some(i => i.name === 'idx_email_notifications_queue'));
  await (await carregar('fila-reinicio')).ensureDatabase();
  assert.deepEqual((await db.prepare('SELECT * FROM email_notifications ORDER BY id').all()).results,depois);
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
});

void test('Central migra banco existente sem alterar usuarios e reaplica sem duplicar', async t => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-central-migracao-'));
  const db = bancoSqliteLocal({ pastaPrivada:pasta, criar:true });
  const chave = Symbol.for('supply-vision:banco'), anterior = globalThis[chave], senha = env.INITIAL_ADMIN_PASSWORD;
  globalThis[chave] = db; env.INITIAL_ADMIN_PASSWORD = 'senha-ficticia-migracao-central';
  t.after(() => { globalThis[chave] = anterior; env.INITIAL_ADMIN_PASSWORD = senha; db.fechar(); fs.rmSync(pasta,{recursive:true,force:true}); });
  await (await carregar('central-novo')).ensureDatabase();
  const usuarios = (await db.prepare('SELECT * FROM users').all()).results;
  await db.exec('DROP TABLE notificacoes_usuario; DELETE FROM schema_migrations WHERE version=8');
  await (await carregar('central-existente')).ensureDatabase();
  assert.deepEqual((await db.prepare('SELECT * FROM users').all()).results,usuarios);
  assert.equal(await db.prepare('SELECT COUNT(*) n FROM notificacoes_usuario').first('n'),0);
  const marcador = await db.prepare('SELECT * FROM schema_migrations WHERE version=8').first();
  await (await carregar('central-reinicio')).ensureDatabase();
  assert.deepEqual(await db.prepare('SELECT * FROM schema_migrations WHERE version=8').first(),marcador);
});

void test('marcador inserido por concorrente entre consulta e migracao nao conflita', async t => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-migracao-corrida-'));
  const db = bancoSqliteLocal({ pastaPrivada: pasta, criar: true });
  const chave = Symbol.for('supply-vision:banco'), anterior = globalThis[chave], senha = env.INITIAL_ADMIN_PASSWORD;
  const disputadas = [];
  globalThis[chave] = { ...db, prepare(sql) {
    const stmt = db.prepare(sql);
    const versao = sql.match(/^SELECT 1 ok FROM schema_migrations WHERE version=([2-5])$/)?.[1];
    if (!versao) return stmt;
    return { ...stmt, async first() {
      if (!await stmt.first()) {
        await db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').bind(Number(versao), 'concorrente').run();
        disputadas.push(Number(versao));
        return null;
      }
      return stmt.first();
    } };
  } };
  env.INITIAL_ADMIN_PASSWORD = 'senha-ficticia-concorrente';
  t.after(() => { globalThis[chave] = anterior; env.INITIAL_ADMIN_PASSWORD = senha; db.fechar(); fs.rmSync(pasta, { recursive: true, force: true }); });
  await (await carregar('corrida')).ensureDatabase();
  assert.deepEqual(disputadas, [2, 3, 4, 5]);
  assert.deepEqual((await db.prepare('SELECT applied_at FROM schema_migrations WHERE version BETWEEN 2 AND 5').all()).results.map(r => r.applied_at), Array(4).fill('concorrente'));
});

void test('falha ao inspecionar colunas bloqueia inicializacao e retomada migra em ordem sem regravar', async t => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-lote08-migracoes-'));
  const db = bancoSqliteLocal({ pastaPrivada: pasta, criar: true });
  const chave = Symbol.for('supply-vision:banco');
  const anterior = globalThis[chave], senhaAnterior = env.INITIAL_ADMIN_PASSWORD;
  const falha = new Error('falha ficticia de leitura do schema');
  let falhar = true;
  globalThis[chave] = {
    ...db,
    prepare(sql) {
      const consulta = db.prepare(sql);
      return falhar && sql.startsWith('PRAGMA table_info(')
        ? { ...consulta, async all() { throw falha; } }
        : consulta;
    },
  };
  env.INITIAL_ADMIN_PASSWORD = 'senha-ficticia-lote08';
  t.after(() => {
    if (anterior === undefined) delete globalThis[chave]; else globalThis[chave] = anterior;
    env.INITIAL_ADMIN_PASSWORD = senhaAnterior;
    db.fechar();
    fs.rmSync(pasta, { recursive: true, force: true });
  });
  const { ensureDatabase } = await carregar('falha');
  await assert.rejects(ensureDatabase(), erro => erro === falha);
  assert.equal(await db.prepare('SELECT COUNT(*) FROM schema_migrations').first('COUNT(*)'), 0);
  // Observa a ordem real das insercoes, sem copiar as migracoes para o teste.
  await db.exec(`CREATE TABLE ordem_migracoes(posicao INTEGER PRIMARY KEY,version INTEGER);
    CREATE TRIGGER registrar_ordem AFTER INSERT ON schema_migrations BEGIN
      INSERT INTO ordem_migracoes(version) VALUES(NEW.version);
    END`);
  falhar = false;
  await ensureDatabase();
  assert.deepEqual((await db.prepare('SELECT version FROM ordem_migracoes ORDER BY posicao').all()).results.map(r => r.version), [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17]);
  const antes = (await db.prepare('SELECT * FROM schema_migrations ORDER BY version').all()).results;
  const usuarios = (await db.prepare('SELECT * FROM users ORDER BY id').all()).results;
  await (await carregar('reinicio')).ensureDatabase();
  assert.deepEqual((await db.prepare('SELECT * FROM schema_migrations ORDER BY version').all()).results, antes);
  assert.deepEqual((await db.prepare('SELECT * FROM users ORDER BY id').all()).results, usuarios);
  assert.equal(await db.prepare('SELECT COUNT(*) FROM ordem_migracoes').first('COUNT(*)'), 17);
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
  assert.equal(await db.prepare('PRAGMA foreign_keys').first('foreign_keys'), 1);
});

void test('migração 14 cria movimentos de estoque atomicamente, retoma e preserva marcador', async t => {
  const pasta=fs.mkdtempSync(path.join(os.tmpdir(),'sv-movimentos-migracao-'));
  const db=bancoSqliteLocal({pastaPrivada:pasta,criar:true}),chave=Symbol.for('supply-vision:banco'),anterior=globalThis[chave],senha=env.INITIAL_ADMIN_PASSWORD;
  globalThis[chave]=db;env.INITIAL_ADMIN_PASSWORD='senha-ficticia-migracao-movimentos';
  t.after(()=>{globalThis[chave]=anterior;env.INITIAL_ADMIN_PASSWORD=senha;db.fechar();fs.rmSync(pasta,{recursive:true,force:true});});
  await (await carregar('movimentos-14-base')).ensureDatabase();
  await db.exec('DROP TRIGGER movimentos_estoque_imutavel_update; DROP TRIGGER movimentos_estoque_imutavel_delete; DROP INDEX idx_movimentos_estoque_item; DROP INDEX idx_movimentos_item; DROP INDEX idx_movimentos_origem; DROP INDEX idx_movimentos_criado; DROP TABLE movimentos_estoque; DROP INDEX idx_baixa_itens_baixa_id; DROP INDEX idx_baixa_itens_item_id; DROP TABLE baixa_itens; DELETE FROM schema_migrations WHERE version=14; ALTER TABLE catalog_items DROP COLUMN unidade_estoque');
  await db.prepare("INSERT INTO catalog_items(id,name,active) VALUES('catalogo-m14','ITEM FICTÍCIO 14',1)").run();
  await db.prepare("INSERT INTO itens_catalogo(id,descricao,descricao_chave,unidade,ativo) VALUES('itm-m14','Item fictício 14','ITEM FICTICIO 14','kg',1)").run();
  await db.prepare("INSERT INTO itens_catalogo(id,descricao,descricao_chave,unidade,ativo) VALUES('itm-novo-m14','Item novo 14','ITEM NOVO 14','m',1)").run();
  await db.exec("CREATE TABLE baixa_itens(id TEXT PRIMARY KEY,baixa_id TEXT NOT NULL REFERENCES baixas_estoque(id),item_id TEXT NOT NULL REFERENCES itens_catalogo(id),quantidade_centesimos INTEGER NOT NULL CHECK(quantidade_centesimos>0),status TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','baixado','recusado')),motivo_recusa TEXT,atendente_id TEXT REFERENCES users(id),atendido_em TEXT,criado_em TEXT NOT NULL,atualizado_em TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,UNIQUE(baixa_id,item_id)); CREATE INDEX idx_baixa_itens_baixa_id ON baixa_itens(baixa_id); CREATE INDEX idx_baixa_itens_item_id ON baixa_itens(item_id);");
  const usr=(await db.prepare('SELECT id FROM users LIMIT 1').first()).id;
  await db.prepare("INSERT INTO estoques(id,nome,nome_chave) VALUES('est-m14','Estoque fictício 14','ESTOQUE FICTICIO 14')").run();
  await db.prepare("INSERT INTO baixas_estoque(id,numero_os,estoque_id,placa,solicitante_id,criado_em,atualizado_em) VALUES('bxa-m14','981014','est-m14','ABC1234',?,'x','x')").bind(usr).run();
  await db.prepare("INSERT INTO baixa_itens(id,baixa_id,item_id,quantidade_centesimos,criado_em,atualizado_em) VALUES('bi-m14','bxa-m14','itm-m14',250,'x','x')").run();
  await db.prepare("INSERT INTO baixa_itens(id,baixa_id,item_id,quantidade_centesimos,criado_em,atualizado_em) VALUES('bi-novo-m14','bxa-m14','itm-novo-m14',350,'x','x')").run();
  await db.exec("CREATE TABLE movimentos_estoque(id TEXT PRIMARY KEY,estoque_id TEXT NOT NULL REFERENCES estoques(id),item_id TEXT NOT NULL REFERENCES itens_catalogo(id),tipo TEXT NOT NULL CHECK(tipo IN ('entrada','saida','ajuste','estorno')),quantidade_centesimos INTEGER NOT NULL CHECK(quantidade_centesimos<>0),documento TEXT,observacao TEXT,origem_tipo TEXT,origem_id TEXT,movimento_estornado_id TEXT UNIQUE REFERENCES movimentos_estoque(id),user_id TEXT REFERENCES users(id),data_movimento TEXT NOT NULL,criado_em TEXT NOT NULL,request_key TEXT,request_hash TEXT,UNIQUE(user_id,request_key)); CREATE INDEX idx_movimentos_estoque_item ON movimentos_estoque(estoque_id,item_id); CREATE INDEX idx_movimentos_item ON movimentos_estoque(item_id); CREATE INDEX idx_movimentos_origem ON movimentos_estoque(origem_tipo,origem_id); CREATE INDEX idx_movimentos_criado ON movimentos_estoque(criado_em); CREATE TRIGGER movimentos_estoque_imutavel_update BEFORE UPDATE ON movimentos_estoque BEGIN SELECT RAISE(ABORT,'Movimentos de estoque sao imutaveis'); END; CREATE TRIGGER movimentos_estoque_imutavel_delete BEFORE DELETE ON movimentos_estoque BEGIN SELECT RAISE(ABORT,'Movimentos de estoque sao imutaveis'); END;");
  await db.prepare("INSERT INTO movimentos_estoque(id,estoque_id,item_id,tipo,quantidade_centesimos,user_id,data_movimento,criado_em) VALUES('mov-origem-m14','est-m14','itm-m14','entrada',300,?,'2026-10-27','x')").bind(usr).run();
  await db.prepare("INSERT INTO movimentos_estoque(id,estoque_id,item_id,tipo,quantidade_centesimos,movimento_estornado_id,user_id,data_movimento,criado_em) VALUES('mov-estorno-m14','est-m14','itm-m14','estorno',-300,'mov-origem-m14',?,'2026-10-27','x')").bind(usr).run();
  await db.exec("CREATE TRIGGER falhar_migracao_14 BEFORE INSERT ON schema_migrations WHEN NEW.version=14 BEGIN SELECT RAISE(ABORT,'falha ficticia versao 14'); END");
  const modulo=await carregar('movimentos-14-falha');
  await assert.rejects(modulo.ensureDatabase(),/falha ficticia versao 14/);
  assert.equal(await db.prepare("SELECT COUNT(*) n FROM movimentos_estoque").first('n'),2);
  assert.equal((await db.prepare("SELECT item_id FROM movimentos_estoque WHERE id='mov-origem-m14'").first()).item_id,'itm-m14');
  assert.equal(await db.prepare("SELECT COUNT(*) n FROM baixa_itens WHERE item_id='itm-m14'").first('n'),1);
  assert.equal(await db.prepare("SELECT COUNT(*) n FROM pragma_table_info('catalog_items') WHERE name='unidade_estoque'").first('n'),0);
  assert.equal(await db.prepare('SELECT 1 FROM schema_migrations WHERE version=14').first(),null);
  await db.exec('DROP TRIGGER falhar_migracao_14');await modulo.ensureDatabase();
  const marcador=await db.prepare('SELECT * FROM schema_migrations WHERE version=14').first();
  assert.ok(marcador);assert.equal(await db.prepare('SELECT COUNT(*) n FROM movimentos_estoque').first('n'),2);
  assert.deepEqual((await db.prepare('SELECT id,item_id,movimento_estornado_id FROM movimentos_estoque ORDER BY id').all()).results,[{id:'mov-estorno-m14',item_id:'catalogo-m14',movimento_estornado_id:'mov-origem-m14'},{id:'mov-origem-m14',item_id:'catalogo-m14',movimento_estornado_id:null}]);
  assert.equal((await db.prepare("SELECT item_id FROM baixa_itens WHERE id='bi-m14'").first()).item_id,'catalogo-m14');
  assert.equal((await db.prepare("SELECT unidade_estoque FROM catalog_items WHERE id='catalogo-m14'").first()).unidade_estoque,'kg');
  assert.equal((await db.prepare("SELECT name,unidade_estoque FROM catalog_items WHERE id='itm-novo-m14'").first()).name,'Item novo 14');
  assert.equal((await db.prepare("SELECT unidade_estoque FROM catalog_items WHERE id='itm-novo-m14'").first()).unidade_estoque,'m');
  assert.equal((await db.prepare("SELECT item_id FROM baixa_itens WHERE id='bi-novo-m14'").first()).item_id,'itm-novo-m14');
  assert.deepEqual(await db.prepare("SELECT name,active,unidade_estoque FROM catalog_items WHERE id='item_legado'").first(),{name:'Item não especificado (legado)',active:0,unidade_estoque:'un'});
  assert.equal(await db.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE type='table' AND name IN ('itens_catalogo','itens_catalogo_tentativas')").first('n'),2);
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_list(baixa_itens)').all()).results.filter(x=>x.from==='item_id').map(x=>x.table),['catalog_items']);
  await (await carregar('movimentos-14-reinicio')).ensureDatabase();
  assert.deepEqual(await db.prepare('SELECT * FROM schema_migrations WHERE version=14').first(),marcador);
  const usuario=usr;
  await db.prepare("INSERT INTO movimentos_estoque(id,estoque_id,item_id,tipo,quantidade_centesimos,user_id,data_movimento,criado_em) VALUES('mov-m14','est-m14','catalogo-m14','entrada',100,?,'2026-10-27','x')").bind(usuario).run();
  await assert.rejects(db.prepare("UPDATE movimentos_estoque SET observacao='Alteração' WHERE id='mov-m14'").run(),/imutaveis/);
  await assert.rejects(db.prepare("DELETE FROM movimentos_estoque WHERE id='mov-m14'").run(),/imutaveis/);
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
});
