import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Caminhos literais e nomes construidos nos lacos PowerShell do workflow.
// tests/ e relativo ao job Portal; scripts/ e portal/ partem da raiz.
// Nomes PS1 sem pasta nos drivers de CI pertencem a scripts/.
export function arquivosTesteCI(workflow) {
  const arquivos = new Set();
  for (const [nome] of workflow.matchAll(/(?:\.\/)?(?:[\w.-]+\/)*(?:[\w.-]+\.test\.(?:mjs|[cm]?js|tsx?)|(?:testar-|teste-|test_|validar-)[\w.-]+\.(?:ps1|mjs|py))/g)) {
    const arquivo = nome.replace(/^\.\//, '');
    arquivos.add(arquivo.startsWith('tests/') ? `portal/${arquivo}`
      : !arquivo.includes('/') && arquivo.endsWith('.ps1') ? `scripts/${arquivo}` : arquivo);
  }
  for (const [, nome] of workflow.matchAll(/['"](testar-[\w-]+)['"]/g)) arquivos.add(`scripts/${nome}.ps1`);
  return [...arquivos].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
}

export function verificarTestesCI(workflow, raiz) {
  const arquivos = new Set(arquivosTesteCI(workflow));
  const ausentes = [];
  for (const arquivo of arquivos) {
    const caminho = path.join(raiz, arquivo);
    if (!fs.statSync(caminho, { throwIfNoEntry: false })?.isFile()) {
      ausentes.push(arquivo);
      continue;
    }
    // Drivers extraidos do YAML tambem chamam testes. Nao interpretar suites
    // inteiras: elas podem citar scripts ficticios criados so durante o teste.
    if (arquivo.startsWith('scripts/ci/')) {
      for (const chamado of arquivosTesteCI(fs.readFileSync(caminho, 'utf8'))) arquivos.add(chamado);
    }
  }
  if (ausentes.length) throw new Error(`Testes citados no CI inexistentes:\n${ausentes.join('\n')}`);
  return arquivos.size;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const raiz = path.resolve(import.meta.dirname, '../..');
  console.log(`${verificarTestesCI(fs.readFileSync(path.join(raiz, '.github/workflows/ci.yml'), 'utf8'), raiz)} arquivos de teste do CI conferidos.`);
}
