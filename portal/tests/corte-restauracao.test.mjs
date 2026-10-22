import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { criarTemporarioTeste } from './apoio/ambiente.mjs';
import { bancoFicticio } from './apoio/backup.mjs';
import { DatabaseSync } from 'node:sqlite';
import { criarSnapshot } from '../scripts/snapshot-banco.mjs';
import { destinoBanco } from '../scripts/banco-local.mjs';
import { portaSemServico } from '../scripts/porta-teste.mjs';
import { restaurarCopia } from '../scripts/restaurar-backup.mjs';
import { arquivoCorteRestauracao, lerCorteRestauracao } from '../scripts/corte-restauracao.mjs';
import { prepararRelatoriosDiarios, reservarRelatoriosDiarios, MENSAGEM_RESTAURACAO } from '../scripts/processar-emails.mjs';

for (const conteudo of ['{quebrado', '{}', '{"corte":"invalida"}', '{"corte":null}']) {
  void test(`corte invalido usa modificacao, avisa e expira: ${conteudo}`, t => {
    const raiz = criarTemporarioTeste('sv-corte-invalido-');
    t.after(() => fs.rmSync(raiz, { recursive: true, force: true }));
    const arquivo = arquivoCorteRestauracao(raiz);
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    fs.writeFileSync(arquivo, conteudo);
    const modificacao = new Date('2026-10-05T18:00:00Z');
    fs.utimesSync(arquivo, modificacao, modificacao);
    const avisos = [];
    const registrar = mensagem => avisos.push(mensagem);
    assert.equal(lerCorteRestauracao(new Date('2026-10-05T19:00:00Z'), raiz, registrar).toISOString(), modificacao.toISOString());
    assert.match(avisos[0], /AVISO:.*data de modificacao como corte/);
    assert.equal(lerCorteRestauracao(new Date('2026-10-06T03:00:00Z'), raiz, registrar), null);
    assert.doesNotThrow(() => lerCorteRestauracao(new Date('2026-10-05T19:00:00Z'), raiz, () => { throw new Error('log indisponivel'); }));
  });
}

void test('leitura negada usa modificacao; sem metadados segue sem corte e com aviso', t => {
  const raiz = criarTemporarioTeste('sv-corte-ilegivel-');
  t.after(() => fs.rmSync(raiz, { recursive: true, force: true }));
  const arquivo = arquivoCorteRestauracao(raiz);
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, '{}');
  const modificacao = new Date('2026-10-05T18:00:00Z');
  fs.utimesSync(arquivo, modificacao, modificacao);
  const ler = fs.readFileSync, stat = fs.statSync;
  t.mock.method(fs, 'readFileSync', (alvo, ...args) => {
    if (alvo === arquivo) throw Object.assign(new Error('fixture ilegivel'), { code: 'EACCES' });
    return ler(alvo, ...args);
  });
  const avisos = [], registrar = mensagem => avisos.push(mensagem);
  const agora = new Date('2026-10-05T19:00:00Z');
  assert.equal(lerCorteRestauracao(agora, raiz, registrar).toISOString(), modificacao.toISOString());
  assert.match(avisos[0], /data de modificacao como corte/);
  t.mock.method(fs, 'statSync', (alvo, ...args) => {
    if (alvo === arquivo) throw Object.assign(new Error('fixture sem metadados'), { code: 'EACCES' });
    return stat(alvo, ...args);
  });
  assert.equal(lerCorteRestauracao(agora, raiz, registrar), null);
  assert.match(avisos.at(-1), /modificacao indisponivel, seguindo sem corte/);
});

void test('entrega enviada 17:45 depois do backup 13:30 nao volta a pending ao restaurar 18:00', async t => {
  const raiz = criarTemporarioTeste('sv-restauracao-diario-');
  t.after(() => fs.rmSync(raiz, { recursive: true, force: true }));
  const banco = destinoBanco('portal.sqlite', path.join(raiz, 'portal'));
  const backup = path.join(raiz, 'backup-1330.sqlite');
  let db = bancoFicticio(banco);
  try {
    db.exec("ALTER TABLE users ADD COLUMN daily_report_enabled INTEGER DEFAULT 1; ALTER TABLE users ADD COLUMN daily_report_time TEXT DEFAULT '17:45'");
    criarSnapshot(banco, backup);
    prepararRelatoriosDiarios(db, new Date('2026-10-05T20:45:00Z'), raiz);
    db.exec("UPDATE daily_report_deliveries SET status='sent',sent_at='2026-10-05T20:45:00Z'");
  } finally { db.close(); }
  const config = path.join(raiz, 'portal/configuracao/portal.env');
  fs.mkdirSync(path.dirname(config), { recursive: true });
  fs.writeFileSync(config, `PORTAL_PORTA=${await portaSemServico()}\nRELATORIOS_PORTA=${await portaSemServico()}\n`);
  const DataReal = Date;
  const relogio = t.mock.method(globalThis, 'Date', class extends DataReal {
    constructor(...args) { super(...(args.length ? args : ['2026-10-05T21:00:00Z'])); }
    static now() { return DataReal.parse('2026-10-05T21:00:00Z'); }
  });
  try { await restaurarCopia(backup, { raiz }); } finally { relogio.mock.restore(); }
  db = new DatabaseSync(banco);
  try {
    assert.equal(db.prepare('SELECT COUNT(*) n FROM daily_report_deliveries').get().n, 0);
    const agora = new Date('2026-10-05T21:01:00Z');
    prepararRelatoriosDiarios(db, agora, raiz);
    assert.equal(db.prepare('SELECT status,last_error FROM daily_report_deliveries').get().status, 'failed');
    assert.equal(db.prepare('SELECT last_error FROM daily_report_deliveries').get().last_error, MENSAGEM_RESTAURACAO);
    assert.deepEqual(reservarRelatoriosDiarios(db, agora), []);
    prepararRelatoriosDiarios(db, new Date('2026-10-06T20:45:00Z'), raiz);
    assert.equal(db.prepare("SELECT status FROM daily_report_deliveries WHERE report_date='2026-10-06'").get().status, 'pending');
  } finally { db.close(); }
});

