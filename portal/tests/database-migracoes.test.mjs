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

void test('baixas migram banco novo e versao 12 atomicamente e preservam marcador existente', async t => {
  const pasta=fs.mkdtempSync(path.join(os.tmpdir(),'sv-baixa-migracao-'));
  const db=bancoSqliteLocal({pastaPrivada:pasta,criar:true});
  const chave=Symbol.for('supply-vision:banco'), anterior=globalThis[chave], senha=env.INITIAL_ADMIN_PASSWORD;
  globalThis[chave]=db;env.INITIAL_ADMIN_PASSWORD='senha-ficticia-migracao-baixa';
  t.after(()=>{globalThis[chave]=anterior;env.INITIAL_ADMIN_PASSWORD=senha;db.fechar();fs.rmSync(pasta,{recursive:true,force:true});});
  await (await carregar('baixa-nova')).ensureDatabase();
  assert.equal(await db.prepare('SELECT COUNT(*) n FROM estoques').first('n'),0);
  assert.ok((await db.prepare('PRAGMA index_list(baixas_estoque)').all()).results.some(i=>i.name==='idx_baixas_estoque_id'));
  assert.ok((await db.prepare('PRAGMA index_list(consultas_cnpj)').all()).results.some(i=>i.name==='idx_consultas_cnpj_reuso'));
  const usuarios=(await db.prepare('SELECT * FROM users').all()).results;
  await db.exec('DROP INDEX idx_baixas_estoque_id; DROP INDEX idx_consultas_cnpj_reuso; DELETE FROM schema_migrations WHERE version=12');
  await db.exec("CREATE TRIGGER falhar_migracao_baixas BEFORE INSERT ON schema_migrations WHEN NEW.version=12 BEGIN SELECT RAISE(ABORT,'falha ficticia baixa'); END");
  const modulo=await carregar('baixa-existente-falha');
  await assert.rejects(modulo.ensureDatabase(),/falha ficticia baixa/);
  assert.equal(await db.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE type='index' AND name IN ('idx_baixas_estoque_id','idx_consultas_cnpj_reuso')").first('n'),0);
  assert.deepEqual((await db.prepare('SELECT * FROM users').all()).results,usuarios);
  await db.exec('DROP TRIGGER falhar_migracao_baixas');await modulo.ensureDatabase();
  const marcador=await db.prepare('SELECT * FROM schema_migrations WHERE version=12').first();
  await db.prepare("INSERT INTO estoques(id,nome,nome_chave) VALUES('estoque-teste-a','Estoque Teste A','ESTOQUE TESTE A')").run();
  await db.prepare("UPDATE estoques SET ativo=0,revision=1 WHERE id='estoque-teste-a'").run();
  await (await carregar('baixa-reinicio')).ensureDatabase();
  assert.deepEqual(await db.prepare('SELECT * FROM schema_migrations WHERE version=12').first(),marcador);
  assert.equal(await db.prepare('SELECT COUNT(*) n FROM estoques').first('n'),1);
  assert.equal(await db.prepare("SELECT ativo FROM estoques WHERE id='estoque-teste-a'").first('ativo'),0);
  assert.deepEqual((await db.prepare('SELECT * FROM users').all()).results,usuarios);
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
  assert.deepEqual((await db.prepare('SELECT version FROM ordem_migracoes ORDER BY posicao').all()).results.map(r => r.version), [1,2,3,4,5,6,7,8,9,10,11,12]);
  const antes = (await db.prepare('SELECT * FROM schema_migrations ORDER BY version').all()).results;
  const usuarios = (await db.prepare('SELECT * FROM users ORDER BY id').all()).results;
  await (await carregar('reinicio')).ensureDatabase();
  assert.deepEqual((await db.prepare('SELECT * FROM schema_migrations ORDER BY version').all()).results, antes);
  assert.deepEqual((await db.prepare('SELECT * FROM users ORDER BY id').all()).results, usuarios);
  assert.equal(await db.prepare('SELECT COUNT(*) FROM ordem_migracoes').first('COUNT(*)'), 12);
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
  assert.equal(await db.prepare('PRAGMA foreign_keys').first('foreign_keys'), 1);
});
