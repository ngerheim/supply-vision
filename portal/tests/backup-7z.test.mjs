import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { executar7z, exigirNomesCriptografados, FalhaBackup } from '../scripts/backup-7z.mjs';
import { compactarPacote, extrairPacote, listarConfiguracao, exigirDestinoSeguro } from '../scripts/backup-pacote.mjs';
import { criarTemporarioTeste } from './apoio/ambiente.mjs';
import { bancoFicticio } from './apoio/backup.mjs';

const eol = process.platform === 'win32' ? '\r\n' : '\n';
const prompt = `${eol}Enter password (will not be echoed):${eol}`;
const lista = `Path = banco/portal.sqlite${eol}Encrypted = +${eol}${eol}`;
const senhaTeste = () => `Ficticia ç !"${randomBytes(18).toString('hex')}`;
const eofCriptografado = () => Object.assign(new Error('saida nativa'), { status: 255, stdout: Buffer.from(prompt) });

void test('pacote: recusa junction intermediaria na configuracao e no destino dentro da base', t => {
  const dir = criarTemporarioTeste('sv-pacote-ancestral-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const raiz = path.join(dir, 'privado'), fora = path.join(dir, 'fora');
  fs.mkdirSync(raiz); fs.mkdirSync(path.join(fora, 'config'), { recursive: true });
  fs.writeFileSync(path.join(fora, 'config/fixture.env'), 'FICTICIO=1');
  fs.symlinkSync(fora, path.join(raiz, 'alertas'), process.platform === 'win32' ? 'junction' : 'dir');
  fs.mkdirSync(path.join(fora, 'configuracao'), { recursive: true });
  fs.symlinkSync(fora, path.join(raiz, 'portal'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => exigirDestinoSeguro('portal/configuracao/novo.env', raiz), /Link|fora/);
  assert.throws(() => listarConfiguracao(raiz), /Link|fora/);
});

void test('pacote: aceita base configurada sob junction externa', t => {
  const dir = criarTemporarioTeste('sv-pacote-base-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fisico = path.join(dir, 'fisico'), alias = path.join(dir, 'alias');
  fs.mkdirSync(path.join(fisico, 'privado/comum'), { recursive: true });
  fs.writeFileSync(path.join(fisico, 'privado/comum/fixture.env'), 'FICTICIO=1');
  fs.symlinkSync(fisico, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const raiz = path.join(alias, 'privado');
  assert.deepEqual(listarConfiguracao(raiz), ['comum/fixture.env']);
  assert.equal(exigirDestinoSeguro('comum/novo.env', raiz), path.join(raiz, 'comum/novo.env'));
});

void test('pacote: backup sob preload ativo nao consulta caminhos acima das bases', t => {
  const dir = criarTemporarioTeste('sv-pacote-isolado-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const raiz = path.join(dir, `.fixture-preparo-${randomBytes(16).toString('hex')}`);
  const scripts = path.join(raiz, 'portal/scripts'), privado = path.join(raiz, 'privado'), cache = path.join(raiz, '.cache');
  fs.mkdirSync(scripts, { recursive: true }); fs.mkdirSync(cache);
  fs.mkdirSync(path.join(privado, 'comum'), { recursive: true });
  fs.writeFileSync(path.join(privado, 'comum/fixture.env'), 'FICTICIO=1');
  for (const nome of ['backup-pacote', 'caminhos', 'banco-local', 'snapshot-banco', 'backup-7z', 'backup-rede',
    'validar-banco', 'retencao-backup', 'modo-ensaio', 'isolamento-preparo', 'isolamento-sqlite-hooks']) {
    fs.copyFileSync(new URL(`../scripts/${nome}.mjs`, import.meta.url), path.join(scripts, `${nome}.mjs`));
  }
  bancoFicticio(path.join(privado, 'fixture.sqlite')).close();
  const codigo = `import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
    import {montarPacote,validarPacote,listarConfiguracao,exigirDestinoSeguro} from ${JSON.stringify(pathToFileURL(path.join(scripts, 'backup-pacote.mjs')).href)};
    const raiz=process.env.SV_PREPARO_RAIZ,privado=process.env.SUPPLY_VISION_PRIVADO,pacote=path.join(raiz,'pacote');
    assert.throws(()=>fs.lstatSync(path.dirname(raiz)),/fora do worktree/);
    montarPacote(pacote,{raiz:privado,banco:path.join(privado,'fixture.sqlite')});
    assert.equal(validarPacote(pacote).formato,1);
    const permitido=p=>{const r=path.relative(privado,path.resolve(p));assert.ok(!r.startsWith('..')&&!path.isAbsolute(r),'acesso acima da base: '+p)};
    for(const nome of ['existsSync','lstatSync']){const original=fs[nome];fs[nome]=(...args)=>{permitido(args[0]);return original(...args)}}
    const real=fs.realpathSync.native;fs.realpathSync.native=(...args)=>{permitido(args[0]);return real(...args)};
    assert.deepEqual(listarConfiguracao(privado),['comum/fixture.env']);
    assert.equal(exigirDestinoSeguro('comum/novo.env',privado),path.join(privado,'comum/novo.env'));`;
  const env = { ...process.env, NODE_OPTIONS: '', SV_PREPARO_RAIZ: raiz, SUPPLY_VISION_PRIVADO: privado,
    TEMP: cache, TMP: cache, TMPDIR: cache, XDG_CONFIG_HOME: cache, XDG_CACHE_HOME: cache };
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(path.join(scripts, 'isolamento-preparo.mjs')).href,
    '--input-type=module', '-e', codigo], { env, encoding: 'utf8', timeout: 20000, windowsHide: true });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

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
  let chamadas = 0;
  const executar = () => { chamadas++; throw new Error('processo nao deveria iniciar'); };
  for (const senha of ['', 'a\rb', 'a\nb', 'a\0b', null, 123]) {
    assert.throws(() => executar7z('fixture', senha, ['t', 'fixture.7z'], { executar }), FalhaBackup);
    assert.equal(chamadas, 0);
  }
  const senha = senhaTeste();
  for (const argumento of ['-p', `-p${senha}`, `-P${senha}`]) {
    assert.throws(() => executar7z('fixture', senha, ['t', 'fixture.7z', argumento], { executar }), FalhaBackup);
    assert.equal(chamadas, 0);
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
