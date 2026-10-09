import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { arquivosComInfraInterna, padroesInfraInterna } from '../../scripts/verificar-infra-publica.mjs';

function comRepositorio(conferir) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-infra-ficticia-'));
  const gravar = (nome, conteudo, versionado = true) => {
    const arquivo = path.join(raiz, nome);
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    fs.writeFileSync(arquivo, conteudo);
    if (versionado) execFileSync('git', ['add', '--', nome], { cwd: raiz, stdio: 'pipe' });
  };
  try {
    execFileSync('git', ['init'], { cwd: raiz, stdio: 'pipe' });
    conferir(raiz, gravar);
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
}

void test('exemplos genericos passam e arquivos nao versionados ficam fora da verificacao', () => {
  comRepositorio((raiz, gravar) => {
    gravar('docs/exemplo.md', 'SERVIDOR DOMINIO\\SERVIDOR$ portal.empresa.local \\\\servidor-arquivos\\pasta\\backups');
    gravar('rascunho.txt', padroesInfraInterna.join(' '), false);
    assert.deepEqual(arquivosComInfraInterna(raiz), []);
  });
});

void test('cada padrao proibido e detectado sem distinguir maiusculas', () => {
  for (const padrao of padroesInfraInterna) {
    comRepositorio((raiz, gravar) => {
      gravar('docs/exemplo.md', `fixture ${padrao.toLowerCase()} fixture`);
      assert.deepEqual(arquivosComInfraInterna(raiz), ['docs/exemplo.md']);
      gravar('docs/exemplo.md', `fixture ${padrao.toUpperCase()} fixture`);
      assert.deepEqual(arquivosComInfraInterna(raiz), ['docs/exemplo.md']);
    });
  }
});

void test('package-lock.json e excluido na raiz e em subpastas', () => {
  comRepositorio((raiz, gravar) => {
    for (const nome of ['package-lock.json', 'portal/package-lock.json']) gravar(nome, padroesInfraInterna.join(' '));
    gravar('outro-lock.json', 'portal.empresa.local');
    assert.deepEqual(arquivosComInfraInterna(raiz), []);
  });
});

void test('arquivos binarios versionados tambem sao conferidos', () => {
  comRepositorio((raiz, gravar) => {
    gravar('fixture.bin', Buffer.concat([Buffer.from([0]), Buffer.from(padroesInfraInterna[0]), Buffer.from([0])]));
    assert.deepEqual(arquivosComInfraInterna(raiz), ['fixture.bin']);
  });
});

void test('falha de Git nao e tratada como verificacao aprovada', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-sem-git-'));
  try { assert.throws(() => arquivosComInfraInterna(raiz), /Nao foi possivel/); }
  finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});
