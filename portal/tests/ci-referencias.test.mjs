import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { arquivosTesteCI, verificarTestesCI } from '../../scripts/ci/verificar-testes.mjs';

void test('npm test seleciona arquivos pelo manifesto; arquivos ignorados exigem referencia', t => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-ci-padroes-'));
  t.after(() => fs.rmSync(raiz, { recursive: true, force: true }));
  const gravar = (nome, texto = '') => {
    fs.mkdirSync(path.dirname(path.join(raiz, nome)), { recursive: true });
    fs.writeFileSync(path.join(raiz, nome), texto);
  };
  const manifesto = padrao => gravar('portal/package.json', JSON.stringify({ scripts: {
    test: `node --import ./scripts/isolamento-preparo.mjs --test --experimental-strip-types ${padrao}`,
  } }));
  const workflow = 'run: npm test';
  manifesto('tests/*.test.ts tests/*.test.mjs');
  gravar('portal/tests/novo.test.ts');
  gravar('portal/tests/novo.test.mjs');
  assert.doesNotThrow(() => verificarTestesCI(workflow, raiz));
  gravar('portal/tests/ignorada/novo.test.mjs');
  assert.throws(() => verificarTestesCI(workflow, raiz), /ignorada\/novo\.test\.mjs/);
  const citado = `${workflow}\n# tests/ignorada/novo.test.mjs`;
  assert.doesNotThrow(() => verificarTestesCI(citado, raiz));
  manifesto('"tests/**/*.test.mjs" tests/*.test.ts');
  assert.doesNotThrow(() => verificarTestesCI(workflow, raiz));
  manifesto('tests/novo.test.ts');
  assert.throws(() => verificarTestesCI(workflow, raiz), /novo\.test\.mjs/);
  manifesto('tests/**/*.test.mjs tests/*.test.ts');
  gravar('portal/tests/.ignorada/oculto.test.mjs');
  assert.throws(() => verificarTestesCI(workflow, raiz), /\.ignorada\/oculto\.test\.mjs/);
  gravar('portal/tests/fora.spec.ts');
  assert.throws(() => verificarTestesCI(workflow, raiz), /fora\.spec\.ts/);
  assert.doesNotThrow(() => verificarTestesCI(`${workflow}\n# tests/fora.spec.ts\n# tests/.ignorada/oculto.test.mjs`, raiz));
  assert.throws(() => verificarTestesCI('# npm ausente', raiz), /novo\.test/);
});

void test('pytest cobre apenas a raiz executada e os nomes coletados por padrao', t => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-ci-pytest-'));
  t.after(() => fs.rmSync(raiz, { recursive: true, force: true }));
  fs.mkdirSync(path.join(raiz, 'alertas/tests/subpasta'), { recursive: true });
  for (const arquivo of ['test_novo.py', 'subpasta/novo_test.py']) fs.writeFileSync(path.join(raiz, 'alertas/tests', arquivo), '');
  assert.doesNotThrow(() => verificarTestesCI('run: python -m pytest alertas/tests -q', raiz));
  assert.throws(() => verificarTestesCI('run: python -m pytest outro/tests -q', raiz), /test_novo\.py/);
  fs.mkdirSync(path.join(raiz, 'alertas/tests/build'));
  fs.writeFileSync(path.join(raiz, 'alertas/tests/build/test_ignorado.py'), '');
  assert.throws(() => verificarTestesCI('run: python -m pytest alertas/tests -q', raiz), /build\/test_ignorado\.py/);
});

void test('scripts de teste fora de suites exigem chamada do workflow ou de um driver coberto', t => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-ci-script-solto-'));
  t.after(() => fs.rmSync(raiz, { recursive: true, force: true }));
  fs.mkdirSync(path.join(raiz, 'scripts/ci'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'scripts/ci/testar-solto.ps1'), '');
  assert.throws(() => verificarTestesCI('', raiz), /scripts\/ci\/testar-solto\.ps1/);
  fs.writeFileSync(path.join(raiz, 'scripts/ci/testar-driver.ps1'), './scripts/ci/testar-solto.ps1');
  assert.doesNotThrow(() => verificarTestesCI('run: ./scripts/ci/testar-driver.ps1', raiz));
});

