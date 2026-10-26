import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Caminhos literais e nomes construidos nos lacos PowerShell do workflow.
// tests/ e relativo ao job Portal; scripts/ e portal/ partem da raiz.
// Nomes PS1 sem pasta nos drivers de CI pertencem a scripts/.
export function arquivosTesteCI(workflow) {
  const arquivos = new Set();
  for (const [nome] of workflow.matchAll(/(?:\.\/)?(?:[\w.-]+\/)*(?:[\w.-]+\.(?:test|spec)\.(?:mjs|[cm]?js|tsx?)|[\w.-]+_test\.py|(?:testar-|teste-|test_|validar-)[\w.-]+\.(?:ps1|mjs|py))/g)) {
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
  const padroes = padroesTesteCI(workflow, raiz);
  const inventario = inventariarTestes(raiz);
  const cobertos = new Set(arquivos);
  for (const arquivo of inventario) {
    if (padroes.some(padrao => {
      if (padrao.endsWith('.py') && arquivo.split('/').slice(2, -1).some(pasta =>
        /^(?:build|dist|node_modules|venv|_darcs|CVS|\{arch\})$|^\.|\.egg$/.test(pasta))) return false;
      return path.posix.matchesGlob(arquivo, padrao);
    })) cobertos.add(arquivo);
  }
  // npm run test:imports/test:restore e os drivers chamam testes auxiliares.
  // Para cobertura, seguir somente arquivos reais: strings de fixtures nao
  // passam a ser referencias obrigatorias (a guarda dos drivers acima fica).
  const manifesto = path.join(raiz, 'portal/package.json');
  if (fs.existsSync(manifesto)) {
    const scripts = JSON.parse(fs.readFileSync(manifesto, 'utf8')).scripts ?? {};
    for (const [, nome] of workflow.matchAll(/\bnpm run (test:[\w:-]+)/g)) {
      for (const chamado of arquivosTesteCI(scripts[nome] ?? '')) {
        const arquivo = chamado.startsWith('portal/') ? chamado : `portal/${chamado}`;
        if (fs.statSync(path.join(raiz, arquivo), { throwIfNoEntry: false })?.isFile()) cobertos.add(arquivo);
      }
    }
  }
  for (const arquivo of cobertos) {
    if (!arquivo.startsWith('scripts/') && !arquivo.startsWith('portal/scripts/')) continue;
    for (const chamado of arquivosTesteCI(fs.readFileSync(path.join(raiz, arquivo), 'utf8'))) {
      const candidatos = [chamado, path.posix.normalize(path.posix.join(path.posix.dirname(arquivo), chamado))];
      for (const candidato of candidatos) {
        if (!candidato.startsWith('../') && fs.statSync(path.join(raiz, candidato), { throwIfNoEntry: false })?.isFile()) cobertos.add(candidato);
      }
    }
  }
  const semReferencia = inventario.filter(arquivo => !cobertos.has(arquivo));
  if (semReferencia.length) throw new Error(`Testes sem referencia no CI ou padrao de suite:\n${semReferencia.join('\n')}`);
  return arquivos.size;
}

// Os argumentos sao lidos, nunca executados. Aceita os seletores de arquivo
// dos comandos de suite existentes; flags/imports nao sao seletores de teste.
function argumentos(comando) {
  return [...comando.matchAll(/"([^"\n]*)"|'([^'\n]*)'|([^\s]+)/g)].map(m => m[1] ?? m[2] ?? m[3]);
}

export function padroesTesteCI(workflow, raiz) {
  const padroes = [];
  if (/\bnpm test\b/.test(workflow)) {
    const manifesto = path.join(raiz, 'portal/package.json');
    if (fs.existsSync(manifesto)) {
      const comando = JSON.parse(fs.readFileSync(manifesto, 'utf8')).scripts?.test ?? '';
      for (const trecho of comando.split(/&&|\|\||;/)) {
        const args = argumentos(trecho);
        const indice = args.indexOf('--test');
        if (indice < 0) continue;
        for (let i = indice + 1; i < args.length; i++) {
          const arg = args[i];
          if (['--import', '--require', '-r', '--test-name-pattern', '--test-skip-pattern', '--test-reporter', '--test-reporter-destination'].includes(arg)) { i++; continue; }
          if (arg.startsWith('-') || !/\.(?:[cm]?js|tsx?)$/.test(arg)) continue;
          padroes.push(`portal/${arg.replace(/^\.\//, '')}`);
        }
      }
    }
  }
  // pytest usa test_*.py e *_test.py por padrao e percorre subpastas.
  // A raiz vem da chamada real no workflow, nao de toda a pasta alertas/.
  for (const [, comando] of workflow.matchAll(/\bpython -m pytest ([^\r\n]+)/g)) {
    const args = argumentos(comando);
    for (const arg of args) {
      if (arg !== 'alertas/tests') continue;
      padroes.push(`${arg}/**/test_*.py`, `${arg}/**/*_test.py`);
    }
  }
  return padroes;
}

function inventariarTestes(raiz) {
  const arquivos = [];
  function visitar(pasta) {
    if (!fs.existsSync(path.join(raiz, pasta))) return;
    for (const entrada of fs.readdirSync(path.join(raiz, pasta), { withFileTypes: true })) {
      if (['node_modules', '__pycache__', '.git', '.venv'].includes(entrada.name)) continue;
      const nome = `${pasta}/${entrada.name}`;
      if (entrada.isDirectory()) visitar(nome);
      else if (entrada.isFile() && /(?:\.(?:test|spec)\.(?:[cm]?js|tsx?)$|\/(?:testar-|teste-)[\w.-]+\.(?:ps1|mjs)$|\/(?:test_[\w.-]+|[\w.-]+_test)\.py$)/.test(nome)) arquivos.push(nome);
    }
  }
  for (const pasta of ['portal/tests', 'alertas/tests', 'scripts', 'portal/scripts']) visitar(pasta);
  return arquivos.sort();
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const raiz = path.resolve(import.meta.dirname, '../..');
  console.log(`${verificarTestesCI(fs.readFileSync(path.join(raiz, '.github/workflows/ci.yml'), 'utf8'), raiz)} arquivos de teste do CI conferidos.`);
}
