import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { NextRequest } from 'vinext/shims/server';
import { bancoSqliteLocal } from '../lib/sqlite-local.ts';
import { env } from '../scripts/configuracao-servidor.mjs';
import { criarTemporarioTeste } from './apoio/ambiente.mjs';
import { prepararPasta, validarPasta, bancoDemo, marcarBancoNovo, SENTINELA } from '../demonstracao/pasta.mjs';
import { clienteApi, exemplo, semear } from '../demonstracao/semear.mjs';
import { cnpjExemplo } from '../demonstracao/cadastros.mjs';
import { isValidCnpj } from '../lib/domain.ts';
import { contemInfra } from '../../scripts/verificar-infra-publica.mjs';

const hooks = registerHooks({ resolve(s, c, next) {
  if (s === 'next/server') return next('vinext/shims/server', c);
  if (s.startsWith('@/')) return next(new URL(`../${s.slice(2)}.ts`, import.meta.url).href, c);
  if (s === './database') return next(new URL('../lib/database.ts', import.meta.url).href, c);
  return next(s, c);
} });
const banco = await import('../lib/database.ts');
const rota = await import('../app/api/[...path]/route.ts');
hooks.deregister();

function fixture(t, limpar = true) {
  const base = criarTemporarioTeste('sv-demo-teste-');
  // Modela uma raiz de volume ficticia. A inspecao dos ancestrais nunca le
  // instalacoes do host, e permanece inteiramente dentro do PREPARAR.
  const dentroDaFixture = p => p === base || String(p).startsWith(base + path.sep);
  const lstat = fs.lstatSync, existe = fs.existsSync;
  t.mock.method(fs, 'lstatSync', (p, ...args) => dentroDaFixture(p) ? lstat(p, ...args) : undefined);
  t.mock.method(fs, 'existsSync', p => !dentroDaFixture(p) && ['supv.cmd','portal.sqlite','operacao.env'].includes(path.basename(String(p))) ? false : existe(p));
  if (limpar) t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const raiz = path.join(base, 'worktree'); fs.mkdirSync(raiz);
  return { base, raiz, opcoes: { raiz, privadoAmbiente: path.join(base, 'privado-real') }, pasta: path.join(base, 'demo') };
}

void test('travas recusam worktree, privado padrao/ambiente, instalacao e banco alheio sem tocar conteudo', t => {
  const { base, raiz, opcoes, pasta } = fixture(t);
  for (const proibida of [raiz, path.join(raiz, 'sub'), path.join(raiz, 'privado'), opcoes.privadoAmbiente, path.join(opcoes.privadoAmbiente, 'sub'), base]) {
    assert.throws(() => prepararPasta(proibida, opcoes), /recusad/);
  }
  const instalacao = path.join(base, 'instalacao'); fs.mkdirSync(instalacao); fs.writeFileSync(path.join(instalacao, 'supv.cmd'), 'fixture');
  assert.throws(() => prepararPasta(path.join(instalacao, 'demo'), opcoes), /instalacao/);
  fs.mkdirSync(pasta); const alheio = path.join(pasta, 'portal.sqlite'); fs.writeFileSync(alheio, 'preservar');
  assert.throws(() => prepararPasta(pasta, opcoes), /sentinela/);
  assert.throws(() => prepararPasta(path.join(pasta, 'sub'), opcoes), /banco existente/);
  assert.throws(() => prepararPasta(pasta, { ...opcoes, recriar: true }), /sentinela/);
  assert.equal(fs.readFileSync(alheio, 'utf8'), 'preservar');
  assert.throws(() => prepararPasta(path.join(base, 'ausente'), { ...opcoes, recriar: true }), /sentinela/);
  assert.equal(fs.existsSync(path.join(base, 'ausente')), false);
});

