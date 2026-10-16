import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { arquivosTesteCI, verificarTestesCI } from '../../scripts/ci/verificar-testes.mjs';

void test('guarda do CI recusa arquivo ausente, inclusive nome construido em laco', t => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-ci-referencias-'));
  t.after(() => fs.rmSync(raiz, { recursive: true, force: true }));
  const workflow = `run: node --test tests/sessao.test.mjs\nrun: ./portal/scripts/teste-instalacao-nova.ps1\nforeach ($teste in @('testar-operacao')) { & ./scripts/$teste.ps1 }`;
  const arquivos = arquivosTesteCI(workflow);
  assert.deepEqual(arquivos, ['portal/scripts/teste-instalacao-nova.ps1', 'portal/tests/sessao.test.mjs', 'scripts/testar-operacao.ps1']);
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
