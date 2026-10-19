import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { criarTemporarioTeste } from './apoio/ambiente.mjs';
import { ferramenta7z, senhaFicticia, bancoFicticio } from './apoio/backup.mjs';
import { destinoBanco } from '../scripts/banco-local.mjs';
import { reservarPortaLoopback } from '../scripts/porta-teste.mjs';
import { montarPacote, compactarPacote, comBackupDaRede, extrairPacote, validarPacote } from '../scripts/backup-pacote.mjs';
import { replicarNaRede } from '../scripts/backup.mjs';
import { restaurarCopia } from '../scripts/restaurar-backup.mjs';
import { executar7z } from '../scripts/backup-7z.mjs';
import { nomeBackup } from '../scripts/retencao-backup.mjs';

void test('7z real: banco WAL consistente, configuracao da semente, rede, senha, restauracao segura e retencao de uma protecao', async t => {
  // O H2 herda ensaio; esta fixture precisa exercitar a publicacao na rede.
  const ensaioAnterior = process.env.MODO_ENSAIO;
  delete process.env.MODO_ENSAIO;
  t.after(() => { if (ensaioAnterior === undefined) delete process.env.MODO_ENSAIO; else process.env.MODO_ENSAIO = ensaioAnterior; });
  const exe = ferramenta7z(t); if (!exe) return;
  const dir = criarTemporarioTeste('sv-backup-e2e-'); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const raiz = path.join(dir, 'privado-ficticio'), banco = destinoBanco('fixture.sqlite', path.join(raiz, 'portal'));
  const db = bancoFicticio(banco); t.after(() => { try { db.close(); } catch {} });
  db.exec('PRAGMA journal_mode=WAL');
  const configPortal = `PORTAL_PORTA=${await reservarPortaLoopback()}\nRELATORIOS_PORTA=${await reservarPortaLoopback()}\n`;
  const arquivos = { 'comum/smtp.env': 'SMTP_USER=ficticio@example.com', 'portal/configuracao/portal.env': configPortal,
    'alertas/config/qlik.env': 'TOKEN=ficticio', 'alertas/parametros/de_para/mapa.txt': 'ficticio',
    'alertas/estado-envios/slot.json': '{"enviado":true}', 'operacao/estado.json': '{"slot":"concluido"}' };
  for (const [nome, conteudo] of Object.entries(arquivos)) { fs.mkdirSync(path.dirname(path.join(raiz, nome)), { recursive: true }); fs.writeFileSync(path.join(raiz, nome), conteudo); }
  for (const nome of ['comum/backup-senha.dpapi', 'portal/logs/segredo.log', 'portal/backups/velho.sqlite', 'operacao/preparos/arvore.txt', 'alertas/config/velho.7z', 'alertas/config/rotina.log', 'alertas/parametros/node_modules/pacote.json']) {
    fs.mkdirSync(path.dirname(path.join(raiz, nome)), { recursive: true }); fs.writeFileSync(path.join(raiz, nome), 'excluir');
  }
  const pasta = path.join(dir, 'conteudo'); montarPacote(pasta, { raiz });
  const meta = validarPacote(pasta);
  assert.deepEqual(Object.keys(meta.arquivos).sort(), ['banco/portal.sqlite', ...Object.keys(arquivos)].sort());
  const arquivo = path.join(dir, nomeBackup()), rede = path.join(dir, 'rede'); fs.mkdirSync(rede);
  compactarPacote(pasta, arquivo, exe, senhaFicticia);
  assert.throws(() => executar7z(exe, 'incorreta', ['t', arquivo]), /7-Zip falhou/);
  await replicarNaRede({ BACKUP_NETWORK_DIR: rede }, { origem: arquivo, executavel: exe, senha: senhaFicticia,
    iniciar: () => fork(new URL('../scripts/backup-rede.mjs', import.meta.url), [], {
      env: { ...process.env, MODO_ENSAIO: '0' }, execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    }),
  });
  const opcoes = { config: { BACKUP_NETWORK_DIR: rede }, executavel: exe, senha: senhaFicticia };
  db.exec("UPDATE users SET name='Depois'"); db.close();
  fs.writeFileSync(path.join(raiz, 'comum/smtp.env'), 'atual');
  const restaurar = configuracao => comBackupDaRede(undefined, (p, m) => restaurarCopia(path.join(p, 'banco/portal.sqlite'), { raiz, pasta: p, meta: m, configuracao }), opcoes);
  await restaurar(false);
  assert.equal(fs.readFileSync(path.join(raiz, 'comum/smtp.env'), 'utf8'), 'atual');
  const restaurado = new DatabaseSync(banco);
  assert.equal(restaurado.prepare('SELECT name FROM users').get().name, 'Antes');
  assert.equal(restaurado.prepare('SELECT status FROM report_jobs').get().status, 'review'); restaurado.close();
  fs.writeFileSync(path.join(raiz, 'alertas/parametros/de_para/sobra.txt'), 'posterior');
  await restaurar(true);
  assert.equal(fs.existsSync(path.join(raiz, 'alertas/parametros/de_para/sobra.txt')), false);
  assert.equal(fs.readFileSync(path.join(raiz, 'comum/smtp.env'), 'utf8'), arquivos['comum/smtp.env']);
  assert.equal(fs.readdirSync(path.join(raiz, 'portal/backups')).filter(n => n.startsWith('pre-restauracao-')).length, 1);
  const renomear = fs.renameSync;
  const falha = t.mock.method(fs, 'renameSync', (origem, destino) => {
    if (destino === banco) throw new Error('falha ficticia na troca');
    return renomear(origem, destino);
  });
  fs.writeFileSync(path.join(raiz, 'comum/smtp.env'), 'preservar na falha');
  await assert.rejects(restaurar(true), /banco anterior preservado/);
  falha.mock.restore();
  assert.equal(fs.readFileSync(path.join(raiz, 'comum/smtp.env'), 'utf8'), 'preservar na falha');
  const invalido = path.join(dir, 'invalido.sqlite'); fs.writeFileSync(invalido, 'corrompido');
  await assert.rejects(restaurarCopia(invalido, { raiz }));
  const preservado = new DatabaseSync(banco);
  assert.equal(preservado.prepare('SELECT name FROM users').get().name, 'Antes'); preservado.close();
  assert.equal(fs.readdirSync(path.join(raiz, 'portal/backups')).filter(n => n.startsWith('pre-restauracao-')).length, 1);
  const extracao = path.join(dir, 'extracao'); fs.mkdirSync(extracao);
  assert.throws(() => extrairPacote(arquivo, extracao, exe, 'incorreta'), /7-Zip falhou/);
  assert.deepEqual(fs.readdirSync(extracao), []);
  await assert.rejects(comBackupDaRede('2026-01-01_0000', () => assert.fail(), opcoes), /nao encontrado/);
});