void test('sentinela nao autoriza banco estrangeiro; recriar exige identidade e recusa links', t => {
  const { base, pasta, opcoes } = fixture(t);
  prepararPasta(pasta, opcoes);
  fs.mkdirSync(path.dirname(bancoDemo(pasta)), { recursive: true });
  const db = new DatabaseSync(bancoDemo(pasta)); db.exec('CREATE TABLE alheia(id)'); db.close();
  for (const recriar of [false, true]) assert.throws(() => prepararPasta(pasta, { ...opcoes, recriar }), /nao criado/);
  fs.unlinkSync(bancoDemo(pasta));
  const link = path.join(base, 'atalho');
  fs.symlinkSync(pasta, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => prepararPasta(path.join(link, 'sub'), opcoes), /link\/junction/);
  fs.unlinkSync(link);
  fs.writeFileSync(path.join(pasta, 'descartavel.txt'), 'fixture');
  prepararPasta(pasta, { ...opcoes, recriar: true });
  assert.deepEqual(fs.readdirSync(pasta), [SENTINELA]);
});

void test('dados publicos de demonstracao passam no mesmo detector; CNPJs tem DV valido', () => {
  for (const nome of fs.readdirSync(new URL('../demonstracao/', import.meta.url))) {
    assert.equal(contemInfra(fs.readFileSync(new URL(`../demonstracao/${nome}`, import.meta.url), 'utf8'), { arquivo: `portal/demonstracao/${nome}` }), false, nome);
  }
  for (let i = 1; i <= 3; i++) assert.equal(isValidCnpj(cnpjExemplo(i)), true);
  for (const u of [exemplo.inicial, ...exemplo.usuarios]) { assert.match(u.email, /@demo\.invalid$/); assert.ok(!u.email.split('@')[0].includes('.')); }
  assert.throws(() => clienteApi('http://example.invalid'), /loopback/);
});

