import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import test from 'node:test';
import { criarTemporarioTeste } from './apoio/ambiente.mjs';
import { executarBackup, tentarRede, replicarNaRede, prazoRedeMs } from '../scripts/backup.mjs';
import { replicarCopiaNaRede } from '../scripts/backup-rede.mjs';

void test('retenta a cada 10 min por 1 hora, recuperacao encerra tentativas', async () => {
  let tempo = 0; const instantes = [];
  const opcoes = { agora: () => tempo, aguardar: async ms => { tempo += ms; }, registrar() {} };
  assert.equal(await tentarRede(async () => { instantes.push(tempo); throw new Error(); }, opcoes), null);
  assert.equal(tempo, 3600000); assert.deepEqual(instantes, [0, 600000, 1200000, 1800000, 2400000, 3000000]);
  tempo = 0; let tentativas = 0;
  assert.equal(await tentarRede(async () => { if (++tentativas < 3) throw new Error(); return 'ok'; }, opcoes), 'ok');
  assert.equal(tempo, 1200000);
});
void test('falha persistente envia o MESMO 7z e avisa administrador mesmo se SMTP falhar; temporarios removidos', async () => {
  let arquivo, pasta, tempo = 0, alertas = 0, tentativas = 0;
  assert.equal(await executarBackup({ ensaio: false, config: { BACKUP_NETWORK_DIR: 'ficticio' },
    senha: () => 'ficticia', zip: () => 'ficticio', preparar(p) { pasta = path.dirname(p); },
    compactar(p, a) { arquivo = a; fs.writeFileSync(a, 'mesmo pacote'); },
    retentar: rede => tentarRede(rede, { agora: () => tempo, aguardar: async ms => { tempo += ms; }, registrar() {} }),
    rede: async (config, op) => { assert.equal(op.origem, arquivo); tentativas++; throw new Error(); },
    email: async (config, a) => { assert.equal(a, arquivo); assert.equal(fs.readFileSync(a, 'utf8'), 'mesmo pacote'); throw new Error('segredo'); },
    avisar: async () => alertas++, registrar: m => assert.doesNotMatch(m, /segredo/),
  }), 1);
  assert.equal(tentativas, 6); assert.equal(alertas, 1); assert.equal(fs.existsSync(pasta), false);
});
void test('rede testa antes de publicar; hash divergente e nome existente preservam copia anterior', t => {
  // O H2 herda ensaio; esta fixture precisa exercitar a publicacao na rede.
  const ensaioAnterior = process.env.MODO_ENSAIO;
  delete process.env.MODO_ENSAIO;
  t.after(() => { if (ensaioAnterior === undefined) delete process.env.MODO_ENSAIO; else process.env.MODO_ENSAIO = ensaioAnterior; });
  const dir = criarTemporarioTeste('sv-rede-segura-'); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const rede = path.join(dir, 'rede'); fs.mkdirSync(rede);
  const origem = path.join(dir, 'supply-vision-2026-10-16_2059.7z'); fs.writeFileSync(origem, 'novo');
  const anterior = path.join(rede, 'supply-vision-2026-10-16_1330.7z'); fs.writeFileSync(anterior, 'anterior');
  assert.throws(() => replicarCopiaNaRede(origem, rede, { testar(exe, senha, args) { fs.writeFileSync(args[1], 'corrompido'); } }), /Hash/);
  assert.deepEqual(fs.readdirSync(rede), [path.basename(anterior)]);
  assert.equal(fs.readFileSync(anterior, 'utf8'), 'anterior');
  const resultado = replicarCopiaNaRede(origem, rede, { testar(exe, senha, args) { assert.ok(args[1].endsWith('.tmp')); } });
  assert.equal(fs.readFileSync(resultado.arquivo, 'utf8'), 'novo');
  assert.throws(() => replicarCopiaNaRede(origem, rede, { testar() { assert.fail(); } }), /ja existe/);
  assert.equal(fs.readFileSync(resultado.arquivo, 'utf8'), 'novo');
});
void test('prazo mata worker de SMB e so entao devolve falha; nao publica arquivo', async t => {
  const dir = criarTemporarioTeste('sv-rede-prazo-'); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const script = path.join(dir, 'worker.mjs'); fs.writeFileSync(script, 'process.on("message",()=>{setInterval(()=>{},1000)});');
  let filho;
  await assert.rejects(replicarNaRede({ BACKUP_NETWORK_DIR: dir }, { prazoMs: 100,
    iniciar: () => { filho = fork(script, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }); return filho; },
  }), /Prazo/);
  assert.throws(() => process.kill(filho.pid, 0));
  assert.equal(prazoRedeMs({}), 60000);
  for (const valor of ['0', '-1', '1.5', '601']) assert.throws(() => prazoRedeMs({ BACKUP_NETWORK_TIMEOUT_SECONDS: valor }), /BACKUP_NETWORK_TIMEOUT/);
});
