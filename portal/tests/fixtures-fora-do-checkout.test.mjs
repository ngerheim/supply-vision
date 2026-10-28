import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const raiz = path.dirname(fileURLToPath(import.meta.url));
const propria = path.basename(fileURLToPath(import.meta.url));
const padrao = new RegExp(`\\bmkdtemp(?:Sync)?\\s*\\(`, 'g');
const tmpPermitido = /\b(?:os\s*\.\s*tmpdir|tmpdir)\s*\(\s*\)/;

function arquivos(diretorio) {
  return fs.readdirSync(diretorio, { withFileTypes: true }).flatMap((entrada) => {
    const alvo = path.join(diretorio, entrada.name);
    return entrada.isDirectory() ? arquivos(alvo) : entrada.isFile() ? [alvo] : [];
  });
}

function argumento(source, abre) {
  let profundidade = 1;
  let aspas = '';
  for (let i = abre + 1; i < source.length; i += 1) {
    const caractere = source[i];
    if (aspas) {
      if (caractere === '\\') i += 1;
      else if (caractere === aspas) aspas = '';
    } else if (caractere === '"' || caractere === "'" || caractere === '`') aspas = caractere;
    else if (caractere === '(') profundidade += 1;
    else if (caractere === ')' && --profundidade === 0) return source.slice(abre + 1, i);
  }
  return source.slice(abre + 1);
}

void test('fixtures mkdtemp usam diretório temporário do sistema', () => {
  const falhas = [];
  for (const arquivo of arquivos(raiz)) {
    if (path.basename(arquivo) === propria) continue;
    const conteudo = fs.readFileSync(arquivo, 'utf8');
    padrao.lastIndex = 0;
    for (const chamada of conteudo.matchAll(padrao)) {
      const args = argumento(conteudo, chamada.index + chamada[0].length - 1);
      if (!tmpPermitido.test(args)) {
        const linha = conteudo.slice(0, chamada.index).split(/\r?\n/).length;
        falhas.push(`${path.relative(raiz, arquivo)}:${linha}: mkdtemp precisa usar os.tmpdir() ou tmpdir()`);
      }
    }
  }
  assert.deepEqual(falhas, [], falhas.join('\n'));
});