void test('guarda do CI recusa arquivo ausente, inclusive nome construido em laco', t => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-ci-referencias-'));
  t.after(() => fs.rmSync(raiz, { recursive: true, force: true }));
  const workflow = `run: node --test tests/sessao.test.mjs\nrun: ./portal/scripts/teste-portal-ponta-a-ponta.ps1\nforeach ($teste in @('testar-operacao')) { & ./scripts/$teste.ps1 }`;
  const arquivos = arquivosTesteCI(workflow);
  assert.deepEqual(arquivos, ['portal/scripts/teste-portal-ponta-a-ponta.ps1', 'portal/tests/sessao.test.mjs', 'scripts/testar-operacao.ps1']);
  for (const arquivo of arquivos) {
    fs.mkdirSync(path.dirname(path.join(raiz, arquivo)), { recursive: true });
    fs.writeFileSync(path.join(raiz, arquivo), '');
  }
  assert.equal(verificarTestesCI(workflow, raiz), 3);
  for (const arquivo of arquivos) {
    const alvo = path.join(raiz, arquivo);
    fs.unlinkSync(alvo);
    assert.throws(() => verificarTestesCI(workflow, raiz), erro => erro.message.includes(arquivo));
    fs.writeFileSync(alvo, '');
  }
});

void test('referencias dos grupos PowerShell cobrem scripts literais e lacos em jobs distintos', () => {
  const workflow = fs.readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const grupos = [...workflow.matchAll(/^  powershell-(?:inicializacao|protecoes|ensaio):\r?\n([\s\S]*?)(?=^  [\w-]+:)/gm)];
  assert.equal(grupos.length, 3);
  const arquivos = arquivosTesteCI(grupos.map(([, corpo]) => corpo).join('\n'));
  const esperados = [
    'scripts/testar-inicializacao.ps1',
    'scripts/testar-dependencias-preparo.ps1',
    'scripts/testar-atualizacao-segura.ps1',
    'scripts/testar-recuperacao-atualizacao.ps1',
    'scripts/testar-supervisor-isolado.ps1',
    'portal/scripts/testar-restricao-firewall.ps1',
    'portal/tests/orfaos-windows.test.mjs',
  ];
  for (const arquivo of esperados) assert.ok(arquivos.includes(arquivo), arquivo);
  const todos = new Set([...arquivosTesteCI(workflow), 'scripts/testar-persistencia-alertas.ps1', 'scripts/validar-operacao.ps1']);
  assert.equal(verificarTestesCI(workflow, fileURLToPath(new URL('../../', import.meta.url))), todos.size);
});

void test('referencias incluem drivers transitivos, nomes PS1 sem pasta e validacao operacional', t => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-ci-drivers-'));
  t.after(() => fs.rmSync(raiz, { recursive: true, force: true }));
  const gravar = (nome, texto = '') => {
    fs.mkdirSync(path.dirname(path.join(raiz, nome)), { recursive: true });
    fs.writeFileSync(path.join(raiz, nome), texto);
  };
  gravar('scripts/ci/testar-driver.ps1', "./scripts/ci/testar-secundario.ps1\n$teste='testar-filho.ps1'\n$teste='validar-operacao.ps1'");
  gravar('scripts/ci/testar-secundario.ps1', './scripts/ci/testar-driver.ps1');
  const workflow = 'run: ./scripts/ci/testar-driver.ps1';
  assert.throws(() => verificarTestesCI(workflow, raiz), /scripts\/testar-filho\.ps1/);
  gravar('scripts/testar-filho.ps1', "# teste-fixture.ps1 e criado so durante a suite");
  assert.throws(() => verificarTestesCI(workflow, raiz), /scripts\/validar-operacao\.ps1/);
  gravar('scripts/validar-operacao.ps1');
  assert.equal(verificarTestesCI(workflow, raiz), 4);
  fs.unlinkSync(path.join(raiz, 'scripts/ci/testar-secundario.ps1'));
  assert.throws(() => verificarTestesCI(workflow, raiz), /scripts\/ci\/testar-secundario\.ps1/);
});
