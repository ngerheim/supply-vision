import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { lerLogFases, conferirAmostras, conferirBanco, versoesEsperadas, semearBanco, avaliarConsumidor, intervalosConsumidores, pidsConsumidores } from '../../scripts/ci/atualizacao-real.mjs';
import path from 'node:path';
import fs from 'node:fs';

const ok = fase => ({ fase, health: true, supervisor: true, consumidores: true, pidsConsumidores: { emails: 101, relatorios: 102 } });
void test('H2 reprova quedas no PREPARAR/CONCLUIR e atualizacao sem parada', () => {
  assert.doesNotThrow(() => conferirAmostras([ok('PREPARAR'), { ...ok('TROCAR'), health: false }, ok('CONCLUIR')]));
  for (const fase of ['PREPARAR', 'CONCLUIR']) {
    assert.throws(() => conferirAmostras([{ ...ok(fase), health: false }]), /Operacao caiu|PREPARAR nao/);
  }
  assert.throws(() => conferirAmostras([ok('PREPARAR'), ok('TROCAR'), ok('CONCLUIR')]), /Nenhuma parada/);
  assert.throws(() => conferirAmostras([ok('PREPARAR'), { ...ok('PREPARAR'), consumidores: false }], true), /Operacao caiu/);
});
void test('H2 tolera atraso de ciclo sob carga, mas detecta processo morto e consumidor travado', () => {
  const agora = Date.parse('2026-10-14T18:00:00Z');
  const intervalos = intervalosConsumidores(path.resolve(import.meta.dirname, '../..'));
  const vivo = () => {};
  const morto = () => { throw Object.assign(new Error('morto'), { code: 'ESRCH' }); };
  for (const intervalo of Object.values(intervalos)) {
    const pulso = idade => new Date(agora - idade).toISOString();
    assert.equal(avaliarConsumidor(101, pulso(31_000), intervalo, agora, vivo).disponivel, true);
    assert.equal(avaliarConsumidor(101, pulso(0), intervalo, agora, morto).disponivel, false);
    assert.equal(avaliarConsumidor(null, pulso(0), intervalo, agora, vivo).disponivel, false);
    assert.equal(avaliarConsumidor(101, pulso(3 * intervalo + 5001), intervalo, agora, vivo).disponivel, false);
    assert.equal(avaliarConsumidor(101, 'invalido', intervalo, agora, vivo).disponivel, false);
    assert.equal(avaliarConsumidor(101, pulso(-5001), intervalo, agora, vivo).disponivel, false);
  }
});
void test('H2 reprova troca de PID no PREPARAR e negativo, mesmo com ciclos recentes', () => {
  const reiniciado = { ...ok('PREPARAR'), pidsConsumidores: { emails: 201, relatorios: 102 } };
  for (const negativo of [false, true]) {
    assert.throws(() => conferirAmostras([ok('PREPARAR'), reiniciado], negativo), /Consumidores reiniciaram/);
  }
  const trocado = { ...ok('CONCLUIR'), pidsConsumidores: { emails: 201, relatorios: 202 } };
  assert.doesNotThrow(() => conferirAmostras([ok('PREPARAR'), { ...ok('TROCAR'), health: false }, trocado]));
  assert.doesNotThrow(() => conferirAmostras([ok('PREPARAR'), ok('PREPARAR')], true));
  assert.throws(() => conferirAmostras([{ ...ok('PREPARAR'), pidsConsumidores: {} }], true), /PIDs iniciais/);
});
void test('H2 extrai os PIDs atuais do log do supervisor, inclusive UTF8 BOM do PS5.1', () => {
  const texto = '\uFEFF2026-10-14 12:00:00  emails iniciado (PID 101).\r\n2026-10-14 12:00:00  relatorios iniciado (PID 102).\r\n2026-10-14 12:01:00  emails iniciado (PID 201).\r\n';
  assert.deepEqual(pidsConsumidores(texto), { emails: 201, relatorios: 102 });
  assert.deepEqual(pidsConsumidores('sem partida'), { emails: null, relatorios: null });
});
void test('H2 detecta dados perdidos e migracoes ausentes, permitindo coluna nova', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE tickets(id TEXT PRIMARY KEY, scope TEXT, nova TEXT); INSERT INTO tickets VALUES('h2','preservar',NULL); CREATE TABLE schema_migrations(version INTEGER); INSERT INTO schema_migrations VALUES(1)");
    const antes = { tickets: { colunas: ['id', 'scope'], linhas: [{ id: 'h2', scope: 'preservar' }] } };
    assert.doesNotThrow(() => conferirBanco(db, antes, [1]));
    assert.throws(() => conferirBanco(db, antes, [1, 2]), /Migracao 2 nao aplicada/);
    db.exec("UPDATE tickets SET scope='perdido'");
    assert.throws(() => conferirBanco(db, antes, [1]), /Dados alterados/);
  } finally { db.close(); }
});
void test('H2 deriva as migracoes do codigo de destino incluindo indices', () => {
  const raiz = path.resolve(import.meta.dirname, '../..');
  const versoes = versoesEsperadas(raiz);
  assert.ok(versoes.includes(1) && versoes.includes(7));
  assert.deepEqual(versoes, [...new Set(versoes)].sort((a, b) => a - b));
});

