import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { EVENTOS_ADMIN, destinatariosAdmin, enviarAvisoAdmin, montarAviso, reservarAviso } from '../scripts/aviso-admin.mjs';

function fixture(t) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-aviso-admin-'));
  t.after(() => fs.rmSync(pasta, { recursive: true, force: true }));
  return { pasta, arquivo: path.join(pasta, 'operacao', 'avisos-admin.sqlite') };
}
const config = { SMTP_USER: 'remetente@example.com', EMAIL_FROM_NAME: 'Supply Vision', SMTP_PASSWORD: 'SENHA-NAO-PUBLICAR' };
const instante = new Date('2026-10-08T14:00:00.000Z');

void test('enderecos separados por virgula; vazio ou ausente desliga sem SMTP nem arquivos', async t => {
  assert.deepEqual(destinatariosAdmin(' um@example.com, dois@example.com, , um@example.com '), ['um@example.com', 'dois@example.com']);
  const { arquivo, pasta } = fixture(t);
  const proibido = () => assert.fail('Nao pode ler SMTP nem criar transporte');
  for (const destinatarios of ['', '  ', ', ,']) {
    assert.equal(await enviarAvisoAdmin('supervisor-iniciado', { destinatarios, arquivo, lerSmtp: proibido, criarTransporte: proibido }), 'desligado');
  }
  assert.deepEqual(fs.readdirSync(pasta), []);
});

for (const evento of Object.keys(EVENTOS_ADMIN)) void test(`${evento}: envia uma vez e limita por tipo ate 60 minutos`, async t => {
  const { arquivo } = fixture(t);
  const mensagens = []; let fechados = 0;
  const opcoes = { destinatarios: 'um@example.com,dois@example.com', ensaio: false, arquivo, agora: instante, lerSmtp: () => config,
    criarTransporte: () => ({ async sendMail(msg) { mensagens.push(msg); }, close() { fechados++; } }),
  };
  assert.equal(await enviarAvisoAdmin(evento, opcoes), 'enviado');
  assert.equal(await enviarAvisoAdmin(evento, { ...opcoes, agora: new Date(instante.getTime() + 59 * 60_000) }), 'limitado');
  assert.equal(mensagens.length, 1); assert.equal(fechados, 1);
  const mensagem = mensagens[0];
  assert.deepEqual(mensagem.to, ['um@example.com', 'dois@example.com']);
  assert.deepEqual(mensagem.from, { name: config.EMAIL_FROM_NAME, address: config.SMTP_USER });
  assert.match(mensagem.subject, /^\[Supply Vision\] .+ — .+/);
  assert.match(mensagem.text, /Data\/hora:/); assert.match(mensagem.text, /O que fazer:/); assert.match(mensagem.text, /docs\/SOCORRO\.md/);
  assert.ok(mensagem.text.includes(EVENTOS_ADMIN[evento].secao));
  assert.ok(!JSON.stringify(mensagem).includes(config.SMTP_PASSWORD));
  assert.equal(await enviarAvisoAdmin(evento, { ...opcoes, agora: new Date(instante.getTime() + 60 * 60_000) }), 'enviado');
  assert.equal(mensagens.length, 2);
});

void test('tipos independentes; supressao no ensaio nao consulta SMTP nem consome janela', async t => {
  const { arquivo, pasta } = fixture(t); const logs = [];
  const proibido = () => assert.fail('Ensaio nao pode ler SMTP nem criar transporte');
  for (const evento of Object.keys(EVENTOS_ADMIN)) {
    assert.equal(await enviarAvisoAdmin(evento, { destinatarios: 'admin@example.com', ensaio: true, arquivo, lerSmtp: proibido, criarTransporte: proibido, registrar: msg => logs.push(msg) }), 'ensaio');
    assert.ok(logs.at(-1).includes(`ensaio: aviso ao administrador suprimido — ${EVENTOS_ADMIN[evento].nome}`));
  }
  assert.deepEqual(fs.readdirSync(pasta), []);
  for (const evento of Object.keys(EVENTOS_ADMIN)) assert.equal(reservarAviso(arquivo, evento, instante.getTime()), true);
});

