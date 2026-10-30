import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

// Excecoes sao expressoes e quantidades fechadas, nunca arquivos inteiros
// (exceto o proprio modulo que define a politica). Novas guardas falham
// mesmo dentro de usuarios-api.ts ou portal-users.tsx.
const excecoes = {
  'lib/sqlite-local.ts': ['u.role=?'],
  'lib/fila-email-chamados.ts': ["role IN ('admin','editor')", "r.role IN ('admin','editor')", "a.role IN ('admin','editor')"],
  'lib/usuarios-api.ts': [
    "role<>'admin'", "outro.role='admin'", 'role=?', 'role=?',
    'body.role === undefined', "role!=='viewer'", "role!=='admin'",
    'role!==target.role', 'role!==target.role', "role='viewer'",
  ],
  'components/portal-users.tsx': ["r.role === 'admin'", "r.role === 'editor'", "form.role === 'viewer'", "form.role !== 'viewer'"],
};

function comparacoes(fonte) {
  const membro = String.raw`\b(?:[\w$]+\s*(?:\?\.|\.)\s*)*(?:role|perfil)`;
  const valor = String.raw`(?:'[^']*'|"[^"]*"|[\w$.]+)`;
  const padroes = [
    new RegExp(`${membro}\\s*(?:===|!==|==|!=)\\s*${valor}`, 'g'),
    new RegExp(`(?:'admin'|'editor'|'viewer'|"admin"|"editor"|"viewer")\\s*(?:===|!==|==|!=)\\s*${membro}`, 'g'),
    /\b(?:\w+\.)?role\s*(?:=(?!=)|<>|\bIN\b)\s*(?:'[^']*'|\([^)]*\)|\?)/g,
    new RegExp(`\\[[^\\]\\n]*\\]\\s*\\.includes\\(\\s*${membro}\\s*\\)`, 'g'),
  ];
  return padroes.flatMap(padrao => [...fonte.matchAll(padrao)].map(m => m[0].replace(/\s+/g, ' '))).sort((a, b) => a.localeCompare(b));
}

void test('detector reconhece comparacoes diretas, invertidas, multiline e listas', () => {
  for (const fonte of [
    "user.role === 'admin'", "user?.role !== 'viewer'", "role != 'editor'",
    "'admin' === user.role", '"viewer" !== user.role',
    "user.role\n ===\n 'admin'", "['admin', 'editor'].includes(user.role)",
    "WHERE role IN ('admin','editor')", 'usuario.perfil === perfilPermitido',
  ]) assert.ok(comparacoes(fonte).length, fonte);
  assert.deepEqual(comparacoes('<p role="alert">Erro</p>'), []);
});

void test('acesso fora do modulo central nao compara perfis, salvo excecoes inventariadas', () => {
  const raiz = path.resolve(import.meta.dirname, '..');
  const vistos = new Set();
  const erros = [];
  function visitar(pasta) {
    for (const item of fs.readdirSync(path.join(raiz, pasta), { withFileTypes: true })) {
      const arquivo = `${pasta}/${item.name}`;
      if (item.isDirectory()) visitar(arquivo);
      else if (/\.[cm]?[jt]sx?$/.test(item.name) && arquivo !== 'lib/permissoes.ts') {
        const achados = comparacoes(fs.readFileSync(path.join(raiz, arquivo), 'utf8'));
        const permitidos = [...(excecoes[arquivo] ?? [])].sort((a, b) => a.localeCompare(b));
        if (excecoes[arquivo]) vistos.add(arquivo);
        if (JSON.stringify(achados) !== JSON.stringify(permitidos)) erros.push({ arquivo, achados, permitidos });
      }
    }
  }
  for (const pasta of ['lib', 'app', 'components']) visitar(pasta);
  assert.deepEqual(erros, [], 'Comparacoes com perfil devem usar pode(); revisar excecoes pontuais da 3.0.');
  assert.deepEqual([...vistos].sort((a, b) => a.localeCompare(b)), Object.keys(excecoes).sort((a, b) => a.localeCompare(b)));
});
