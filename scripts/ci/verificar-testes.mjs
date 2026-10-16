import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Caminhos literais e nomes construidos no laco PowerShell do workflow.
// tests/ e relativo ao job Portal; scripts/ e portal/ partem da raiz.
export function arquivosTesteCI(workflow) {
  const arquivos = new Set();
  for (const [nome] of workflow.matchAll(/(?:\.\/)?(?:[\w.-]+\/)*(?:[\w.-]+\.test\.(?:mjs|[cm]?js|tsx?)|(?:testar-|teste-|test_)[\w.-]+\.(?:ps1|mjs|py))/g)) {
    const arquivo = nome.replace(/^\.\//, '');
    arquivos.add(arquivo.startsWith('tests/') ? `portal/${arquivo}` : arquivo);
  }
  for (const [, nome] of workflow.matchAll(/['"](testar-[\w-]+)['"]/g)) arquivos.add(`scripts/${nome}.ps1`);
  return [...arquivos].sort();
}

export function verificarTestesCI(workflow, raiz) {
  const arquivos = arquivosTesteCI(workflow);
  const ausentes = arquivos.filter(arquivo => !fs.statSync(path.join(raiz, arquivo), { throwIfNoEntry: false })?.isFile());
  if (ausentes.length) throw new Error(`Testes citados no CI inexistentes:\n${ausentes.join('\n')}`);
  return arquivos.length;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const raiz = path.resolve(import.meta.dirname, '../..');
  console.log(`${verificarTestesCI(fs.readFileSync(path.join(raiz, '.github/workflows/ci.yml'), 'utf8'), raiz)} arquivos de teste do CI conferidos.`);
}
