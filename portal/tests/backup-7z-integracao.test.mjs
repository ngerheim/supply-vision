import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { executar7z, exigirNomesCriptografados, FalhaBackup } from '../scripts/backup-7z.mjs';
import { montarPacote, compactarPacote, extrairPacote } from '../scripts/backup-pacote.mjs';
import { destinoBanco } from '../scripts/banco-local.mjs';
import { bancoFicticio, ferramenta7z } from './apoio/backup.mjs';
import { criarTemporarioTeste } from './apoio/ambiente.mjs';

void test('7z real: stdin, integridade, listagem limpa, extracao e recusa de pacotes sem nomes cifrados', t => {
  const exe = ferramenta7z(t); if (!exe) return;
  const dir = criarTemporarioTeste('sv-7z-stdin-real-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const senha = `Ficticia ç !"${randomBytes(18).toString('hex')}`, errada = randomBytes(18).toString('hex');
  const raiz = path.join(dir, 'privado-ficticio'), conteudo = path.join(dir, 'conteudo');
  const banco = destinoBanco('fixture.sqlite', path.join(raiz, 'portal'));
  bancoFicticio(banco).close();
  montarPacote(conteudo, { raiz });
  const arquivo = path.join(dir, 'cifrado.7z');
  const chamadas = [];
  const executar = (executavel, args, opcoes) => {
    assert.ok(args.every(arg => !arg.includes(senha) && !arg.includes(errada)), 'senha em argumentos');
    chamadas.push(args[0]);
    return execFileSync(executavel, args, opcoes);
  };
  compactarPacote(conteudo, arquivo, exe, senha, { executar });
  assert.deepEqual(chamadas, ['a', 'l', 't']);
  assert.equal(executar7z(exe, senha, ['t', arquivo], { executar }), '');
  const lista = executar7z(exe, senha, ['l', '-slt', '-ba', arquivo], { executar });
  assert.match(lista, /^Path = /);
  assert.match(lista, /Encrypted = \+/);
  assert.match(lista, /Method = LZMA2[^\r\n]*7zAES/);
  assert.doesNotMatch(lista, /Enter password|Verify password/);
  exigirNomesCriptografados(exe, arquivo, { executar });
  assert.throws(() => executar(exe, ['l', '-slt', '-ba', arquivo, '-y', '-bd', '-bb0'], {
    input: '', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15000, windowsHide: true,
  }), erro => erro.status !== 0 && !String(erro.stdout).includes('portal.sqlite') && !String(erro.stdout).includes('backup.json'));
  for (const comando of ['t', 'l', 'x']) {
    const args = [comando, ...(comando === 'l' ? ['-slt', '-ba'] : []), arquivo,
      ...(comando === 'x' ? [`-o${path.join(dir, 'errada')}`] : [])];
    assert.throws(() => executar7z(exe, errada, args, { executar }), FalhaBackup);
  }
  const pasta = path.join(dir, 'extraido');
  assert.equal(extrairPacote(arquivo, pasta, exe, senha, { executar }).formato, 1);
  for (const nome of ['backup.json', 'banco/portal.sqlite']) {
    assert.deepEqual(fs.readFileSync(path.join(pasta, nome)), fs.readFileSync(path.join(conteudo, nome)));
  }
  for (const cifrarDados of [false, true]) {
    const semNomesCifrados = path.join(dir, `sem-nomes-cifrados-${cifrarDados}.7z`);
    if (cifrarDados) executar7z(exe, senha, ['a', '-t7z', '-mhe=off', semNomesCifrados, '.'], { cwd: conteudo, executar });
    else executar(exe, ['a', '-t7z', semNomesCifrados, '.', '-y', '-bd', '-bb0', '-bso0'], {
      cwd: conteudo, input: '', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15000, windowsHide: true,
    });
    assert.throws(() => exigirNomesCriptografados(exe, semNomesCifrados, { executar }), /Backup sem criptografia de nomes; recusado\./);
    const destino = path.join(dir, `recusado-${cifrarDados}`);
    const antes = chamadas.length;
    assert.throws(() => extrairPacote(semNomesCifrados, destino, exe, senha, { executar }), /Backup sem criptografia de nomes; recusado\./);
    assert.deepEqual(chamadas.slice(antes), ['l']);
    assert.equal(fs.existsSync(destino), false);
  }
  // Mesmo se o executavel ignorar as opcoes de cifra e retornar sucesso,
  // a verificacao posterior nao pode aprovar a criacao de um backup aberto.
  const aberto = path.join(dir, 'criacao-sem-cifra.7z');
  assert.throws(() => compactarPacote(conteudo, aberto, exe, senha, { executar(executavel, args, opcoes) {
    return executar(executavel, args[0] === 'a' ? args.filter(arg => !['-p', '-mhe=on'].includes(arg)) : args,
      args[0] === 'a' ? { ...opcoes, input: '' } : opcoes);
  } }), /Backup sem criptografia de nomes; recusado\./);
});
