import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { classificar, escopo } from '../../scripts/ci/escopo-pr.mjs';

void test('via rapida so para telas, rotas, regras e testes', () => {
  for (const arquivos of [
    ['portal/components/portal-analise.tsx'], ['portal/lib/acordos-api.ts', 'portal/tests/acordos-opcoes.test.mjs'],
    ['portal/app/api/[...path]/route.ts'], ['alertas/processo/regras_comparacao.py', 'alertas/tests/test_regras.py'], ['AGENTS.md'], [],
  ]) assert.equal(classificar(arquivos).mecanismo, false, arquivos.join());
  for (const arquivos of [
    ['scripts/supervisor.ps1'], ['.github/workflows/ci.yml'], ['portal/package-lock.json'], ['portal/lib/database.ts'],
    ['portal/lib/pagamentos-schema.ts'], ['portal/scripts/servidor-node.mjs'], ['alertas/processo/pipeline.py'],
    ['alertas/config/requirements.txt'], ['supv.cmd'], ['portal/vendor/xlsx-0.20.3.tgz'], ['portal/components/x.tsx', 'scripts/supv.ps1'],
  ]) assert.equal(classificar(arquivos).mecanismo, true, arquivos.join());
  // Tabela nova fora dos arquivos de schema conhecidos tambem e mecanismo.
  assert.equal(classificar(['portal/lib/analise.ts'], '+  `CREATE TABLE IF NOT EXISTS x (id TEXT)`').mecanismo, true);
  assert.equal(classificar(['portal/lib/analise.ts'], '+  const total = 1;').mecanismo, false);
});

void test('fora de PR ou sem como calcular, roda tudo', () => {
  assert.equal(escopo({ evento: 'push' }).mecanismo, true);
  assert.equal(escopo({ evento: 'schedule' }).mecanismo, true);
  assert.equal(escopo({ evento: 'pull_request', base: 'x', head: 'y', raiz: os.tmpdir() }).mecanismo, true);
  assert.equal(escopo({ evento: 'pull_request', base: 'a'.repeat(40), head: 'b'.repeat(40), raiz: os.tmpdir() }).mecanismo, true);
});

void test('calcula o escopo pelo merge-base de um repositorio real', t => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-escopo-'));
  t.after(() => fs.rmSync(raiz, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Teste', '-c', 'user.email=teste@example.com', ...args], { cwd: raiz, encoding: 'utf8' }).trim();
  git('init', '-q');
  fs.mkdirSync(path.join(raiz, 'portal/components'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'portal/components/a.tsx'), 'a\n');
  git('add', '.'); git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(raiz, 'portal/components/a.tsx'), 'b\n');
  git('commit', '-qam', 'tela');
  const tela = git('rev-parse', 'HEAD');
  assert.equal(escopo({ evento: 'pull_request', base, head: tela, raiz }).mecanismo, false);
  fs.mkdirSync(path.join(raiz, 'scripts'));
  fs.writeFileSync(path.join(raiz, 'scripts/supv.ps1'), 'x\n');
  git('add', '.'); git('commit', '-qm', 'mecanismo');
  assert.equal(escopo({ evento: 'pull_request', base, head: git('rev-parse', 'HEAD'), raiz }).mecanismo, true);
});