void test('troca publica o corte antes do banco, inclusive com configuracao; falhas preservam o corte anterior', async t => {
  const raiz = criarTemporarioTeste('sv-corte-');
  t.after(() => fs.rmSync(raiz, { recursive: true, force: true }));
  const origem = path.join(raiz, 'backup-1330.sqlite');
  bancoFicticio(origem).close();
  const banco = destinoBanco('portal.sqlite', path.join(raiz, 'portal'));
  bancoFicticio(banco).close();
  const config = path.join(raiz, 'portal/configuracao/portal.env');
  fs.mkdirSync(path.dirname(config), { recursive: true });
  fs.writeFileSync(config, `PORTAL_PORTA=${await portaSemServico()}\nRELATORIOS_PORTA=${await portaSemServico()}\n`);
  const pasta = path.join(raiz, 'pacote');
  fs.mkdirSync(path.join(pasta, 'operacao'), { recursive: true });
  fs.writeFileSync(path.join(pasta, 'operacao/estado.json'), '{}');
  const corte = arquivoCorteRestauracao(raiz), renomear = fs.renameSync;
  let trocas = 0, recusar = false, recusarCorte = false;
  t.mock.method(fs, 'renameSync', (de, para) => {
    if (para === corte && recusarCorte) throw new Error('falha ficticia no corte');
    if (para === banco) {
      assert.ok(lerCorteRestauracao(new Date(), raiz), 'nao pode trocar banco sem corte');
      trocas++;
      if (recusar) throw new Error('falha ficticia na troca');
    }
    return renomear(de, para);
  });
  await restaurarCopia(origem, { raiz });
  await restaurarCopia(origem, { raiz, configuracao: true, pasta, meta: { arquivos: { 'operacao/estado.json': {} } } });
  assert.equal(trocas, 2);
  assert.equal(fs.readFileSync(path.join(raiz, 'operacao/estado.json'), 'utf8'), '{}');
  const anterior = fs.readFileSync(corte, 'utf8');
  recusar = true;
  await assert.rejects(restaurarCopia(origem, { raiz }), /copia pre-restauracao preservada/);
  assert.equal(fs.readFileSync(corte, 'utf8'), anterior);
  recusarCorte = true;
  await assert.rejects(restaurarCopia(origem, { raiz }), /copia pre-restauracao preservada/);
  assert.equal(trocas, 3, 'falha em publicar corte deve impedir troca do banco');
});

for (const caso of ['restauracao-1800', 'corte-igual-1745', 'reinicio-normal', 'corte-dia-anterior', 'horario-depois-corte']) {
  void test(`backup 13:30, entrega 17:45 ausente: ${caso}`, t => {
    const raiz = criarTemporarioTeste('sv-diario-corte-');
    const arquivo = path.join(raiz, 'backup-1330.sqlite');
    const db = bancoFicticio(arquivo);
    t.after(() => { db.close(); fs.rmSync(raiz, { recursive: true, force: true }); });
    // Colunas adicionadas pelo Portal ao iniciar uma base antiga.
    db.exec("ALTER TABLE users ADD COLUMN daily_report_enabled INTEGER DEFAULT 1; ALTER TABLE users ADD COLUMN daily_report_time TEXT DEFAULT '17:45'");
    if (caso === 'horario-depois-corte') db.exec("UPDATE users SET daily_report_time='19:00'");
    if (caso !== 'reinicio-normal') {
      fs.mkdirSync(path.dirname(arquivoCorteRestauracao(raiz)), { recursive: true });
      const instante = caso === 'corte-dia-anterior' ? '2026-10-04T21:00:00Z' : caso === 'corte-igual-1745' ? '2026-10-05T20:45:00Z' : '2026-10-05T21:00:00Z';
      fs.writeFileSync(arquivoCorteRestauracao(raiz), JSON.stringify({ corte: instante }));
    }
    const agora = new Date('2026-10-05T22:30:00Z');
    prepararRelatoriosDiarios(db, agora, raiz);
    prepararRelatoriosDiarios(db, agora, raiz);
    const linhas = db.prepare('SELECT status,last_error FROM daily_report_deliveries').all();
    assert.equal(linhas.length, 1, 'reinicio nao duplica entrega');
    const bloqueado = ['restauracao-1800', 'corte-igual-1745'].includes(caso);
    assert.equal(linhas[0].status, bloqueado ? 'failed' : 'pending');
    assert.equal(linhas[0].last_error, bloqueado ? MENSAGEM_RESTAURACAO : null);
    assert.equal(reservarRelatoriosDiarios(db, agora).length, bloqueado ? 0 : 1);
    assert.equal(lerCorteRestauracao(new Date('2026-10-06T03:00:00Z'), raiz), null, 'corte expira a meia-noite SP');
  });
}
