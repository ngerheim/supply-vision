import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

test('link publico do Power BI nao entra em arquivo versionado', () => {
  const raiz = resolve(import.meta.dirname, '../..');
  const arquivos = execFileSync('git', ['ls-files', '-z'], {
    cwd: raiz,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean);
  const assinatura = ['app.powerbi.com', '/view?r='].join('');
  const encontrados = [];
  for (const arquivo of arquivos) {
    try {
      if (readFileSync(resolve(raiz, arquivo), 'utf8').includes(assinatura))
        encontrados.push(arquivo);
    } catch {
      /* arquivo binario: nao participa desta verificacao */
    }
  }
  assert.deepEqual(
    encontrados,
    [],
    `remova o link publico destes arquivos: ${encontrados.join(', ')}`,
  );
});