void test('H2 semeia dados ficticios usando o schema real da aplicacao', () => {
  const fonte = fs.readFileSync(path.resolve(import.meta.dirname, '../lib/database.ts'), 'utf8');
  const db = new DatabaseSync(':memory:');
  try {
    for (const nome of ['users', 'suppliers', 'agreements', 'tickets', 'ticket_events']) {
      const sql = [...fonte.matchAll(/`(CREATE TABLE IF NOT EXISTS [^`]+)`/g)].map(m => m[1]).find(sql => sql.startsWith(`CREATE TABLE IF NOT EXISTS ${nome} (`));
      assert.ok(sql, `Schema real ausente: ${nome}`);
      db.exec(sql);
    }
    db.exec("INSERT INTO users(id,name,email,password_salt,password_hash,role,created_at) VALUES('admin','Pessoa Ficticia','admin@example.com','salt','hash','admin','2026-01-01')");
    semearBanco(db);
    assert.equal(db.prepare('SELECT email FROM users').get().email, 'admin@h2.test');
    assert.equal(db.prepare('SELECT legal_name FROM suppliers').get().legal_name, 'Fornecedor ficticio H2');
    assert.equal(db.prepare('SELECT scope FROM tickets').get().scope, 'Dado a preservar');
  } finally { db.close(); }
});

void test('reversao permite apenas defaults acrescentados depois da troca; artefatos e valores anteriores sao imutaveis', async () => {
  const { conferirManifestoReversao } = await import('../../scripts/ci/atualizacao-real.mjs');
  const { createHash } = await import('node:crypto');
  const nome=path.normalize('privado/comum/operacao.env'), antigo='MODO_ENSAIO=1\n', novo=antigo+'# reparo\nNOVA=padrao\n';
  const hash=s=>createHash('sha256').update(s).digest('hex');
  const antes={artefato:'original',[nome]:hash(antigo)},atual={artefato:'original',[nome]:hash(novo)};
  const conferir=(texto,artefato='original')=>conferirManifestoReversao(antes,{...atual,artefato,[nome]:hash(texto)},{[nome]:antigo},{[nome]:texto},{[nome]:'MODO_ENSAIO=0\nNOVA=padrao\n'});
  assert.doesNotThrow(()=>conferir(novo));
  assert.throws(()=>conferir('MODO_ENSAIO=0\nNOVA=padrao\n'),/Configuracao existente alterada/);
  assert.throws(()=>conferir(antigo+'NOVA=inesperado\n'),/defaults aprovados/);
  assert.throws(()=>conferir(novo+'INTRUSA=1\n'),/defaults aprovados/);
  assert.throws(()=>conferir(novo,'alterado'),/Artefatos alterados/);
  assert.notDeepEqual(atual,antes);
});

void test('H2 repete apenas locks transitorios do log e informa esgotamento', async t => {
  for (const code of ['EBUSY', 'EPERM', 'EACCES']) {
    let chamadas = 0;
    const leitura = t.mock.method(fs.promises, 'readFile', async () => {
      if (++chamadas < 3) throw Object.assign(new Error('lock ficticio'), { code });
      return '] PREPARAR: inicio.';
    });
    try {
      assert.equal(await lerLogFases('log-ficticio'), '] PREPARAR: inicio.');
      assert.equal(chamadas, 3);
    } finally { leitura.mock.restore(); }
  }
  for (const [code, tentativas] of [['EBUSY', 10], ['ENOENT', 1]]) {
    const causa = Object.assign(new Error('falha ficticia'), { code });
    const leitura = t.mock.method(fs.promises, 'readFile', async () => { throw causa; });
    try {
      await assert.rejects(lerLogFases('log-ficticio'), e => {
        assert.match(e.message, new RegExp(`log-ficticio apos ${tentativas} tentativa`));
        assert.equal(e.cause, causa);
        return true;
      });
      assert.equal(leitura.mock.callCount(), tentativas);
    } finally { leitura.mock.restore(); }
  }
});

void test('H2 reprova amostras cuja fase ficou desconhecida por falha de leitura do log', () => {
  const positivo = [ok('PREPARAR'), { ...ok('TROCAR'), health: false }, ok('CONCLUIR')];
  for (const [amostras, negativo] of [[positivo, false], [[ok('PREPARAR'), ok('PREPARAR')], true]]) {
    for (let i = 0; i < amostras.length; i++) {
      const incompletas = amostras.map((a, j) => i === j ? { ...a, erroLogFases: 'EACCES ficticio' } : a);
      assert.throws(() => conferirAmostras(incompletas, negativo), /Fase da atualizacao desconhecida: EACCES ficticio/);
    }
  }
});