void test('semeadura usa API real, cria perfis/acordos/chamados/Central e preserva dados ao repetir', async t => {
  const modo = process.env.MODO_ENSAIO; process.env.MODO_ENSAIO = '1';
  t.after(() => { if (modo === undefined) delete process.env.MODO_ENSAIO; else process.env.MODO_ENSAIO = modo; });
  const { base: temporario, pasta, opcoes } = fixture(t, false); prepararPasta(pasta, opcoes);
  const db = bancoSqliteLocal({ pastaPrivada: path.join(pasta, 'portal'), criar: true });
  const chave = Symbol.for('supply-vision:banco'), anterior = globalThis[chave], senha = env.INITIAL_ADMIN_PASSWORD;
  globalThis[chave] = db; env.INITIAL_ADMIN_PASSWORD = exemplo.inicial.password;
  // Recursos sao adquiridos em etapas; o cleanup tambem cobre falha intermediaria.
  const recursos = {};
  t.after(async () => {
    if (recursos.servidor?.listening) await new Promise(resolve => { recursos.servidor.close(resolve); recursos.servidor.closeAllConnections(); });
    recursos.leitura?.close(); db.fechar(); globalThis[chave] = anterior; env.INITIAL_ADMIN_PASSWORD = senha;
    fs.rmSync(temporario, { recursive: true, force: true });
  });
  await banco.ensureDatabase(); marcarBancoNovo(pasta, exemplo.inicial);
  const servidor = recursos.servidor = http.createServer(async (req, res) => {
    try {
      const partes = []; for await (const chunk of req) partes.push(chunk);
      const corpo = Buffer.concat(partes).toString();
      const request = new NextRequest(`http://127.0.0.1${req.url}`, { method: req.method, headers: req.headers, ...(corpo ? { body: corpo } : {}) });
      const resposta = await rota[req.method](request);
      res.writeHead(resposta.status, Object.fromEntries(resposta.headers)); res.end(await resposta.text());
    } catch (erro) { console.error(erro); res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: 'internal_error' })); }
  });
  await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  await semear(base, pasta);
  const leitura = recursos.leitura = new DatabaseSync(bancoDemo(pasta));
  const contar = tabela => leitura.prepare(`SELECT COUNT(*) n FROM ${tabela} ${tabela === 'audit_logs' ? "WHERE action NOT IN ('LOGIN','LOGOUT')" : ''}`).get().n;
  assert.equal(contar('users'), 4); assert.equal(contar('agreements'), 5); assert.equal(contar('agreement_items'), 30);
  assert.equal(contar('suppliers'), 3); assert.equal(contar('locations'), 3); assert.equal(contar('tickets'), 4);
  assert.deepEqual(leitura.prepare('SELECT DISTINCT status FROM tickets ORDER BY status').all().map(r => r.status), ['aberto','aguardando_fornecedor','cancelado','fechado']);
  assert.equal(leitura.prepare('SELECT COUNT(*) n FROM tickets WHERE assigned_to IS NULL').get().n, 0);
  assert.ok(contar('ticket_events') >= 11); assert.ok(contar('audit_logs') > 30);
  assert.equal(contar('solicitacoes'),6);
  assert.deepEqual(leitura.prepare('SELECT DISTINCT status FROM solicitacoes ORDER BY status').all().map(r => r.status),['aberta','cadastrado','devolvida','em_analise','recusado']);
  assert.equal(leitura.prepare("SELECT COUNT(*) n FROM solicitacoes WHERE urgencia='urgente'").get().n,1);
  assert.equal(leitura.prepare('SELECT COUNT(*) n FROM solicitacoes WHERE nao_verificado=1').get().n,1);
  assert.equal(leitura.prepare("SELECT COUNT(*) n FROM solicitacoes s JOIN users u ON u.id=s.solicitante_id WHERE u.email='consulta@demo.invalid'").get().n,6);
  assert.equal(leitura.prepare("SELECT COUNT(*) n FROM solicitacoes s JOIN users u ON u.id=s.atendente_id WHERE u.email='suprimentos@demo.invalid'").get().n,4);
  const api = clienteApi(base); await api('/login', 'POST', exemplo.inicial);
  const acordos = (await api('/bootstrap')).agreements;
  assert.equal(acordos.filter(a => a.effectiveStatus === 'expired').length, 2);
  await api('/logout', 'POST');
  for (const usuario of exemplo.usuarios) {
    const sessao = clienteApi(base); await sessao('/login', 'POST', usuario);
    assert.equal((await sessao('/bootstrap')).user.role, usuario.role);
    assert.ok((await sessao('/central/nao-lidas')).naoLidas > 0);
    await sessao('/logout', 'POST');
  }
  const antes = ['users','agreements','agreement_items','tickets','ticket_events','audit_logs','notificacoes_usuario','solicitacoes','solicitacao_andamentos','consultas_cnpj','email_notifications'].map(tabela => [tabela, contar(tabela)]);
  await semear(base, pasta); assert.deepEqual(antes.map(([tabela]) => [tabela, contar(tabela)]), antes);
  // Retoma sem o marco final: cadastros e acordos tambem sao idempotentes.
  const progresso = path.join(pasta, 'semeadura.json'), estado = JSON.parse(fs.readFileSync(progresso)); delete estado.concluido;
  fs.writeFileSync(progresso, JSON.stringify(estado));
  await semear(base, pasta);
  assert.deepEqual(antes.map(([tabela]) => [tabela,contar(tabela)]),antes);
  // Retoma inclusive uma solicitacao ja concluida sem marco individual.
  const retomada = JSON.parse(fs.readFileSync(progresso)); delete retomada.concluido;
  delete retomada['solicitacao-3']; delete retomada['solicitacao-2'];
  fs.writeFileSync(progresso,JSON.stringify(retomada)); await semear(base,pasta);
  assert.deepEqual(antes.map(([tabela]) => [tabela,contar(tabela)]),antes);
  assert.equal(contar('users'), 4); assert.equal(contar('agreements'), 5); assert.equal(contar('tickets'), 4); assert.equal(contar('agreement_items'), 30);
  assert.equal(validarPasta(pasta, opcoes).criar, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(pasta, 'credenciais.json'))), exemplo);
});