void test('frequencia sobrevive a novos processos e ao relogio que voltou', t => {
  const { arquivo, pasta } = fixture(t);
  const modulo = new URL('../scripts/aviso-admin.mjs', import.meta.url).href;
  const codigo = `import {enviarAvisoAdmin} from ${JSON.stringify(modulo)};
    console.log(await enviarAvisoAdmin('supervisor-iniciado',{destinatarios:'admin@example.com',ensaio:false,arquivo:process.argv[1],agora:new Date('2026-10-08T14:00:00Z'),lerSmtp:()=>({}),criarTransporte:()=>({async sendMail(){},close(){}})}));`;
  const executar = () => spawnSync(process.execPath, ['--input-type=module', '-e', codigo, arquivo], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', SUPPLY_VISION_PRIVADO: pasta }, timeout: 10_000 });
  const primeira = executar(), segunda = executar();
  assert.ifError(primeira.error); assert.ifError(segunda.error);
  assert.equal(primeira.status, 0, primeira.stderr); assert.equal(segunda.status, 0, segunda.stderr);
  assert.equal(primeira.stdout.trim(), 'enviado'); assert.equal(segunda.stdout.trim(), 'limitado');
  assert.equal(reservarAviso(arquivo, 'supervisor-iniciado', instante.getTime() - 1000), false, 'relogio que voltou nao libera outro envio');
});

void test('falha SMTP fecha transporte, consome janela e permite outros eventos', async t => {
  const { arquivo } = fixture(t); let fechou = false;
  const opcoes = { destinatarios: 'admin@example.com', ensaio: false, arquivo, agora: instante, lerSmtp: () => config,
    criarTransporte: () => ({ async sendMail() { throw new Error('falha simulada'); }, close() { fechou = true; } }),
  };
  await assert.rejects(enviarAvisoAdmin('backup-falhou', opcoes), /falha simulada/);
  assert.equal(fechou, true);
  assert.equal(await enviarAvisoAdmin('backup-falhou', opcoes), 'limitado');
  assert.equal(reservarAviso(arquivo, 'disco-baixo', instante.getTime()), true);
});

void test('transporte que demora alem do limite nao bloqueia outras tarefas e e fechado', async t => {
  const { arquivo } = fixture(t); let fechou = false, voltas = 0;
  const heartbeat = setInterval(() => { voltas++; }, 5);
  t.after(() => clearInterval(heartbeat));
  await assert.rejects(enviarAvisoAdmin('portal-parou', {
    destinatarios: 'admin@example.com', ensaio: false, arquivo, limiteMs: 35,
    lerSmtp: () => config, criarTransporte: () => ({ sendMail() { return new Promise(() => {}); }, close() { fechou = true; } }),
  }), /Tempo limite/);
  assert.equal(fechou, true); assert.ok(voltas > 0, 'a volta principal continua durante SMTP');
});

void test('controle corrompido impede envio e nao altera outros bancos', async t => {
  const { arquivo } = fixture(t); fs.mkdirSync(path.dirname(arquivo)); fs.writeFileSync(arquivo, 'invalido');
  await assert.rejects(enviarAvisoAdmin('backup-falhou', { destinatarios: 'admin@example.com', ensaio: false, arquivo, criarTransporte: () => assert.fail('sem controle nao pode enviar') }));
  assert.equal(fs.readFileSync(arquivo, 'utf8'), 'invalido');
});

void test('mensagens usam somente conteudo fixo, maquina e horario e apontam secoes existentes', () => {
  const manual = fs.readFileSync(new URL('../../docs/SOCORRO.md', import.meta.url), 'utf8');
  for (const [evento, dados] of Object.entries(EVENTOS_ADMIN)) {
    assert.ok(manual.includes(`## ${dados.secao}`));
    const mensagem = montarAviso(evento, instante, 'SERVIDOR-TESTE');
    assert.equal(mensagem.subject, `[Supply Vision] ${dados.nome} — SERVIDOR-TESTE`);
    assert.match(mensagem.text, /08\/10\/2026/); assert.match(mensagem.text, /11:00:00/);
  }
});

void test('CLI desliga sem configurar SMTP e falha sem publicar segredo', t => {
  const { pasta } = fixture(t);
  const executar = (destinatarios, evento, modo = '0') => spawnSync(process.execPath, ['scripts/aviso-admin.mjs', evento], {
    cwd: path.resolve(import.meta.dirname, '..'), env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', SUPPLY_VISION_PRIVADO: pasta, ADMIN_ALERTA_EMAIL: destinatarios, MODO_ENSAIO: modo }, encoding: 'utf8', timeout: 10_000,
  });
  let resultado = executar('', 'supervisor-iniciado');
  assert.ifError(resultado.error); assert.equal(resultado.status, 0); assert.deepEqual(fs.readdirSync(pasta), []);
  resultado = executar('admin@example.com', 'supervisor-iniciado', '1');
  assert.equal(resultado.status, 0); assert.match(resultado.stdout, /ensaio: aviso ao administrador suprimido — Supervisor iniciado/); assert.deepEqual(fs.readdirSync(pasta), []);
  resultado = executar('admin@example.com', 'backup-falhou');
  assert.equal(resultado.status, 1); assert.equal(resultado.stdout, ''); assert.ok(!resultado.stderr.includes('SMTP_PASSWORD'));
});

void test('SMTP comum e suficiente e configuracao do Portal nao e lida', t => {
  const { pasta } = fixture(t);
  fs.mkdirSync(path.join(pasta, 'comum')); fs.writeFileSync(path.join(pasta, 'comum', 'smtp.env'), 'SMTP_HOST=smtp.example.com\nSMTP_PORT=587\nSMTP_USER=remetente@example.com\nSMTP_PASSWORD=SEGREDO\nEMAIL_FROM_NAME=Supply Vision\n');
  const modulo = new URL('../scripts/configuracao.mjs', import.meta.url).href;
  const resultado = spawnSync(process.execPath, ['--input-type=module', '-e', `import {lerConfigSmtp} from ${JSON.stringify(modulo)}; const c=lerConfigSmtp(); console.log(c.SMTP_HOST); console.log(c.PORTAL_URL===undefined);`], { env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', SUPPLY_VISION_PRIVADO: pasta }, encoding: 'utf8', timeout: 10_000 });
  assert.ifError(resultado.error); assert.equal(resultado.status, 0, resultado.stderr); assert.equal(resultado.stdout.trim(), 'smtp.example.com\ntrue');
});

void test('processos concorrentes enviam todos os tipos mas reservam cada tipo uma unica vez', async t => {
  const { arquivo, pasta } = fixture(t);
  // Inicializa o schema sem consumir a janela dos eventos da corrida.
  assert.equal(reservarAviso(arquivo, 'supervisor-iniciado', 0), true);
  const modulo = new URL('../scripts/aviso-admin.mjs', import.meta.url).href;
  const codigo = `import {enviarAvisoAdmin} from ${JSON.stringify(modulo)};
    console.log(await enviarAvisoAdmin(process.argv[2],{destinatarios:'admin@example.com',ensaio:false,arquivo:process.argv[1],agora:new Date('2026-10-08T14:00:00Z'),lerSmtp:()=>({}),criarTransporte:()=>({async sendMail(){},close(){}})}));`;
  const executar = (evento, controle = arquivo) => new Promise((resolve, reject) => {
    const filho = spawn(process.execPath, ['--input-type=module', '-e', codigo, controle, evento], { env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', SUPPLY_VISION_PRIVADO: pasta } });
    let stdout = '', stderr = '';
    filho.stdout.on('data', dados => { stdout += dados; }); filho.stderr.on('data', dados => { stderr += dados; });
    filho.on('error', reject); filho.on('close', status => { if (status) reject(new Error(stderr)); else resolve(stdout.trim()); });
  });
  const tipos = Object.keys(EVENTOS_ADMIN);
  const primeiras = await Promise.all(tipos.map(evento => executar(evento)));
  assert.deepEqual(primeiras, tipos.map(() => 'enviado'));
  const outra = path.join(pasta, 'outra.sqlite');
  reservarAviso(outra, 'supervisor-iniciado', 0);
  const resultados = await Promise.all(Array.from({ length: 4 }, () => executar('backup-falhou', outra)));
  assert.equal(resultados.filter(r => r === 'enviado').length, 1);
  assert.equal(resultados.filter(r => r === 'limitado').length, 3);
});

void test('reserva aguarda lock de escrita acima de um segundo sem perder exclusao', async t => {
  const { arquivo, pasta } = fixture(t);
  reservarAviso(arquivo, 'supervisor-iniciado', 0);
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(arquivo);
  db.exec('BEGIN IMMEDIATE');
  const modulo = new URL('../scripts/aviso-admin.mjs', import.meta.url).href;
  const codigo = `import {reservarAviso} from ${JSON.stringify(modulo)}; console.log('pronto'); process.stdout.write(JSON.stringify(reservarAviso(process.argv[1],'backup-falhou')));`;
  let liberado = false, timer;
  try {
    const saida = await new Promise((resolve, reject) => {
      const filho = spawn(process.execPath, ['--input-type=module', '-e', codigo, arquivo], { env: { ...process.env, SUPPLY_VISION_PRIVADO: pasta, NO_COLOR: '1', FORCE_COLOR: '0' } });
      let stdout = '', stderr = '';
      filho.stdout.on('data', dados => {
        stdout += dados;
        if (!timer && stdout.includes('pronto')) timer = setTimeout(() => { db.exec('COMMIT'); liberado = true; }, 1400);
      });
      filho.stderr.on('data', dados => { stderr += dados; });
      filho.on('error', reject);
      filho.on('close', code => code ? reject(new Error(stderr)) : resolve(stdout));
    });
    assert.equal(saida.trim(), 'pronto\ntrue');
    assert.equal(reservarAviso(arquivo, 'backup-falhou'), false);
  } finally { clearTimeout(timer); if (!liberado) db.exec('ROLLBACK'); db.close(); }
});
