import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

void test('link publico do Power BI nao entra em arquivo versionado', () => {
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
    // Buffer tambem examina binarios; falha de leitura deve reprovar a guarda.
    if (readFileSync(resolve(raiz, arquivo)).includes(Buffer.from(assinatura)))
      encontrados.push(arquivo);
  }
  assert.deepEqual(
    encontrados,
    [],
    `remova o link publico destes arquivos: ${encontrados.join(', ')}`,
  );
});
