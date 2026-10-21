import assert from 'node:assert/strict';
import childProcess, { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test, { mock } from 'node:test';
import { arquivosComInfraInterna, lerTermosProibidos, contemInfra, commitsComInfraInterna, conferirXlsx, lockfileSeguro } from '../../scripts/verificar-infra-publica.mjs';

const fixtureProibida = ['10', '23', '45', '67'].join('.');
const padroesFicticios = [fixtureProibida, 'ZZ-4321', 'pessoa.ficticia'];
const noreplyPermitidos = ['noreply@openai.com', 'noreply@anthropic.com', 'noreply@github.com', '12345+fixture-user@users.noreply.github.com'];
const noreplyRecusados = [
  'contato' + '@openai.com', 'contato' + '@anthropic.com', 'contato' + '@github.com',
  'noreply' + '@openai.com.br', 'noreply' + '@users.noreply.github.com',
  'alguem' + '@empresa.com.br', 'abc+fixture' + '@users.noreply.github.com',
  '12345+' + '@users.noreply.github.com', '12345+fixture_user' + '@users.noreply.github.com',
  '12345+fixture+extra' + '@users.noreply.github.com',
];

void test('noreply exatos passam em arquivos e mensagens; variantes proximas reprovam', () => {
  for (const [enderecos, esperado] of [[noreplyPermitidos, false], [noreplyRecusados, true]]) {
    for (const endereco of enderecos) for (const email of [endereco, endereco.toUpperCase()]) {
      for (const arquivo of ['AGENTS.md', 'src/config.mjs', 'config.json', 'portal/tests/fixture.txt']) {
        assert.equal(contemInfra(`contato: <${email}>`, { arquivo }), esperado, email);
      }
      assert.equal(contemInfra(`fix: fixture\n\nCo-Authored-By: Bot <${email}>`), esperado, email);
    }
  }
  assert.equal(contemInfra(noreplyPermitidos[0], { termos: ['NOREPLY'] }), true);
  const usuarioComHifen = '12345+zz-4321@users.noreply.github.com';
  assert.equal(contemInfra(usuarioComHifen), false);
  assert.equal(contemInfra(usuarioComHifen + ' ZZ-4321'), true);
});

void test('mensagens completas e identidades dos commits respeitam termos privados e noreply', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-noreply-parser-'));
  const limpos = ['a'.repeat(40), 'Teste', 'teste@example.com', 'Teste', 'teste@example.com', 'fix: fixture'];
  let campos = [...limpos];
  // Exercita o parser real sem criar commits; somente a saida do Git e simulada.
  const git = mock.method(childProcess, 'spawnSync', (executavel, argumentos) => {
    assert.equal(executavel, 'git');
    if (argumentos[0] === 'rev-parse') return { status: 0, stdout: raiz + '\n' };
    assert.equal(argumentos[0], 'log');
    if (argumentos.includes('-p')) {
      assert.ok(argumentos.includes('--format='));
      assert.ok(argumentos.includes('-m'));
      return { status: 0, stdout: 'diff --git a/texto.txt b/texto.txt\n+++ b/texto.txt\n@@ -0,0 +1 @@\n+limpo\n' };
    }
    assert.ok(argumentos.includes('-z'));
    assert.ok(argumentos.includes('--format=%H%x00%an%x00%ae%x00%cn%x00%ce%x00%B'));
    return { status: 0, stdout: campos.join('\0') + '\0' };
  });
  syncBuiltinESMExports();
  try {
    for (const [enderecos, esperado] of [[noreplyPermitidos, false], [noreplyRecusados, true]]) {
      for (const endereco of enderecos) for (const email of [endereco, endereco.toUpperCase()]) {
        for (const indice of [2, 4, 5]) {
          campos = [...limpos];
          campos[indice] = indice === 5 ? `fix: fixture\n\nCo-Authored-By: Bot <${email}>` : email;
          assert.equal(commitsComInfraInterna(raiz, 'a'.repeat(40)), esperado, email);
        }
      }
    }
    fs.mkdirSync(path.join(raiz, 'privado'));
    fs.writeFileSync(path.join(raiz, 'privado/termos-proibidos.txt'), 'termo-privado-fixture');
    for (const proibido of ['TERMO-PRIVADO-FIXTURE', fixtureProibida, 'pessoa.ficticia']) {
      for (const indice of [1, 2, 3, 4, 5]) {
        for (const valor of indice === 5
          ? [`fix: fixture\n\n${proibido}`, `fix: fixture\n\nTrailer: ${proibido}`, `fix: fixture\n\n+ ${proibido}`]
          : [proibido]) {
          campos = [...limpos]; campos[indice] = valor;
          assert.equal(commitsComInfraInterna(raiz, 'a'.repeat(40)), true, `${indice}: ${valor}`);
        }
      }
    }
    campos = [...limpos];
    campos[5] = 'fix: fixture\n\ndiff --git a/limpo b/limpo\n+linha limpa\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_fixture';
    assert.equal(commitsComInfraInterna(raiz, 'a'.repeat(40)), false);
  } finally {
    git.mock.restore(); syncBuiltinESMExports();
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

function comRepositorio(conferir) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-infra-ficticia-'));
  const gravar = (nome, conteudo, versionado = true) => {
    const arquivo = path.join(raiz, nome);
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    fs.writeFileSync(arquivo, conteudo);
    if (versionado) execFileSync('git', ['add', '--', nome], { cwd: raiz, stdio: 'pipe' });
  };
  try {
    execFileSync('git', ['init', '--initial-branch=main'], { cwd: raiz, stdio: 'pipe' });
    conferir(raiz, gravar);
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
}

void test('exemplos genericos passam e arquivos nao versionados ficam fora da verificacao', () => {
  comRepositorio((raiz, gravar) => {
    gravar('docs/exemplo.md', 'SERVIDOR DOMINIO\\SERVIDOR$ portal.empresa.local \\\\servidor-arquivos\\pasta\\backups');
    gravar('rascunho.txt', padroesFicticios.join(' '), false);
    assert.deepEqual(arquivosComInfraInterna(raiz), []);
  });
});

void test('cada padrao proibido e detectado sem distinguir maiusculas', () => {
  for (const padrao of padroesFicticios) {
    comRepositorio((raiz, gravar) => {
      gravar('docs/exemplo.md', `fixture ${padrao.toLowerCase()} fixture`);
      assert.deepEqual(arquivosComInfraInterna(raiz), ['docs/exemplo.md']);
      gravar('docs/exemplo.md', `fixture ${padrao.toUpperCase()} fixture`);
      assert.deepEqual(arquivosComInfraInterna(raiz), ['docs/exemplo.md']);
    });
  }
});

void test('package-lock e conferido estruturalmente, sem confundir versao com IP', () => {
  comRepositorio((raiz, gravar) => {
    const seguro = { lockfileVersion: 3, packages: { '': { version: '10.0.0' }, 'node_modules/pacote': { resolved: 'https://registry.npmjs.org/pacote/-/pacote-1.0.0.tgz', integrity: 'sha512-YWJj' } } };
    gravar('portal/package-lock.json', JSON.stringify(seguro));
    assert.deepEqual(arquivosComInfraInterna(raiz), []);
    seguro.packages['node_modules/pacote'].resolved = 'https://' + ['10','20','30','40'].join('.') + '/pacote.tgz';
    gravar('portal/package-lock.json', JSON.stringify(seguro));
    assert.deepEqual(arquivosComInfraInterna(raiz), ['portal/package-lock.json']);
    assert.equal(lockfileSeguro('nao JSON'), false);
    seguro.packages['node_modules/pacote'].integrity = 'segredo';
    assert.equal(lockfileSeguro(JSON.stringify(seguro)), false);
  });
});

void test('arquivos binarios versionados tambem sao conferidos', () => {
  comRepositorio((raiz, gravar) => {
    gravar('fixture.bin', Buffer.concat([Buffer.from([0]), Buffer.from(fixtureProibida), Buffer.from([0])]));
    assert.deepEqual(arquivosComInfraInterna(raiz), ['fixture.bin']);
  });
});

void test('falha de Git nao e tratada como verificacao aprovada', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-sem-git-'));
  try { assert.throws(() => arquivosComInfraInterna(raiz), /Nao foi possivel/); }
  finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

void test('novas faixas privadas, DNS, usuario, UNC e Power BI; exemplos exatos permitidos', () => {
  const ips = [['10','20','30','40'],['172','16','0','1'],['172','31','255','1'],['192','168','1','2']];
  for(const ip of ips) assert.equal(contemInfra(ip.join('.')),true);
  for(const ip of [['172','15','0','1'],['172','32','0','1'],['192','0','2','1']]) assert.equal(contemInfra(ip.join('.')),false);
  const barra=String.fromCharCode(92);
  for(const texto of ['maquina.'+['lo','cal'].join(''), 'C:'+barra+'Users'+barra+'pessoa-ficticia', barra.repeat(2)+'host-ficticio'+barra+'pasta', ['powerbi','com'].join('.')+'/view'+'?r=exemplo']) assert.equal(contemInfra(texto),true,texto);
  assert.equal(contemInfra('portal.empresa.local portal.local teste.local'),false);
  assert.equal(contemInfra('x.localeCompare(y) 10.000 km 10.0.13'),false);
});
void test('extensao de addon Node nao e conta; nome ficticio continua detectado', () => {
  assert.equal(contemInfra('engines.node'), false);
  assert.equal(contemInfra('fix: preservar dependencias ao mudar somente engines.node'), false);
  assert.equal(contemInfra('pessoa.ficticia'), true);
});
void test('integrity valido nao dispensa termos privados literais', () => {
  const texto = JSON.stringify({ lockfileVersion: 3, packages: { '': { integrity: 'sha512-QUJD' } } });
  assert.equal(lockfileSeguro(texto), true);
  assert.equal(lockfileSeguro(texto, { termos: ['qujd'] }), false);
  assert.equal(lockfileSeguro(texto, { arquivo: 'portal/tests/package-lock.json', termos: ['qujd'] }), false);
  assert.equal(lockfileSeguro(texto.replace('QUJD', '\\u0051UJD'), { termos: ['qujd'] }), false);
});
void test('commit intermediario removido do checkout ainda e detectado; base excluida', () => {
  comRepositorio((raiz, gravar) => {
    const git = args => execFileSync('git', ['-c','user.name=Teste','-c','user.email=teste@example.com',...args], {cwd:raiz,encoding:'utf8'}).trim();
    gravar('texto.txt','limpo');git(['commit','-m','base']);const base=git(['rev-parse','HEAD']);
    gravar('texto.txt',fixtureProibida);git(['commit','-m','intermediario']);
    gravar('texto.txt','limpo');git(['commit','-m','remover']);
    assert.deepEqual(arquivosComInfraInterna(raiz),[]);
    assert.equal(commitsComInfraInterna(raiz,base),true);
    assert.equal(commitsComInfraInterna(raiz,git(['rev-parse','HEAD'])),false);
    assert.throws(()=>commitsComInfraInterna(raiz,'main'));
  });
});
void test('Git real separa corpo e trailers do patch e confere resolucao de merge', () => {
  comRepositorio((raiz, gravar) => {
    const git = args => execFileSync('git', ['-c', 'user.name=Teste', '-c', 'user.email=12345+fixture-user@users.noreply.github.com', ...args], { cwd: raiz, encoding: 'utf8', stdio: 'pipe' }).trim();
    gravar('texto.txt', 'base\n'); git(['commit', '-m', 'base']);
    const base = git(['rev-parse', 'HEAD']);
    git(['commit', '--allow-empty', '-m', 'fixture', '-m', 'diff --git a/limpo b/limpo\n+linha limpa\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_fixture']);
    assert.equal(commitsComInfraInterna(raiz, base), false);
    git(['commit', '--allow-empty', '-m', 'fixture', '-m', `+${fixtureProibida}`]);
    assert.equal(commitsComInfraInterna(raiz, base), true);
    const antesMerge = git(['rev-parse', 'HEAD']);
    git(['checkout', '-b', 'lado']);
    gravar('lado.txt', 'limpo\n'); git(['commit', '-m', 'lado']);
    git(['checkout', 'main']);
    gravar('principal.txt', 'limpo\n'); git(['commit', '-m', 'principal']);
    git(['merge', '--no-ff', '--no-commit', 'lado']);
    gravar('texto.txt', fixtureProibida); git(['commit', '-m', 'merge']);
    assert.equal(commitsComInfraInterna(raiz, antesMerge), true);
  });
});
void test('SheetJS: hash fixado, comparacao com oficial e adulteracao bloqueada', () => {
  const arquivo=new URL('../vendor/xlsx-0.20.3.tgz',import.meta.url);
  assert.equal(conferirXlsx(arquivo,arquivo).length,64);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sv-xlsx-'));
  try{
    const diferente=path.join(dir,'pacote.tgz');fs.writeFileSync(diferente,'adulterado');
    assert.throws(()=>conferirXlsx(diferente),/hash/);
    assert.throws(()=>conferirXlsx(arquivo,diferente),/oficial/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

void test('worktree detached preserva guardas de arquivos, historico e raiz Git', () => {
  comRepositorio((raiz, gravar) => {
    const git = args => execFileSync('git', ['-c','user.name=Teste','-c','user.email=teste@example.com',...args], {cwd:raiz,encoding:'utf8',stdio:'pipe'}).trim();
    gravar('texto.txt','limpo');git(['commit','-m','base']);const base=git(['rev-parse','HEAD']);
    const worktree = path.join(raiz, 'worktree-descartavel');
    git(['worktree','add','--detach',worktree,base]);
    try {
      assert.equal(fs.statSync(path.join(worktree,'.git')).isFile(),true);
      assert.deepEqual(arquivosComInfraInterna(worktree),[]);
      fs.writeFileSync(path.join(worktree,'texto.txt'),fixtureProibida);
      execFileSync('git',['add','texto.txt'],{cwd:worktree});
      execFileSync('git',['-c','user.name=Teste','-c','user.email=teste@example.com','commit','-m','fixture'],{cwd:worktree,stdio:'pipe'});
      assert.deepEqual(arquivosComInfraInterna(worktree),['texto.txt']);
      assert.equal(commitsComInfraInterna(worktree,base),true);
      const aninhada = path.join(worktree,'sem-git');fs.mkdirSync(aninhada);
      assert.throws(()=>arquivosComInfraInterna(aninhada),/Nao foi possivel/);
    } finally { git(['worktree','remove','--force',worktree]); }
  });
});

void test('IPv4 privado valida quatro octetos e as fronteiras das faixas', () => {
  for (const octetos of [[10,0,0,0],[10,255,255,255],[172,16,0,0],[172,31,255,255],[192,168,0,0]]) {
    assert.equal(contemInfra(octetos.join('.')), true);
  }
  for (const octetos of [[127,0,0,1],[0,0,0,0],[172,15,255,255],[172,32,0,0],[192,169,0,1],[10,999,0,1]]) {
    assert.equal(contemInfra(octetos.join('.')), false);
  }
  assert.equal(contemInfra('10.0.13 10.000 1.2.3.4.5'), false);
});
void test('IPv6 ULA e link-local validam sintaxe, fronteiras, zona e URL', () => {
  const enderecos = [['fc00','',''], ['fdff','ffff','ffff','ffff','ffff','ffff','ffff','ffff'], ['fe80','','1'], ['febf','','abcd']];
  for (const partes of enderecos) {
    const ip = partes.join(':');
    for (const valor of [ip, ip.toUpperCase(), `http://[${ip}]:3199/`, ip + '%interface0', ip + '.']) {
      assert.equal(contemInfra(valor), true, valor);
    }
  }
  for (const partes of [['fbff','','1'], ['fe00','','1'], ['fe7f','','1'], ['fec0','','1'], ['2001','db8','','1'], ['','','1'], ['','',''], ['fc00','','xyz']]) {
    assert.equal(contemInfra(partes.join(':')), false, partes.join(':'));
  }
});
void test('e-mails corporativos e contas com email nao escapam pelos delimitadores', () => {
  for (const valor of ['operador', 'operador-suporte', 'pessoa.ficticia', 'pessoa_ficticia', 'pessoa+suporte', '_operador']) {
    const email = valor + '@corp-ficticia.com';
    for (const arquivo of ['AGENTS.md', 'src/config.mjs', 'config.json', 'portal/tests/fixture.txt']) {
      assert.equal(contemInfra(`contato: <${email}>`, { arquivo }), true, arquivo);
    }
  }
  for (const dominio of ['example.com', 'example.org', 'example.net', 'portal.test', 'example.invalid', 'portal.local']) {
    assert.equal(contemInfra('operador@' + dominio), false, dominio);
  }
  for (const arquivo of ['AGENTS.md', 'src/config.mjs', 'config.json']) {
    assert.equal(contemInfra('"pessoa.ficticia@example.com"', { arquivo }), true, arquivo);
  }
  assert.equal(contemInfra('pessoa.ficticia@example.com', { arquivo: 'portal/tests/fixture.txt' }), false);
});
void test('caminhos de rede alternativos e perfis com barras normais sao detectados', () => {
  const barra = String.fromCharCode(92);
  const host = 'host-ficticio';
  for (const texto of [
    '(' + barra.repeat(2) + host + barra + 'pasta)',
    barra.repeat(8) + host + barra.repeat(4) + 'pasta',
    '//' + host + '/pasta',
    'file://' + host + '/pasta',
    'smb://' + host + '/pasta',
    barra.repeat(2) + '?' + barra + 'UNC' + barra + host + barra + 'pasta',
    'C:/Users/' + 'perfil-ficticio/arquivo.txt',
    'D:' + barra + 'Users' + barra + 'perfil-ficticio',
  ]) assert.equal(contemInfra(texto), true, texto);
  for (const texto of ['https://example.com/pasta', 'file:///C:/Projetos/arquivo.txt', '//servidor/pasta', 'C:/Users/nome/arquivo.txt']) {
    assert.equal(contemInfra(texto), false, texto);
  }
});
void test('escapes comuns de URL e JSON nao ocultam DNS local, IP, email ou UNC', () => {
  const barra = String.fromCharCode(92);
  const host = 'host-ficticio';
  const valores = [host + '.local', fixtureProibida, 'operador' + '@corp-ficticia.com', barra.repeat(2) + host + barra + 'pasta'];
  for (const valor of valores) {
    const percentual = Array.from(valor, c => '%' + c.charCodeAt(0).toString(16)).join('');
    const unicode = Array.from(valor, c => barra + 'u00' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    assert.equal(contemInfra(percentual), true, valor);
    assert.equal(contemInfra(unicode), true, valor);
    assert.equal(lockfileSeguro(JSON.stringify({ lockfileVersion: 3, packages: { '': { resolved: percentual } } })), false);
  }
  assert.equal(contemInfra('portal%2elocal teste%2elocal'), false);
  assert.equal(contemInfra('fixture%2dsecreta', { termos: ['FIXTURE-SECRETA'] }), true);
  assert.equal(contemInfra('percentual %zz e escape ' + barra + 'uZZZZ'), false);
});
void test('Power BI verifica parametros fora de ordem, HTML, reportEmbed e barras escapadas', () => {
  const host = ['app', 'powerbi', 'com'].join('.');
  for (const sufixo of ['/view?foo=1&r=ficticio', '/view?foo=1&amp;r=ficticio', '/reportEmbed?reportId=ficticio']) {
    const url = 'https://' + host + sufixo;
    assert.equal(contemInfra(url), true, sufixo);
    assert.equal(contemInfra(url.replaceAll('/', String.fromCharCode(92) + '/')), true, sufixo);
  }
  assert.equal(contemInfra('https://' + host), false);
});
void test('nomes genericos so abrem excecao nos caminhos de fixtures e exemplos', () => {
  for (const valor of ['ZZ-4321', 'pessoa.ficticia']) {
    assert.equal(contemInfra(valor), true);
    assert.equal(contemInfra(`const login = '${valor}';`, { arquivo: 'src/login.mjs' }), true);
    for (const arquivo of ['portal/tests/contrato.test.mjs', 'scripts/testar-conta.ps1', 'privado.exemplo/conta.txt', 'conta.env.example']) {
      assert.equal(contemInfra(valor, { arquivo }), false);
    }
    for (const arquivo of ['src/fixtures.txt', 'src/conta.mjs', 'AGENTS.md']) assert.equal(contemInfra(valor, { arquivo }), true);
  }
  assert.equal(contemInfra("const valor = 'pessoa.ficticia';", { arquivo: 'src/conta.mjs' }), true);
  assert.equal(contemInfra('url.username || url.password', { arquivo: 'src/url.mjs' }), false);
  assert.equal(contemInfra('usuario = "C:\\\\Users\\\\nome"'), false);
  assert.equal(contemInfra(['portal', 'empresa', 'local', 'falso', 'local'].join('.')), true);
  assert.equal(contemInfra(String.fromCharCode(92).repeat(2) + 'servidor-extra' + String.fromCharCode(92) + 'pasta'), true);
});
void test('lista privada opcional usa termos literais, comentarios, BOM e caixa', () => {
  comRepositorio((raiz, gravar) => {
    assert.deepEqual(lerTermosProibidos(raiz), []);
    gravar('src/limpo.txt', 'PROJETO-FICTICIO-ALFA');
    assert.deepEqual(arquivosComInfraInterna(raiz), []);
    gravar('privado/termos-proibidos.txt', '\uFEFF# somente ficticios\r\n\r\nprojeto-ficticio-alfa\r\n', false);
    assert.deepEqual(lerTermosProibidos(raiz), ['projeto-ficticio-alfa']);
    assert.deepEqual(arquivosComInfraInterna(raiz), ['src/limpo.txt']);
    gravar('src/limpo.txt', 'limpo');
    gravar('portal/tests/fixture.txt', 'projeto-ficticio-alfa');
    assert.deepEqual(arquivosComInfraInterna(raiz), ['portal/tests/fixture.txt']);
  });
});
void test('limpeza de dado antigo nao e bloqueada por linhas removidas do historico', () => {
  comRepositorio((raiz, gravar) => {
    const git = args => execFileSync('git', ['-c','user.name=Teste','-c','user.email=teste@example.com',...args], {cwd:raiz,encoding:'utf8',stdio:'pipe'}).trim();
    gravar('texto.txt', fixtureProibida); git(['commit','-m','base ficticia']); const base = git(['rev-parse','HEAD']);
    gravar('texto.txt', 'limpo'); git(['commit','-m','limpeza']);
    assert.equal(commitsComInfraInterna(raiz, base), false);
    gravar('portal/tests/conta.txt', 'ZZ-4321 pessoa.ficticia'); git(['commit','-m','fixture permitida']);
    assert.equal(commitsComInfraInterna(raiz, base), false);
  });
});
