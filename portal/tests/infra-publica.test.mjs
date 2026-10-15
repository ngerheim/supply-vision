import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { arquivosComInfraInterna, lerTermosProibidos, contemInfra, commitsComInfraInterna, conferirXlsx, lockfileSeguro } from '../../scripts/verificar-infra-publica.mjs';

const fixtureProibida = ['10', '23', '45', '67'].join('.');
const padroesFicticios = [fixtureProibida, 'ZZ-4321', 'pessoa.ficticia'];

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
