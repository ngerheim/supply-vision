import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { executar7z, exigirNomesCriptografados, FalhaBackup } from '../scripts/backup-7z.mjs';
import { compactarPacote, extrairPacote } from '../scripts/backup-pacote.mjs';
import { criarTemporarioTeste } from './apoio/ambiente.mjs';

const eol = process.platform === 'win32' ? '\r\n' : '\n';
const prompt = `${eol}Enter password (will not be echoed):${eol}`;
const lista = `Path = banco/portal.sqlite${eol}Encrypted = +${eol}${eol}`;
const senhaTeste = () => `Ficticia ç !"${randomBytes(18).toString('hex')}`;
const eofCriptografado = () => Object.assign(new Error('saida nativa'), { status: 255, stdout: Buffer.from(prompt) });

void test('7z: argumentos e stdin por comando, sem senha na linha de comando', async t => {
  for (const comando of ['a', 't', 'l', 'x']) await t.test(comando, () => {
    const senha = senhaTeste();
    const argumentos = [comando, ...(comando === 'l' ? ['-slt', '-ba'] : []), 'fixture.7z'];
    const originais = [...argumentos];
    let chamadas = 0;
    const saida = executar7z('7z-ficticio', senha, argumentos, { cwd: 'pasta-ficticia', timeout: 4321,
      executar(exe, args, opcoes) {
        chamadas++;
        assert.equal(exe, '7z-ficticio');
        assert.ok(args.every(arg => !arg.includes(senha)), 'senha nunca pode aparecer em nenhum argumento');
        assert.deepEqual(args, [...argumentos, ...(comando === 'a' ? ['-p'] : []), '-y', '-bd', '-bb0', ...(comando === 'l' ? [] : ['-bso0'])]);
        assert.deepEqual(opcoes, { cwd: 'pasta-ficticia', timeout: 4321, input: senha + '\n', encoding: 'utf8', windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 4 * 1024 * 1024 });
        return comando === 'l' ? prompt + lista : '';
      },
    });
    assert.equal(chamadas, 1);
    assert.deepEqual(argumentos, originais);
    assert.equal(saida, comando === 'l' ? lista : '');
  });
});

void test('7z: valida senha e recusa -p fornecido pelo chamador antes de iniciar processo', () => {
  for (const senha of ['', 'a\rb', 'a\nb', 'a\0b', null, 123]) {
    assert.throws(() => executar7z('fixture', senha, ['t', 'fixture.7z'], { executar() { assert.fail(); } }), FalhaBackup);
  }
  const senha = senhaTeste();
  for (const argumento of ['-p', `-p${senha}`, `-P${senha}`]) {
    assert.throws(() => executar7z('fixture', senha, ['t', 'fixture.7z', argumento], { executar() { assert.fail(); } }), FalhaBackup);
  }
});

void test('7z: erro nativo/timeout nunca expõe senha, spawnargs, output ou cause', () => {
  const senha = senhaTeste();
  for (const code of ['ENOENT', 'ETIMEDOUT', 'ENOBUFS']) {
    assert.throws(() => executar7z('fixture', senha, ['t', 'fixture.7z'], {
      executar() { throw Object.assign(new Error(senha), { code, spawnargs: [senha], stdout: senha, stderr: senha }); },
    }), erro => erro instanceof FalhaBackup && erro.message === '7-Zip falhou: confira senha, arquivo e permissoes.'
      && !String(erro.stack).includes(senha) && !erro.cause && !erro.spawnargs && !erro.stdout && !erro.stderr);
  }
});

void test('7z: remove somente o prefixo exato da listagem; formato inesperado falha fechado', () => {
  const senha = senhaTeste();
  const executarLista = saida => executar7z('fixture', senha, ['l', '-slt', '-ba', 'fixture.7z'], { executar: () => saida });
  assert.equal(executarLista(prompt + lista), lista);
  for (const saida of [lista, '', prompt, prompt.trimStart() + lista, `banner${prompt}${lista}`,
    prompt.trimEnd() + lista, prompt.replace('echoed', 'shown') + lista, prompt + eol + lista,
    prompt + lista + prompt, prompt + `Verify password:${eol}` + lista,
    prompt.replaceAll(eol, eol === '\r\n' ? '\n' : '\r\n') + lista]) {
    assert.throws(() => executarLista(saida), FalhaBackup);
  }
  assert.throws(() => executar7z('fixture', senha, ['t', 'fixture.7z'], { executar: () => prompt }), FalhaBackup);
});

void test('7z: prova de nomes cifrados exige EOF no prompt exato, sem enviar senha', () => {
  exigirNomesCriptografados('fixture', 'fixture.7z', { timeout: 3210, executar(exe, args, opcoes) {
    assert.equal(exe, 'fixture');
    assert.deepEqual(args, ['l', '-slt', '-ba', 'fixture.7z', '-y', '-bd', '-bb0']);
    assert.equal(opcoes.input, '');
    assert.deepEqual(opcoes.stdio, ['pipe', 'pipe', 'pipe']);
    assert.equal(opcoes.windowsHide, true);
    assert.equal(opcoes.timeout, 3210);
    assert.equal(opcoes.maxBuffer, 4 * 1024 * 1024);
    throw eofCriptografado();
  } });
  for (const saida of [lista, '']) assert.throws(() => exigirNomesCriptografados('fixture', 'fixture.7z', { executar: () => saida }),
    { name: 'Error', message: 'Backup sem criptografia de nomes; recusado.' });
  for (const erro of [new Error('ausente'), { status: 2, stdout: prompt }, { status: null, code: 'ETIMEDOUT', stdout: prompt },
    { status: 255, stdout: prompt + lista }, { status: 255, stdout: '' }, null]) {
    assert.throws(() => exigirNomesCriptografados('fixture', 'fixture.7z', { executar() { throw erro; } }),
      erroSanitizado => erroSanitizado instanceof FalhaBackup && /7-Zip falhou/.test(erroSanitizado.message));
  }
});

void test('pacote: conferir cifra depois de criar e antes de testar/listar/extrair', t => {
  const dir = criarTemporarioTeste('sv-cifra-unit-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const senha = senhaTeste(), arquivo = path.join(dir, 'fixture.7z'), comandos = [];
  compactarPacote(dir, arquivo, 'fixture', senha, { executar(exe, args, opcoes) {
    assert.ok(args.every(arg => !arg.includes(senha)));
    comandos.push([args[0], opcoes.input === '']);
    if (args[0] === 'l') throw eofCriptografado();
    if (args[0] === 'a') for (const opcao of ['-t7z', '-m0=lzma2', '-mx=9', '-mhe=on']) assert.ok(args.includes(opcao));
    return '';
  } });
  assert.deepEqual(comandos, [['a', false], ['l', true], ['t', false]]);
  for (const acao of [compactarPacote, extrairPacote]) {
    const chamadas = [];
    const opcoes = { executar(exe, args) {
      chamadas.push(args[0]);
      return args[0] === 'l' ? lista : '';
    } };
    assert.throws(() => acao(...(acao === compactarPacote ? [dir, arquivo] : [arquivo, path.join(dir, 'saida')]),
      'fixture', senha, opcoes), /Backup sem criptografia de nomes; recusado\./);
    assert.deepEqual(chamadas, acao === compactarPacote ? ['a', 'l'] : ['l']);
  }
});
